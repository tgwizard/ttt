// Live microphone → Muse Voice Transcribe realtime WebSocket.
// Audio is captured with an AudioWorklet, resampled to 24 kHz mono PCM16 and sent in 80 ms frames.

const ASR_URL = "wss://api.meta.ai/v1/asr/realtime";
const ASR_MODEL = "muse-voice-transcribe-1.0";
const TARGET_RATE = 24000;
const FRAME_SAMPLES = (TARGET_RATE * 80) / 1000;

// Runs on the audio thread. Linear resampling is plenty for speech.
const WORKLET = `
class Pcm24k extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ratio = sampleRate / ${TARGET_RATE};
    this.pos = 0;
    this.prev = 0;
    this.out = new Int16Array(${FRAME_SAMPLES});
    this.n = 0;
    this.sumSq = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    // pos is the fractional read position into [prev, ...input]
    while (this.pos < input.length) {
      const i = Math.floor(this.pos);
      const frac = this.pos - i;
      const a = i === 0 ? this.prev : input[i - 1];
      const b = input[i];
      const s = Math.max(-1, Math.min(1, a + (b - a) * frac));
      this.out[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      this.sumSq += s * s;
      if (this.n === this.out.length) {
        const level = Math.sqrt(this.sumSq / this.n);
        this.port.postMessage({ pcm: this.out.buffer, level }, [this.out.buffer]);
        this.out = new Int16Array(${FRAME_SAMPLES});
        this.n = 0;
        this.sumSq = 0;
      }
      this.pos += this.ratio;
    }
    this.pos -= input.length;
    this.prev = input[input.length - 1];
    return true;
  }
}
registerProcessor("pcm24k", Pcm24k);
`;

export type AsrHandlers = {
  onPartial: (text: string) => void;
  onTurn: (text: string) => void;
  onLevel: (level: number) => void;
  onReady: () => void;
  onClose: (error?: string) => void;
};

export class Transcriber {
  private ws?: WebSocket;
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private ready = false;
  private queue: ArrayBuffer[] = [];
  private stopping = false;
  private closed = false;
  private lastError?: string;
  private h: AsrHandlers;

  constructor(handlers: AsrHandlers) {
    this.h = handlers;
  }

  async start(apiKey: string): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    const ws = new WebSocket(`${ASR_URL}?sessionId=ttt-${crypto.randomUUID()}`);
    this.ws = ws;
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          authorization: { accessToken: `Bearer ${apiKey}` },
          audioEncoding: "PCM_24KHZ",
          model: ASR_MODEL,
          mode: "ENDPOINTING",
          partialMode: "CUMULATIVE",
          emitAudioProgress: false,
        }),
      );
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      const msg = JSON.parse(e.data);
      if (!msg.type) {
        if (msg.sessionId && !this.ready) {
          this.ready = true;
          for (const buf of this.queue) ws.send(buf);
          this.queue = [];
          this.h.onReady();
        }
        return;
      }
      switch (msg.type) {
        case "transcript":
          if (!msg.final) this.h.onPartial(msg.transcript ?? "");
          break;
        case "speechComplete":
          this.h.onPartial("");
          if (msg.transcript?.trim()) this.h.onTurn(msg.transcript.trim());
          break;
        case "error":
          this.lastError = msg.message;
          break;
      }
    };
    ws.onerror = () => {
      this.lastError ??= "WebSocket error";
    };
    ws.onclose = (e) => {
      const error = e.code === 1000 && !this.lastError ? undefined : (this.lastError ?? `Closed (${e.code}${e.reason ? `: ${e.reason}` : ""})`);
      this.teardownAudio();
      if (!this.closed) {
        this.closed = true;
        this.h.onClose(this.stopping && e.code === 1000 ? undefined : error);
      }
    };

    const ctx = new AudioContext();
    this.ctx = ctx;
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const source = ctx.createMediaStreamSource(this.stream);
    const node = new AudioWorkletNode(ctx, "pcm24k");
    node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
      this.h.onLevel(e.data.level);
      if (this.stopping || ws.readyState !== WebSocket.OPEN) return;
      if (this.ready) ws.send(e.data.pcm);
      else this.queue.push(e.data.pcm);
    };
    // Keep the node pulled by the graph without playing anything back.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(node).connect(mute).connect(ctx.destination);
  }

  /** End input and let the server flush the last turn; resolves when the socket closes. */
  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.teardownAudio();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      ws?.close();
      return;
    }
    if (this.ready) ws.send(JSON.stringify({ type: "endStream" }));
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        ws.close();
        resolve();
      }, 8000);
      ws.addEventListener("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private teardownAudio() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    if (this.ctx && this.ctx.state !== "closed") void this.ctx.close();
    this.ctx = undefined;
  }
}
