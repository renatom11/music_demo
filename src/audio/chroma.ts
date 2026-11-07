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
};

export const DEFAULT_CHROMA_OPTIONS: ChromaOptions = {
  minHz: 80,
  maxHz: 2000,
  noiseFloor: 0.0012,
  peakRangeDb: 45,
  minPeakDb: -95,
  bassMaxHz: 200,
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
};

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

  constructor(readonly sampleRate: number, readonly fftSize: number, opts: Partial<ChromaOptions> = {}) {
    this.opts = { ...DEFAULT_CHROMA_OPTIONS, ...opts };
    this.binHz = sampleRate / fftSize;
    this.lo = Math.max(1, Math.ceil(this.opts.minHz / this.binHz));
    this.hi = Math.min(fftSize / 2 - 2, Math.floor(this.opts.maxHz / this.binHz));
    this.mag = new Float32Array(fftSize / 2);
  }

  setNoiseFloor(v: number): void {
    this.opts.noiseFloor = v;
  }

  compute(db: Float32Array): ChromaFrame {
    const { lo, hi, mag } = this;
    let sumSq = 0;
    let maxDb = -Infinity;
    for (let k = lo - 1; k <= hi + 1; k++) {
      const d = db[k];
      const m = Number.isFinite(d) ? Math.pow(10, d / 20) : 0;
      mag[k] = m;
      if (k >= lo && k <= hi) {
        sumSq += m * m;
        if (d > maxDb) maxDb = d;
      }
    }
    const energy = Math.sqrt(sumSq);
    if (energy < this.opts.noiseFloor || !Number.isFinite(maxDb)) return { chroma: null, bass: null, energy, peakDb: maxDb };

    const chroma = new Float32Array(12);
    const bass = new Float32Array(12);
    const minDb = Math.max(this.opts.minPeakDb, maxDb - this.opts.peakRangeDb);
    for (let k = lo; k <= hi; k++) {
      const b = db[k];
      if (!(b > minDb) || !(mag[k] > mag[k - 1]) || !(mag[k] >= mag[k + 1])) continue;
      const a = clampDb(db[k - 1]);
      const c = clampDb(db[k + 1]);
      const denom = a - 2 * b + c;
      const p = denom < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
      const f = (k + p) * this.binHz;
      const pc = ((Math.round(hzToMidi(f)) % 12) + 12) % 12;
      chroma[pc] += mag[k] * frequencyWeight(f);
      if (f < this.opts.bassMaxHz) bass[pc] += mag[k];
    }
    if (!normalizeInPlace(chroma)) return { chroma: null, bass: null, energy, peakDb: maxDb };
    return { chroma, bass: normalizeInPlace(bass) ? bass : null, energy, peakDb: maxDb };
  }
}

const clampDb = (d: number): number => (Number.isFinite(d) ? d : -200);

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
