/**
 * Per-frame glue: analyser frame → chroma (+EMA) → onsets → follower.
 * Shared by the app and the tests so both run exactly the same path.
 */
import { ChromaExtractor, ChromaSmoother, DEFAULT_CHROMA_OPTIONS } from './chroma';
import { Follower, type FollowerFrame } from './follower';
import { DEFAULT_ONSET_OPTIONS, OnsetDetector, type Onset } from './onset';

export type PipelineFrame = FollowerFrame & {
  raw: Float32Array | null;
  chroma: Float32Array | null;
  energy: number;
  onset: Onset | null;
  lastOnset: Onset | null;
};

export class ChordPipeline {
  readonly chroma: ChromaExtractor;
  readonly smoother: ChromaSmoother;
  readonly bassSmoother: ChromaSmoother;
  readonly onsets: OnsetDetector;
  private pendingOnset: Onset | null = null;

  constructor(readonly follower: Follower, sampleRate: number, fftSize: number, sensitivity = 0.5) {
    this.chroma = new ChromaExtractor(sampleRate, fftSize);
    this.smoother = new ChromaSmoother(0.4);
    this.bassSmoother = new ChromaSmoother(0.4);
    this.onsets = new OnsetDetector(sampleRate, fftSize);
    this.setSensitivity(sensitivity);
  }

  /** 0 = only react to clear, loud playing; 1 = react to quiet/soft playing quickly. */
  setSensitivity(s: number): void {
    const x = Math.max(0, Math.min(1, s));
    this.follower.setSensitivity(x);
    this.onsets.opts.k = 1.3 + 1.4 * (1 - x);
    this.onsets.opts.minFlux = DEFAULT_ONSET_OPTIONS.minFlux * Math.pow(4, 0.5 - x);
    this.chroma.setNoiseFloor(DEFAULT_CHROMA_OPTIONS.noiseFloor * Math.pow(4, 0.5 - x));
  }

  reset(): void {
    this.smoother.reset();
    this.bassSmoother.reset();
    this.onsets.reset();
    this.pendingOnset = null;
  }

  process(db: Float32Array, now: number): PipelineFrame {
    const c = this.chroma.compute(db);
    const chroma = this.smoother.push(c.chroma);
    const bass = this.bassSmoother.push(c.bass);
    const onset = this.onsets.process(db, now);
    // Strums (new energy across ≥2–3 pitch classes) gate chord changes fully; single
    // notes (picking, or a sung note) count less; nothing while silent.
    if (onset && c.chroma) this.follower.onset(now, onsetStrength(onset));
    else if (this.onsets.lastOnset && this.pendingOnset === this.onsets.lastOnset) {
      this.follower.refineOnset(onsetStrength(this.onsets.lastOnset));
      if (this.onsets.lastOnset.settled) this.pendingOnset = null;
    }
    if (onset && c.chroma) this.pendingOnset = onset;
    const f = this.follower.update(chroma, now, chroma ? bass : null);
    return { ...f, raw: c.chroma, chroma, energy: c.energy, onset, lastOnset: this.onsets.lastOnset };
  }
}

export const onsetStrength = (o: Pick<Onset, 'spread' | 'mono'>): number =>
  o.mono ? 0.35 : o.spread >= 3 ? 1 : o.spread === 2 ? 0.8 : 0.35;
