import os
import asyncio
import concurrent.futures
import tempfile
import aiofiles
import regex
import soundfile as sf
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import whisper
from aksharamukha import transliterate
from pydub import AudioSegment

# --- App setup ---
app = FastAPI()
origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Whisper model ---
model = whisper.load_model("medium")  # or "large-v3" for more accuracy

# Helper: Check if text is in Arabic/Urdu script
def is_arabic_script(text):
    return bool(regex.search(r'[\p{Arabic}]', text))

# Helper: run whisper in executor
async def run_whisper(file_path, language=None, task=None):
    loop = asyncio.get_event_loop()
    with concurrent.futures.ThreadPoolExecutor() as pool:
        return await loop.run_in_executor(
            pool,
            lambda: model.transcribe(file_path, language=language, task=task)
        )

# Helper: convert audio to wav
def convert_to_wav(input_path, output_path):
    audio = AudioSegment.from_file(input_path)
    audio.export(output_path, format="wav")

@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...), language: str = Form(None)):
    # Save uploaded file to temp
    temp_input = tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(file.filename)[1])
    temp_input_path = temp_input.name
    temp_input.close()  # no await, regular file

    file_content = await file.read()
    if not file_content:
        os.remove(temp_input_path)
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    async with aiofiles.open(temp_input_path, "wb") as out_file:
        await out_file.write(file_content)

    # Check if audio has data
    try:
        data, samplerate = sf.read(temp_input_path)
        if data.size == 0:
            raise ValueError
    except Exception:
        # Try converting to WAV if possible
        temp_wav_path = tempfile.NamedTemporaryFile(delete=False, suffix=".wav").name
        try:
            convert_to_wav(temp_input_path, temp_wav_path)
            data, samplerate = sf.read(temp_wav_path)
            if data.size == 0:
                os.remove(temp_input_path)
                os.remove(temp_wav_path)
                raise HTTPException(status_code=400, detail="Audio file contains no data")
            temp_file_path = temp_wav_path
        except Exception:
            os.remove(temp_input_path)
            raise HTTPException(status_code=400, detail="Unsupported or corrupted audio file")
    else:
        temp_file_path = temp_input_path

    try:
        # Run whisper transcription
        result = await run_whisper(temp_file_path, language=language)
    finally:
        # Cleanup temp files
        try:
            os.remove(temp_input_path)
        except:
            pass
        if temp_file_path != temp_input_path:
            try:
                os.remove(temp_file_path)
            except:
                pass

    transcript_text = result["text"]
    if is_arabic_script(transcript_text):
        transcript_text = transliterate.process("Arabic", "Devanagari", transcript_text)

    return {
        "language_detected": result.get("language", language or "auto"),
        "transcript": transcript_text
    }


@app.post("/translate")
async def translate(
    file: UploadFile = File(...),
    language: str = Form(None)  # Optional: "hi", "te", "kn", etc.
):
    # Create temp file
    temp_file = tempfile.NamedTemporaryFile(delete=False)
    temp_file_path = temp_file.name
    temp_file.close()

    # Save uploaded file
    async with aiofiles.open(temp_file_path, "wb") as out_file:
        await out_file.write(await file.read())

    try:
        # Translate to English
        if language:
            result = await run_whisper(temp_file_path, language=language, task="translate")
        else:
            result = await run_whisper(temp_file_path, task="translate")
    finally:
        # Delete temp file safely
        try:
            os.remove(temp_file_path)
        except Exception as e:
            print(f"Could not delete temp file: {e}")

    return {
        "language_detected": result.get("language", language or "auto"),
        "translation": result["text"]
    }
