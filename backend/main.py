import os
import aiofiles
import regex
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
import whisper
from aksharamukha import transliterate

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


@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: str = Form(None)  # Optional: "hi", "te", "kn", etc. (auto-detect if None)
):
    # Save temp file
    temp_file_path = f"temp_{file.filename}"
    async with aiofiles.open(temp_file_path, "wb") as out_file:
        await out_file.write(await file.read())

    # Transcribe (auto-detect if language is None)
    if language:
        result = model.transcribe(temp_file_path, language=language)
    else:
        result = model.transcribe(temp_file_path)

    os.remove(temp_file_path)

    transcript_text = result["text"]

    # If text is in Arabic/Urdu script, convert to Devanagari
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
    # Save temp file
    temp_file_path = f"temp_{file.filename}"
    async with aiofiles.open(temp_file_path, "wb") as out_file:
        await out_file.write(await file.read())

    # Translate to English (auto-detect if language is None)
    if language:
        result = model.transcribe(temp_file_path, language=language, task="translate")
    else:
        result = model.transcribe(temp_file_path, task="translate")

    os.remove(temp_file_path)

    return {
        "language_detected": result.get("language", language or "auto"),
        "translation": result["text"]
    }
