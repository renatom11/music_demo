/** Microphone capture: getUserMedia → (high-pass) → AnalyserNode. */

export type MicDeps = {
  getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>;
  createContext: () => AudioContext;
};

export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    // These "voice" filters smear guitar harmonics — turn them all off.
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
  video: false,
};

function defaultDeps(): MicDeps {
  return {
    getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
    createContext: () => {
      const Ctor: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      return new Ctor({ latencyHint: 'interactive' });
    },
  };
}

export class MicError extends Error {
  constructor(message: string, public kind: 'unsupported' | 'denied' | 'other') {
    super(message);
  }
}

export class Mic {
  readonly fftSize: number;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private nodes: AudioNode[] = [];
  private freq: Float32Array;
  private time: Float32Array;
  private highPassHz: number | null;

  constructor(private deps: MicDeps = defaultDeps(), opts: { fftSize?: number; highPassHz?: number | null } = {}) {
    this.fftSize = opts.fftSize ?? 8192;
    this.highPassHz = opts.highPassHz === undefined ? 70 : opts.highPassHz;
    this.freq = new Float32Array(this.fftSize / 2);
    this.time = new Float32Array(this.fftSize);
  }

  get running(): boolean {
    return this.ctx !== null && this.analyser !== null;
  }

  /** The live microphone stream (for recording a diagnostic clip). */
  get mediaStream(): MediaStream | null {
    return this.stream;
  }

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  /**
   * Must be called from inside a user gesture (tap) — iOS only lets an
   * AudioContext start in one. The context is created before awaiting the mic.
   */
  async start(): Promise<void> {
    if (this.running) return;
    let ctx: AudioContext;
    try {
      ctx = this.deps.createContext();
    } catch {
      throw new MicError('Web Audio is not supported in this browser.', 'unsupported');
    }
    const resumed = ctx.resume?.().catch(() => undefined);
    let stream: MediaStream;
    try {
      stream = await this.deps.getUserMedia(MIC_CONSTRAINTS);
    } catch (e) {
      void ctx.close?.().catch(() => undefined);
      const name = (e as { name?: string })?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError')
        throw new MicError('Microphone permission was denied.', 'denied');
      if (name === 'TypeError' || !this.deps.getUserMedia)
        throw new MicError('Microphone access needs HTTPS and a supported browser.', 'unsupported');
      throw new MicError(`Could not open the microphone (${name ?? e}).`, 'other');
    }
    await resumed;
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = this.fftSize;
    analyser.smoothingTimeConstant = 0; // we smooth ourselves
    analyser.minDecibels = -120;
    analyser.maxDecibels = 0;
    let last: AudioNode = src;
    this.nodes = [src];
    if (this.highPassHz) {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = this.highPassHz;
      hp.Q.value = 0.707;
      last.connect(hp);
      last = hp;
      this.nodes.push(hp);
    }
    last.connect(analyser);
    // Some browsers (older Safari) only pull audio through nodes connected to the
    // destination; route through a muted gain so nothing is audible.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    analyser.connect(mute);
    mute.connect(ctx.destination);
    this.nodes.push(analyser, mute);
    this.ctx = ctx;
    this.stream = stream;
    this.analyser = analyser;
  }

  stop(): void {
    for (const n of this.nodes) {
      try { n.disconnect(); } catch { /* already disconnected */ }
    }
    this.nodes = [];
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close?.().catch(() => undefined);
    this.ctx = null;
    this.stream = null;
    this.analyser = null;
  }

  /** Current spectrum in dB (length fftSize/2). Reuses one buffer. */
  getFrame(): Float32Array {
    this.analyser?.getFloatFrequencyData(this.freq as Float32Array<ArrayBuffer>);
    return this.freq;
  }

  /** RMS of the latest time-domain window, in dBFS. */
  getLevelDb(): number {
    if (!this.analyser) return -Infinity;
    this.analyser.getFloatTimeDomainData(this.time as Float32Array<ArrayBuffer>);
    let s = 0;
    for (let i = 0; i < this.time.length; i++) s += this.time[i] * this.time[i];
    const rms = Math.sqrt(s / this.time.length);
    return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
  }

  /** Context time in ms (falls back to performance.now()). */
  now(): number {
    return this.ctx ? this.ctx.currentTime * 1000 : performance.now();
  }
}
