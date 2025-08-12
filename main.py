import aiofiles
import os
import whisper
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from googletrans import Translator
from concurrent.futures import ThreadPoolExecutor

app = FastAPI()

origins = ["http://localhost:3000", "http://127.0.0.1:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

model = whisper.load_model("base")
translator = Translator()
executor = ThreadPoolExecutor(max_workers=3)

@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    temp_file_path = f"temp_{file.filename}"
    async with aiofiles.open(temp_file_path, "wb") as out_file:
        content = await file.read()
        await out_file.write(content)

    result = model.transcribe(temp_file_path)
    os.remove(temp_file_path)

    return {"transcript": result["text"]}

@app.post("/translate")
async def translate(
    file: UploadFile = File(...),
    src_lang: str = Form("auto"),  # detect automatically if not given
    dest_lang: str = Form("en")    # default to English
):
    temp_file_path = f"temp_{file.filename}"
    async with aiofiles.open(temp_file_path, "wb") as out_file:
        content = await file.read()
        await out_file.write(content)

    result = model.transcribe(temp_file_path)
    os.remove(temp_file_path)

    transcript_text = result["text"]

    translation = translator.translate(transcript_text, src=src_lang, dest=dest_lang)

    return {
        "transcript_original": transcript_text,
        "source_language": src_lang,
        "target_language": dest_lang,
        "translation": translation.text,
    }
