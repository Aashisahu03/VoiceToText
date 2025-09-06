import os
import asyncio
import concurrent.futures
import tempfile
import aiofiles
import regex
import soundfile as sf
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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

from routes.audio import router as audio_router

# Helper: convert audio to wav (used by router)
def convert_to_wav(input_path, output_path):
    audio = AudioSegment.from_file(input_path)
    audio.export(output_path, format="wav")

# Include routers
app.include_router(audio_router)
