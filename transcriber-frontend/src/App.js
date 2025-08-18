import React, { useState } from "react";

function App() {
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState("transcribe"); // transcribe or translate
  const [language, setLanguage] = useState(""); // auto-detect by default
  const [transcript, setTranscript] = useState("");
  const [translation, setTranslation] = useState("");
  const [loading, setLoading] = useState(false);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
    setTranscript("");
    setTranslation("");
  };

  const handleModeChange = (e) => {
    setMode(e.target.value);
    setTranscript("");
    setTranslation("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return alert("Please upload an audio file");

    setLoading(true);

    const formData = new FormData();
    formData.append("file", file);
    if (language) {
      formData.append("language", language); // optional
    }

    try {
      const endpoint =
        mode === "transcribe"
          ? "http://127.0.0.1:8000/transcribe"
          : "http://127.0.0.1:8000/translate";

      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });
      const data = await response.json();

      if (mode === "transcribe") {
        setTranscript(data.transcript || "");
        setTranslation("");
      } else {
        setTranscript("");
        setTranslation(data.translation || "");
      }
    } catch (error) {
      alert("Error processing audio");
      console.error(error);
    }

    setLoading(false);
  };

  return (
    <div style={{ maxWidth: 600, margin: "auto", padding: 20 }}>
      <h2>Whisper Audio Transcriber & Translator</h2>

      <form onSubmit={handleSubmit}>
        <input type="file" accept="audio/*" onChange={handleFileChange} />

        {/* Mode selection */}
        <div style={{ marginTop: 10 }}>
          <label>
            <input
              type="radio"
              value="transcribe"
              checked={mode === "transcribe"}
              onChange={handleModeChange}
            />
            Transcribe (Text only)
          </label>

          <label style={{ marginLeft: 20 }}>
            <input
              type="radio"
              value="translate"
              checked={mode === "translate"}
              onChange={handleModeChange}
            />
            Translate (to English)
          </label>
        </div>

        {/* Language dropdown */}
        <div style={{ marginTop: 10 }}>
          <label>
            Select Language (optional):
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              style={{ marginLeft: 10 }}
            >
              <option value="">Auto Detect</option>
              <option value="hi">Hindi</option>
              <option value="te">Telugu</option>
              <option value="kn">Kannada</option>
              <option value="ta">Tamil</option>
              <option value="ml">Malayalam</option>
              <option value="gu">Gujarati</option>
              <option value="bn">Bengali</option>
              <option value="pa">Punjabi</option>
              <option value="ur">Urdu</option>
            </select>
          </label>
        </div>

        <button type="submit" disabled={loading} style={{ marginTop: 10 }}>
          {loading
            ? mode === "transcribe"
              ? "Transcribing..."
              : "Translating..."
            : mode === "transcribe"
              ? "Transcribe"
              : "Translate"}
        </button>
      </form>

      {transcript && (
        <div style={{ marginTop: 20 }}>
          <h3>Original Transcript:</h3>
          <p>{transcript}</p>
        </div>
      )}

      {translation && (
        <div style={{ marginTop: 20 }}>
          <h3>Translation (English):</h3>
          <p>{translation}</p>
        </div>
      )}
    </div>
  );
}

export default App;
