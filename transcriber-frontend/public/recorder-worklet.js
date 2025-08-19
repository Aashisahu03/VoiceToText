// public/recorder-worklet.js
class PCMRecorder extends AudioWorkletProcessor {
    constructor(options) {
        super();

        // desired target sample rate
        this.targetRate = (options && options.processorOptions && options.processorOptions.downsampleTo) || 16000;

        // actual input sample rate provided by the AudioWorklet global 'sampleRate'
        this.inputRate = sampleRate;

        // floating input buffer of input samples (Float32 -1..1)
        this.inputBuffer = new Float32Array(0);

        // internal read position for resampling (fractional)
        this.readPos = 0;

        // number of output samples per send (20ms at targetRate)
        this.frameSamples = Math.floor(this.targetRate * 0.02); // 20ms

        this.sentFrames = 0;

        // ratio of input samples per output sample
        this.ratio = this.inputRate / this.targetRate;

        try {
            this.port.postMessage({
                type: "loaded",
                sampleRate: this.inputRate,
                decimation: this.ratio
            });
        } catch (e) { }
    }

    // helper to append Float32Array to inputBuffer
    appendToInputBuffer(newChunk) {
        const old = this.inputBuffer;
        const combined = new Float32Array(old.length + newChunk.length);
        combined.set(old, 0);
        combined.set(newChunk, old.length);
        this.inputBuffer = combined;
    }

    // produce up to 'n' output samples (Float32) by linear interpolation
    produceOutputSamples(n) {
        const out = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const idx = this.readPos;
            const i0 = Math.floor(idx);
            const frac = idx - i0;
            const s0 = i0 < this.inputBuffer.length ? this.inputBuffer[i0] : 0;
            const s1 = (i0 + 1) < this.inputBuffer.length ? this.inputBuffer[i0 + 1] : 0;
            out[i] = s0 + (s1 - s0) * frac;
            this.readPos += this.ratio;
        }

        // drop consumed samples from inputBuffer
        const consumed = Math.floor(this.readPos);
        if (consumed > 0) {
            const remaining = new Float32Array(Math.max(0, this.inputBuffer.length - consumed));
            if (remaining.length > 0) remaining.set(this.inputBuffer.subarray(consumed));
            this.inputBuffer = remaining;
            this.readPos -= consumed;
        }
        return out;
    }

    process(inputs) {
        try {
            const input = inputs[0];
            if (!input || input.length === 0) return true;
            const channelData = input[0];
            if (!channelData) return true;

            // append the incoming float32 samples to the buffer
            this.appendToInputBuffer(channelData);

            // while we have enough input to produce a full output frame, produce and send it
            while (true) {
                // estimate how many input samples needed to produce frameSamples outputs
                const neededInput = Math.ceil(this.readPos + this.ratio * this.frameSamples);
                if (this.inputBuffer.length < neededInput) break;

                // produce output frame (Float32)
                const outF32 = this.produceOutputSamples(this.frameSamples);

                // convert to Int16
                const pcm = new Int16Array(outF32.length);
                for (let i = 0; i < outF32.length; i++) {
                    let s = outF32[i];
                    if (s > 1) s = 1;
                    else if (s < -1) s = -1;
                    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
                }

                // send as transferable ArrayBuffer
                try {
                    this.port.postMessage({ type: "data", payload: pcm.buffer }, [pcm.buffer]);
                } catch (e) {
                    // fallback if transfer fails
                    this.port.postMessage({ type: "data", payload: pcm.buffer });
                }

                this.sentFrames++;
                if (this.sentFrames % 50 === 0) {
                    try { this.port.postMessage({ type: "debug", sentFrames: this.sentFrames }); } catch (e) { }
                }
            }
        } catch (err) {
            try { this.port.postMessage({ type: "error", message: String(err) }); } catch (e) { }
        }
        return true;
    }
}

registerProcessor("pcm-recorder", PCMRecorder);
