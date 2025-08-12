import React, { useState } from "react";

function App() {
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState("transcribe"); // transcribe or translate
  const [srcLang, setSrcLang] = useState("auto");
  const [destLang, setDestLang] = useState("hi");
  const [transcript, setTranscript] = useState("");
  const [translation, setTranslation] = useState("");
  const [loading, setLoading] = useState(false);


  const languages = {
    auto: "Auto Detect",
    en: "English",
    hi: "Hindi",
    ta: "Tamil",
    te: "Telugu",
    fr: "French",
    es: "Spanish",
    de: "German",
    zh: "Chinese",
    ja: "Japanese",
  };

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

    if (mode === "translate") {
      formData.append("src_lang", srcLang);
      formData.append("dest_lang", destLang);
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
        setTranscript(data.transcript);
        setTranslation("");
      } else {
        setTranscript(data.transcript_original);
        setTranslation(data.translation);
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
            Translate (Any language)
          </label>
        </div>

        {mode === "translate" && (
          <div style={{ marginTop: 10 }}>
            <label>
              From:{" "}
              <select
                value={srcLang}
                onChange={(e) => setSrcLang(e.target.value)}
              >
                {Object.entries(languages).map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ marginLeft: 20 }}>
              To:{" "}
              <select
                value={destLang}
                onChange={(e) => setDestLang(e.target.value)}
              >
                {Object.entries(languages).map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

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
          <h3>
            Translation ({languages[destLang] || destLang}):
          </h3>
          <p>{translation}</p>
        </div>
      )}
    </div>
  );
}



export default App;
