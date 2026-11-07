/**
 * Spectral-flux onset detector with an adaptive (median × k) threshold.
 * Also reports how many pitch classes the new energy is spread over
 * ("spread"): a strum excites 3+, a sung note or picked string 1–2.
 */
import { hzToMidi } from './chroma';

export type OnsetOptions = {
  minHz: number;
  maxHz: number;
  /** history length for the median, ms */
  windowMs: number;
  /** threshold multiplier on the median flux */
  k: number;
  /** absolute minimum flux (analyser linear-magnitude units) */
  minFlux: number;
  refractoryMs: number;
  /** pitch classes ≥ this fraction of the strongest count toward `spread` */
  spreadRel: number;
  /**
   * Masking after a big attack: flux must exceed `peakRel` × a decaying envelope
   * of recent flux (time constant `peakDecayMs`). The 170 ms analyser window makes
   * one strum produce several rising frames; this keeps it to one onset.
   */
  peakRel: number;
  peakDecayMs: number;
  /** flux must also be ≥ this fraction of the previous frame's total magnitude */
  levelRel: number;
  /** spread is accumulated over this many frames after the onset (attack + settle) */
  spreadFrames: number;
};

export const DEFAULT_ONSET_OPTIONS: OnsetOptions = {
  minHz: 80,
  maxHz: 4000,
  windowMs: 1000,
  k: 2,
  minFlux: 0.004,
  refractoryMs: 150,
  spreadRel: 0.2,
  peakRel: 0.3,
  peakDecayMs: 200,
  levelRel: 0.06,
  spreadFrames: 3,
};

/**
 * `spread` is refined during the `spreadFrames` frames after detection (the
 * same object is updated in place); `settled` turns true once it is final.
 */
export type Onset = {
  time: number;
  flux: number;
  threshold: number;
  spread: number;
  /** true when the new energy is one harmonic series (a sung or single plucked note) */
  mono: boolean;
  settled: boolean;
};

export class OnsetDetector {
  readonly opts: OnsetOptions;
  lastOnset: Onset | null = null;
  /** flux of the most recent frame (for debugging) */
  lastFlux = 0;
  private prev: Float32Array | null = null;
  private prevLevel = 0;
  private envelope = 0;
  private lastTime: number | null = null;
  private spreadAcc: Float32Array | null = null;
  private peakAcc = new Map<number, number>(); // bin -> accumulated flux at peaks
  private spreadLeft = 0;
  private history: { t: number; flux: number }[] = [];
  private lo: number;
  private hi: number;
  private pcOfBin: Int8Array;

  constructor(readonly sampleRate: number, readonly fftSize: number, opts: Partial<OnsetOptions> = {}) {
    this.opts = { ...DEFAULT_ONSET_OPTIONS, ...opts };
    const binHz = sampleRate / fftSize;
    this.lo = Math.max(1, Math.ceil(this.opts.minHz / binHz));
    this.hi = Math.min(fftSize / 2 - 1, Math.floor(this.opts.maxHz / binHz));
    this.pcOfBin = new Int8Array(fftSize / 2).fill(-1);
    for (let k = this.lo; k <= this.hi; k++) {
      const f = k * binHz;
      if (f <= 2000) this.pcOfBin[k] = ((Math.round(hzToMidi(f)) % 12) + 12) % 12;
    }
  }

  reset(): void {
    this.prev = null;
    this.prevLevel = 0;
    this.envelope = 0;
    this.lastTime = null;
    this.spreadAcc = null;
    this.peakAcc.clear();
    this.spreadLeft = 0;
    this.history = [];
    this.lastOnset = null;
    this.lastFlux = 0;
  }

  /** Feed one analyser frame (dB). Returns an onset if one starts at this frame. */
  process(db: Float32Array, time: number): Onset | null {
    const n = this.hi - this.lo + 1;
    const mag = new Float32Array(n);
    let level = 0;
    for (let i = 0; i < n; i++) {
      const d = db[this.lo + i];
      mag[i] = Number.isFinite(d) ? Math.pow(10, d / 20) : 0;
      level += mag[i];
    }
    const prev = this.prev;
    const prevLevel = this.prevLevel;
    const dt = this.lastTime === null ? 40 : time - this.lastTime;
    this.prev = mag;
    this.prevLevel = level;
    this.lastTime = time;
    if (!prev) return null;

    let flux = 0;
    let maxMag = 0;
    for (let i = 0; i < n; i++) if (mag[i] > maxMag) maxMag = mag[i];
    const peakFloor = maxMag * 0.006; // ~ -45 dB
    const pcFlux = new Float32Array(12);
    const peaks: [bin: number, flux: number][] = [];
    for (let i = 0; i < n; i++) {
      const d = mag[i] - prev[i];
      if (d > 0) {
        flux += d;
        // Spread only counts growth at spectral peaks (actual partials), so the
        // broadband click of an attack doesn't look like a 12-note chord.
        const pc = this.pcOfBin[this.lo + i];
        const isPeak = i > 0 && i < n - 1 && mag[i] > mag[i - 1] && mag[i] >= mag[i + 1] && mag[i] > peakFloor;
        if (pc >= 0 && isPeak) {
          pcFlux[pc] += d;
          peaks.push([this.lo + i, d]);
        }
      }
    }
    this.lastFlux = flux;

    const { windowMs, k, minFlux, refractoryMs, spreadRel, peakRel, peakDecayMs, levelRel } = this.opts;
    const envelope = this.envelope * Math.exp(-Math.max(0, dt) / peakDecayMs);
    this.envelope = Math.max(envelope, flux);
    const threshold = Math.max(
      minFlux,
      median(this.history.map((h) => h.flux)) * k,
      envelope * peakRel,
      prevLevel * levelRel,
    );
    this.history.push({ t: time, flux });
    while (this.history.length && this.history[0].t < time - windowMs) this.history.shift();

    // Keep refining the spread of the previous onset while it settles.
    if (this.spreadAcc && this.lastOnset && this.spreadLeft > 0) {
      for (let i = 0; i < 12; i++) this.spreadAcc[i] += pcFlux[i];
      this.lastOnset.spread = countSpread(this.spreadAcc, spreadRel);
      addPeaks(this.peakAcc, peaks);
      this.lastOnset.mono = isMonophonic(this.peakAcc);
      if (--this.spreadLeft === 0) this.lastOnset.settled = true;
    }

    if (flux <= threshold) return null;
    if (this.lastOnset && time - this.lastOnset.time < refractoryMs) return null;
    if (this.lastOnset) this.lastOnset.settled = true;
    this.spreadAcc = Float32Array.from(pcFlux);
    this.peakAcc.clear();
    addPeaks(this.peakAcc, peaks);
    this.spreadLeft = this.opts.spreadFrames;
    const onset: Onset = {
      time, flux, threshold,
      spread: countSpread(pcFlux, spreadRel),
      mono: isMonophonic(this.peakAcc),
      settled: this.spreadLeft === 0,
    };
    this.lastOnset = onset;
    return onset;
  }
}

function addPeaks(acc: Map<number, number>, peaks: [number, number][]): void {
  for (const [bin, f] of peaks) acc.set(bin, (acc.get(bin) ?? 0) + f);
}

/**
 * Can ≥85% of the new peak energy be explained by a single fundamental and
 * its harmonics? Voices (and single picked notes) yes; strums no.
 */
export function isMonophonic(acc: Map<number, number>): boolean {
  const peaks = [...acc].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (peaks.length < 2) return true;
  const total = peaks.reduce((s, p) => s + p[1], 0);
  const lowest = [...peaks].sort((a, b) => a[0] - b[0]).slice(0, 3);
  let best = 0;
  for (const [b0] of lowest) {
    for (const div of [1]) {
      const f0 = b0 / div;
      if (f0 < 1) continue;
      let explained = 0;
      for (const [b, f] of peaks) {
        const h = b / f0;
        const nearest = Math.round(h);
        // ±3% plus one bin of slack for low notes
        if (nearest >= 1 && Math.abs(b - nearest * f0) <= Math.max(1.01, 0.03 * b)) explained += f;
      }
      best = Math.max(best, explained / total);
    }
  }
  return best >= 0.85;
}

function countSpread(pcFlux: Float32Array, rel: number): number {
  let max = 0;
  for (const v of pcFlux) max = Math.max(max, v);
  let n = 0;
  if (max > 0) for (const v of pcFlux) if (v >= rel * max) n++;
  return n;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
