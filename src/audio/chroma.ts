/**
 * FFT frame (dB magnitudes, as from AnalyserNode.getFloatFrequencyData) → 12-bin chroma.
 *
 * Uses spectral peaks only (with parabolic interpolation) rather than every bin:
 * at 8192/48k each bin is ~5.9 Hz, wider than a semitone below ~100 Hz, and the
 * Blackman main lobe smears every partial over ~6 bins. Peak picking keeps the
 * pitch estimate sharp and ignores the broadband noise floor.
 */

export type ChromaOptions = {
  minHz: number;
  maxHz: number;
  /** Band RMS (linear, analyser scale) below which the frame counts as silence. */
  noiseFloor: number;
  /** Peaks more than this many dB below the frame's loudest peak are ignored. */
  peakRangeDb: number;
  /** Absolute dB floor for a peak. */
  minPeakDb: number;
  /**
   * Upper edge of the "bass" chroma. Guitar low strings live below ~200 Hz; most
   * singing (and all of a typical female voice) sits above it, so the bass
   * chroma is a voice-resistant second opinion on the chord.
   */
  bassMaxHz: number;
  /**
   * Background removal. A frequency bin whose level stayed within a
   * `steadyDb` range over the last `steadyFrames` frames (~1.2 s) is a steady
   * background tone and is ignored — mains hum at 120/180/240/300 Hz (which
   * reads as B minor!), whining electronics, fridges. Plucked strings decay
   * faster than that, so they never qualify.
   */
  steadyDb: number;
  steadyFrames: number;
  /** turn background learning (and its warm-up) off — for analysing single frames */
  background: boolean;
};

export const DEFAULT_CHROMA_OPTIONS: ChromaOptions = {
  minHz: 80,
  maxHz: 2000,
  noiseFloor: 0.0012,
  peakRangeDb: 45,
  minPeakDb: -95,
  bassMaxHz: 200,
  steadyDb: 3,
  steadyFrames: 30,
  background: true,
};

export type ChromaFrame = {
  /** L2-normalised chroma, or null for silence */
  chroma: Float32Array | null;
  /** L2-normalised chroma of peaks below bassMaxHz, or null if there are none */
  bass: Float32Array | null;
  /** RMS of linear magnitude across the band */
  energy: number;
  /** loudest peak in dB */
  peakDb: number;
  /**
   * Spectral peaks (interpolated frequency), strongest first. Reported even
   * when the frame is below the silence floor, for the live "what I hear" view.
   */
  peaks: Peak[];
  /** true when the frame was treated as silence (chroma === null) */
  silent: boolean;
};

/** A steady background tone the extractor has learned to ignore. */
export type BackgroundTone = { freq: number; db: number };

export type Peak = { freq: number; db: number; mag: number };

/** Spectral weighting: low octaves a bit higher (roots live there), above ~1 kHz lower (voice/harmonics). */
export function frequencyWeight(f: number): number {
  if (f >= 1000) return 0.45;
  const octavesAbove80 = Math.log2(Math.max(f, 80) / 80);
  return 1.25 - 0.25 * (octavesAbove80 / Math.log2(1000 / 80));
}

export const hzToMidi = (f: number): number => 69 + 12 * Math.log2(f / 440);

export class ChromaExtractor {
  readonly opts: ChromaOptions;
  private lo: number;
  private hi: number;
  private binHz: number;
  private mag: Float32Array;
  private clean: Float32Array;
  private cleanDb: Float32Array;
  /** ring buffer of recent per-bin levels (dB), [frame][bin - lo + 1] */
  private hist: Float32Array;
  private histPos = 0;
  private histFilled = 0;
  private steady: Uint8Array;
  private lastDb: Float32Array;
  /** learned background magnitude per bin (kept, slowly fading, while you play over it) */
  private profile: Float32Array;

  constructor(readonly sampleRate: number, readonly fftSize: number, opts: Partial<ChromaOptions> = {}) {
    this.opts = { ...DEFAULT_CHROMA_OPTIONS, ...opts };
    this.binHz = sampleRate / fftSize;
    this.lo = Math.max(1, Math.ceil(this.opts.minHz / this.binHz));
    this.hi = Math.min(fftSize / 2 - 2, Math.floor(this.opts.maxHz / this.binHz));
    this.mag = new Float32Array(fftSize / 2);
    this.clean = new Float32Array(fftSize / 2);
    this.cleanDb = new Float32Array(fftSize / 2);
    const n = this.hi - this.lo + 3;
    this.hist = new Float32Array(n * this.opts.steadyFrames);
    this.steady = new Uint8Array(fftSize / 2);
    this.lastDb = new Float32Array(fftSize / 2).fill(-200);
    this.profile = new Float32Array(fftSize / 2);
  }

  /** False during the first ~1.2 s while the room's background is being learned. */
  get ready(): boolean {
    return !this.opts.background || this.histFilled >= this.opts.steadyFrames;
  }

  /** Forget the learned background (e.g. when listening restarts somewhere else). */
  resetNoise(): void {
    this.histPos = 0;
    this.histFilled = 0;
    this.steady.fill(0);
    this.profile.fill(0);
  }

  /** Record this frame's levels and mark bins that have been steady for the whole window. */
  private trackBackground(db: Float32Array): void {
    const { lo, hi, hist, steady } = this;
    const n = hi - lo + 3;
    const N = this.opts.steadyFrames;
    const base = this.histPos * n;
    for (let k = lo - 1; k <= hi + 1; k++) {
      const d = Number.isFinite(db[k]) ? Math.max(-200, db[k]) : -200;
      hist[base + k - lo + 1] = d;
    }
    this.histPos = (this.histPos + 1) % N;
    this.histFilled = Math.min(N, this.histFilled + 1);
    if (this.histFilled < N) return;
    const range = this.opts.steadyDb;
    for (let k = lo - 1; k <= hi + 1; k++) {
      const j = k - lo + 1;
      let mn = Infinity, mx = -Infinity;
      for (let f = 0; f < N; f++) {
        const v = hist[f * n + j];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
        if (mx - mn >= range) break;
      }
      steady[k] = mx - mn < range && mx > -190 ? 1 : 0;
    }
  }

  /**
   * The strongest steady tones in the learned background (≥18 dB above the
   * typical background level), for the troubleshooting view.
   */
  backgroundTones(max = 5): BackgroundTone[] {
    const { lo, hi, lastDb, steady } = this;
    const out: BackgroundTone[] = [];
    for (let k = lo; k <= hi; k++) {
      if (!steady[k] || lastDb[k] < -95) continue;
      if (lastDb[k] > lastDb[k - 1] && lastDb[k] >= lastDb[k + 1]) {
        // A real tone stands well clear of its neighbourhood.
        const around = Math.min(lastDb[Math.max(lo, k - 8)], lastDb[Math.min(hi, k + 8)]);
        if (lastDb[k] - around >= 12) out.push({ freq: k * this.binHz, db: lastDb[k] });
      }
    }
    return out.sort((a, b) => b.db - a.db).slice(0, max).sort((a, b) => a.freq - b.freq);
  }

  setNoiseFloor(v: number): void {
    this.opts.noiseFloor = v;
  }

  compute(db: Float32Array): ChromaFrame {
    const { lo, hi, mag, clean, steady, lastDb, profile } = this;
    if (this.opts.background) this.trackBackground(db);
    let sumSq = 0;
    let maxDb = -Infinity;
    const cdb = this.cleanDb;
    for (let k = lo - 1; k <= hi + 1; k++) {
      const d = Number.isFinite(db[k]) ? Math.max(-200, db[k]) : -200;
      lastDb[k] = d;
      const m = d > -200 ? Math.pow(10, d / 20) : 0;
      mag[k] = m;
      // Learn the background while a bin is steady; remember it (fading over
      // ~20 s) once you play over it, and subtract it with a ~4 dB margin.
      if (steady[k]) profile[k] = m;
      else profile[k] *= 0.998;
      const c = steady[k] ? 0 : Math.max(0, m - 1.6 * profile[k]);
      clean[k] = c;
      cdb[k] = c > 0 ? 20 * Math.log10(c) : -200;
      if (k >= lo && k <= hi) {
        sumSq += c * c;
        if (c > 0 && d > maxDb) maxDb = d;
      }
    }
    const energy = Math.sqrt(sumSq);
    if (!Number.isFinite(maxDb)) return { chroma: null, bass: null, energy, peakDb: maxDb, peaks: [], silent: true };

    const chroma = new Float32Array(12);
    const bass = new Float32Array(12);
    const peaks: Peak[] = [];
    const minDb = Math.max(this.opts.minPeakDb, maxDb - this.opts.peakRangeDb);
    for (let k = lo; k <= hi; k++) {
      const b = cdb[k];
      if (!(b > minDb) || !(clean[k] > clean[k - 1]) || !(clean[k] >= clean[k + 1])) continue;
      const a = cdb[k - 1];
      const c = cdb[k + 1];
      const denom = a - 2 * b + c;
      const p = denom < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
      const f = (k + p) * this.binHz;
      peaks.push({ freq: f, db: b - 0.25 * (a - c) * p, mag: clean[k] });
      const pc = ((Math.round(hzToMidi(f)) % 12) + 12) % 12;
      chroma[pc] += clean[k] * frequencyWeight(f);
      if (f < this.opts.bassMaxHz) bass[pc] += clean[k];
    }
    peaks.sort((x, y) => y.mag - x.mag);
    if (!this.ready || energy < this.opts.noiseFloor || !normalizeInPlace(chroma))
      return { chroma: null, bass: null, energy, peakDb: maxDb, peaks, silent: true };
    return { chroma, bass: normalizeInPlace(bass) ? bass : null, energy, peakDb: maxDb, peaks, silent: false };
  }
}

export function normalizeInPlace(v: Float32Array): boolean {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  if (s <= 0) return false;
  const n = Math.sqrt(s);
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return true;
}

/** Exponential moving average over chroma frames, re-normalised. */
export class ChromaSmoother {
  private state: Float32Array | null = null;
  constructor(public alpha = 0.4) {}

  push(c: Float32Array | null): Float32Array | null {
    if (!c) {
      if (this.state) for (let i = 0; i < 12; i++) this.state[i] *= 1 - this.alpha;
      return null;
    }
    if (!this.state) this.state = Float32Array.from(c);
    else for (let i = 0; i < 12; i++) this.state[i] = this.alpha * c[i] + (1 - this.alpha) * this.state[i];
    const out = Float32Array.from(this.state);
    return normalizeInPlace(out) ? out : null;
  }

  reset(): void {
    this.state = null;
  }
}

/** Number of pitch classes at or above `rel` × the frame maximum. */
export function polyphony(chroma: ArrayLike<number>, rel = 0.35): number {
  let max = 0;
  for (let i = 0; i < 12; i++) if (chroma[i] > max) max = chroma[i];
  if (max <= 0) return 0;
  let n = 0;
  for (let i = 0; i < 12; i++) if (chroma[i] >= rel * max) n++;
  return n;
}
