'use client';
import React, { useState, useRef } from "react";

export default function App() {
  const [transcript, setTranscript] = useState("");
  const [translation, setTranslation] = useState("");
  const [partialTranscript, setPartialTranscript] = useState("");
  const [partialTranslation, setPartialTranslation] = useState("");

  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const streamRef = useRef(null);
  const processorRef = useRef(null);

  const startRealtime = async () => {
    setTranscript("");
    setTranslation("");
    setPartialTranscript("");
    setPartialTranslation("");

    wsRef.current = new WebSocket("ws://127.0.0.1:8000/ws/translate");
    wsRef.current.binaryType = "arraybuffer";

    wsRef.current.onopen = () => console.log("WS open");

    wsRef.current.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "partial") {
          if (msg.transcript) setPartialTranscript(msg.transcript);
          if (msg.translation) setPartialTranslation(msg.translation);
        } else if (msg.type === "final") {
          if (msg.transcript) setTranscript(prev => prev + msg.transcript + "\n");
          if (msg.translation) setTranslation(prev => prev + msg.translation + "\n");
          setPartialTranscript("");
          setPartialTranslation("");
        }
      } catch (err) {
        console.log("Non-JSON WS message:", event.data);
      }
    };

    wsRef.current.onclose = () => console.log("WS closed");

    // get mic & audio context
    streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContextRef.current = new AudioContext({ sampleRate: 48000 });

    await audioContextRef.current.audioWorklet.addModule("/recorder-worklet.js");

    const source = audioContextRef.current.createMediaStreamSource(streamRef.current);
    const processor = new AudioWorkletNode(audioContextRef.current, "pcm-recorder", { processorOptions: { downsampleTo: 16000 } });
    processorRef.current = processor;

    processor.port.onmessage = (e) => {
      const data = e.data;
      if (data?.type === "data" && data.payload && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(data.payload);
      }
    };

    const silentGain = audioContextRef.current.createGain();
    silentGain.gain.value = 0;
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioContextRef.current.destination);
  };

  const stopRealtime = async () => {
    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN) wsRef.current.send("__end__");
        wsRef.current.close();
      } catch (err) { console.warn("WS close error:", err); }
      wsRef.current = null;
    }

    if (processorRef.current) {
      try { processorRef.current.disconnect(); } catch { }
      processorRef.current = null;
    }

    if (audioContextRef.current) {
      try { if (audioContextRef.current.state === "running") await audioContextRef.current.close(); } catch { }
      audioContextRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }

    setPartialTranscript("");
    setPartialTranslation("");
  };

  return (
    <div style={{ maxWidth: 700, margin: "auto", padding: 20 }}>
      <h2>Live Whisper Transcription + Translation</h2>

      <div style={{ marginTop: 20 }}>
        <button onClick={startRealtime}>Start Mic</button>
        <button onClick={stopRealtime} style={{ marginLeft: 10 }}>Stop</button>
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

      {
    transcript && (
      <div style={{ marginTop: 20 }}>
        <h3>Original Transcript:</h3>
        <p>{transcript}{partialTranscript && ` (${partialTranscript})`}</p>
      </div>
    )
  }

  {
    (translation || partialTranslation) && (
      <div style={{ marginTop: 20 }}>
        <h3>English Translation:</h3>
        <pre>{translation}{partialTranslation && ` (${partialTranslation})`}</pre>
      </div>
    )
  }
    </div >
  );
}
