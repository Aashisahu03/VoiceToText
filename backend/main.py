# main.py
import asyncio
import io
import numpy as np
from faster_whisper import WhisperModel
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional
import concurrent.futures
import tempfile
import os
import json

# optional translation pipeline
from transformers import pipeline

# ---------- App ----------
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

# ---------- Model selection ----------
MODEL_NAME = "small"
try:
    import torch
    has_cuda = torch.cuda.is_available()
except Exception:
    has_cuda = False

compute_type = "float16" if has_cuda else "int8"
device = "cuda" if has_cuda else "cpu"

print(f"Loading faster-whisper model: {MODEL_NAME} device={device} compute_type={compute_type}")
model = WhisperModel(MODEL_NAME, device=device, compute_type=compute_type)
executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)

# translation pipeline (Helsinki-NLP supports many→English)
translator = pipeline("translation", model="Helsinki-NLP/opus-mt-mul-en")

# ---------- PyAV decode (optional) ----------
try:
    import av
    HAVE_PYAV = True
except Exception:
    HAVE_PYAV = False

TARGET_SR = 16000

def detect_container(b: bytes) -> Optional[str]:
    if len(b) >= 4 and b[:4] == b"RIFF": return "wav"
    if b.startswith(b"OggS"): return "ogg"
    if len(b) >= 4 and b[:4] == b"\x1A\x45\xDF\xA3": return "webm"
    return None

def decode_opus_like_to_pcm16_mono16k(chunk: bytes) -> np.ndarray:
    if not HAVE_PYAV:
        return np.zeros(0, dtype=np.int16)
    with av.open(io.BytesIO(chunk), mode="r") as container:
        stream = next((s for s in container.streams if s.type == "audio"), None)
        if stream is None:
            return np.zeros(0, dtype=np.int16)
        resampler = av.audio.resampler.AudioResampler(format="s16", layout="mono", rate=TARGET_SR)
        out = []
        for packet in container.demux(stream):
            for frame in packet.decode():
                frame = resampler.resample(frame)
                arr = frame.to_ndarray()
                if arr.ndim == 2: arr = arr[0]
                out.append(arr.copy())
        if not out: return np.zeros(0, dtype=np.int16)
        return np.concatenate(out).astype(np.int16)

# ---------- Rolling buffer ----------
class RollingBuffer:
    def __init__(self, sr=TARGET_SR, max_secs=120):
        self.sr = sr
        self.max_samples = sr * max_secs
        self.buf = np.zeros(0, dtype=np.int16)
        self.lock = asyncio.Lock()

    async def append_pcm16(self, pcm16: np.ndarray):
        if pcm16.size == 0: return
        async with self.lock:
            self.buf = np.concatenate([self.buf, pcm16])
            if self.buf.size > self.max_samples:
                self.buf = self.buf[-self.max_samples:]

    async def window_f32(self, secs: float) -> np.ndarray:
        n = int(self.sr * secs)
        async with self.lock:
            window = self.buf[-n:] if self.buf.size > n else self.buf.copy()
        return (window.astype(np.float32)/32768.0) if window.size else np.zeros(0, np.float32)

async def safe_send_json(ws: WebSocket, obj: dict):
    try:
        await ws.send_json(obj)
    except Exception:
        pass

# ---------- Dual-step transcribe + translate ----------
def transcribe_then_translate(audio_f32: np.ndarray, language: Optional[str] = None):
    # Step 1: transcribe original language
    segments, info = model.transcribe(audio_f32, task="transcribe", language=language, beam_size=5)
    transcript = " ".join([seg.text.strip() for seg in segments if seg.text.strip()])
    # Step 2: translate → English
    translation = ""
    if transcript:
        try:
            out = translator(transcript, max_length=512)
            translation = out[0]['translation_text']
        except Exception as e:
            print("Translation error:", e)
    return {
        "language": getattr(info, "language", None),
        "transcript": transcript,
        "translation": translation
    }

# ---------- WebSocket route ----------
@app.websocket("/ws/translate")
async def ws_translate(ws: WebSocket):
    try: await ws.accept()
    except Exception: return

    print("WS connection open")
    rb = RollingBuffer()
    last_partial = {"transcript":"", "translation":""}
    stop_requested = False
    task_mode = "translate"  # kept for backwards compat
    language_hint = None

    async def transcriber_loop():
        nonlocal last_partial, stop_requested, language_hint
        try:
            while not stop_requested:
                await asyncio.sleep(0.6)
                audio_f32 = await rb.window_f32(8.0)
                if audio_f32.size < int(TARGET_SR * 0.8): continue
                try:
                    loop = asyncio.get_running_loop()
                    result = await loop.run_in_executor(executor, transcribe_then_translate, audio_f32, language_hint)
                    if result and (result["transcript"] != last_partial["transcript"] or result["translation"] != last_partial["translation"]):
                        last_partial = {"transcript": result["transcript"], "translation": result["translation"]}
                        await safe_send_json(ws, {"type":"partial", **last_partial})
                except Exception as e:
                    print("transcriber error:", e)
        except asyncio.CancelledError: pass

    transcriber_task = asyncio.create_task(transcriber_loop())

    try:
        while True:
            try:
                text = await ws.receive_text()
            except WebSocketDisconnect: break
            except Exception: text = None

            if text is not None:
                try:
                    parsed = json.loads(text)
                    if isinstance(parsed, dict) and parsed.get("cmd")=="task" and parsed.get("task") in ("transcribe","translate"):
                        language_hint = parsed.get("language") or None
                        await safe_send_json(ws, {"type":"info","message":f"language hint={language_hint}"})
                        continue
                except Exception: pass

                if text == "__end__":
                    stop_requested = True
                    break
                continue

            try:
                chunk = await ws.receive_bytes()
            except WebSocketDisconnect: break
            except Exception: break

            # append PCM
            if len(chunk)%2==0 and detect_container(chunk) is None:
                try:
                    pcm16 = np.frombuffer(chunk, dtype=np.int16)
                    await rb.append_pcm16(pcm16)
                except Exception as e: print("append_pcm16 error:", e)
                continue

            kind = detect_container(chunk)
            if kind in ("webm","ogg","wav"):
                pcm16 = decode_opus_like_to_pcm16_mono16k(chunk)
                if pcm16.size: await rb.append_pcm16(pcm16)
                continue
            continue

    finally:
        stop_requested = True
        try:
            transcriber_task.cancel()
            await asyncio.sleep(0)
        except Exception: pass

        # final segment
        try:
            audio_f32 = await rb.window_f32(12.0)
            if audio_f32.size:
                loop = asyncio.get_running_loop()
                result = await loop.run_in_executor(executor, transcribe_then_translate, audio_f32, language_hint)
                if result:
                    await safe_send_json(ws, {"type":"final", **result})
        except Exception as e: print("final error:", e)

        try: await ws.close()
        except Exception: pass
        print("WS connection closed")

# ---------- File endpoints ----------
@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...), language: Optional[str]=None):
    try:
        suffix = os.path.splitext(file.filename or "audio")[1] or ".wav"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(await file.read())
            tmp.flush()
            tmp_path = tmp.name

        segments, info = model.transcribe(tmp_path, task="transcribe", language=language, beam_size=5)
        transcript = " ".join([s.text for s in segments])
        return {"language": getattr(info,"language",None), "transcript": transcript}
    except Exception as e:
        print("transcribe endpoint error:", e)
        return {"error": str(e)}
    finally:
        try:
            if 'tmp_path' in locals() and os.path.exists(tmp_path): os.unlink(tmp_path)
        except Exception: pass

@app.post("/translate")
async def translate(file: UploadFile = File(...), language: Optional[str]=None):
    try:
        suffix = os.path.splitext(file.filename or "audio")[1] or ".wav"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(await file.read())
            tmp.flush()
            tmp_path = tmp.name

        segments, info = model.transcribe(tmp_path, task="transcribe", language=language, beam_size=5)
        transcript = " ".join([s.text for s in segments])
        translation = ""
        if transcript:
            try:
                out = translator(transcript, max_length=512)
                translation = out[0]['translation_text']
            except Exception as e:
                print("Translation error:", e)
        return {"language": getattr(info,"language",None), "transcript": transcript, "translation": translation}
    finally:
        try:
            if 'tmp_path' in locals() and os.path.exists(tmp_path): os.unlink(tmp_path)
        except Exception: pass
