import { useState, useRef } from "react";

export default function Recorder() {
  const [recording, setRecording] = useState(false);
  const [audioURL, setAudioURL] = useState(null);
  const [result, setResult] = useState(null);
  const [language, setLanguage] = useState(""); // chosen language
  const [mode, setMode] = useState("transcribe"); // transcribe or translate
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunks = useRef([]);

  const startRecording = async () => {
    streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorderRef.current = new MediaRecorder(streamRef.current);
    chunks.current = [];

    mediaRecorderRef.current.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunks.current.push(e.data);
      }
    };

    mediaRecorderRef.current.onstop = () => {
      const blob = new Blob(chunks.current, { type: "audio/webm" });
      setAudioURL(URL.createObjectURL(blob));

      // ✅ stop microphone properly
      streamRef.current.getTracks().forEach((track) => track.stop());
    };

    mediaRecorderRef.current.start();
    setRecording(true);
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  const sendToBackend = async () => {
    if (!audioURL) return;

    const blob = new Blob(chunks.current, { type: "audio/webm" });
    const formData = new FormData();
    formData.append("file", blob, "recording.webm");

    if (language) {
      formData.append("language", language);
    }

    const res = await fetch(`http://127.0.0.1:8000/${mode}`, {
      method: "POST",
      body: formData,
    });

    const data = await res.json();
    setResult(data);
  };

  return (
    <div>
      <button onClick={startRecording} disabled={recording}>
        🎙️ Start Recording
      </button>
      <button onClick={stopRecording} disabled={!recording}>
        ⏹️ Stop Recording
      </button>

      {audioURL && (
        <>
          <audio src={audioURL} controls />

          {/* Language Selection */}
          <div>
            <label>
              Select Language:{" "}
              <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="">Auto Detect</option>
                <option value="en">English</option>
                <option value="hi">Hindi</option>
                <option value="ur">Urdu</option>
                <option value="te">Telugu</option>
                <option value="kn">Kannada</option>
                <option value="bn">Bengali</option>
                <option value="ta">Tamil</option>
                <option value="es">Spanish</option>
                <option value="de">German</option>
              </select>
            </label>
          </div>

          {/* Mode Selection */}
          <div>
            <label>
              Mode:{" "}
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="transcribe">Transcribe</option>
                <option value="translate">Translate</option>
              </select>
            </label>
          </div>

          <button onClick={sendToBackend}>
            {mode === "transcribe" ? "Transcribe" : "Translate"}
          </button>
        </>
      )}

      {result && (
        <pre style={{ whiteSpace: "pre-wrap", marginTop: "1rem" }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
