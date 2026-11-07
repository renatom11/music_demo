/**
 * Plucked-string synthesizer used by the unit tests and by /test.html.
 * Each note = fundamental + 4 harmonics with exponential decay.
 */
import { chordPitchClasses } from './chords';
import { getShape, shapeMidi } from '../song/shapes';

export type SynthNote = {
  midi: number;
  /** seconds */
  start: number;
  /** seconds until the note is damped (default: rings to the end) */
  duration?: number;
  amp?: number;
};

export type SynthOptions = {
  harmonics?: number;
  /** decay time constant of the fundamental, seconds */
  decay?: number;
};

export const midiToHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** A guitar voicing for a chord: the shape dictionary if known, else a close voicing around C3. */
export function chordVoicing(name: string): number[] {
  const shape = getShape(name);
  if (shape) return shapeMidi(shape);
  const pcs = chordPitchClasses(name);
  if (!pcs.length) return [];
  const root = 48 + pcs[0] - (pcs[0] > 5 ? 12 : 0);
  return [root, ...pcs.slice(1).map((pc) => root + ((pc - pcs[0] + 12) % 12)), root + 12];
}

/** Notes of a downstrum of `name` starting at `start` seconds (strings ~12 ms apart). */
export function strum(name: string, start: number, duration?: number, amp = 0.12): SynthNote[] {
  return chordVoicing(name).map((midi, i) => ({ midi, start: start + i * 0.012, duration, amp }));
}

/** Render notes into a mono buffer. */
export function renderNotes(
  notes: SynthNote[],
  sampleRate: number,
  totalSeconds: number,
  opts: SynthOptions = {},
): Float32Array {
  const harmonics = opts.harmonics ?? 5;
  const decay = opts.decay ?? 1.6;
  const out = new Float32Array(Math.ceil(totalSeconds * sampleRate));
  for (const n of notes) {
    const f0 = midiToHz(n.midi);
    const amp = n.amp ?? 0.12;
    const s0 = Math.floor(n.start * sampleRate);
    const end = Math.min(out.length, n.duration !== undefined ? Math.floor((n.start + n.duration + 0.04) * sampleRate) : out.length);
    const damp = n.duration !== undefined ? n.start + n.duration : Infinity;
    for (let h = 1; h <= harmonics; h++) {
      const f = f0 * h;
      if (f > sampleRate / 2) break;
      const hAmp = amp / h;
      const tau = decay / Math.sqrt(h);
      const w = (2 * Math.PI * f) / sampleRate;
      for (let i = Math.max(0, s0); i < end; i++) {
        const t = (i - s0) / sampleRate;
        const abs = i / sampleRate;
        let env = Math.exp(-t / tau) * Math.min(1, t / 0.004);
        if (abs > damp) env *= Math.max(0, 1 - (abs - damp) / 0.04);
        out[i] += hAmp * env * Math.sin(w * (i - s0));
      }
    }
  }
  return out;
}

/** A pure sine glide (voice-like) from f1 to f2 Hz. */
export function renderSweep(
  sampleRate: number,
  totalSeconds: number,
  f1: number,
  f2: number,
  amp = 0.2,
  start = 0,
  duration = totalSeconds - start,
): Float32Array {
  const out = new Float32Array(Math.ceil(totalSeconds * sampleRate));
  let phase = 0;
  const s0 = Math.floor(start * sampleRate);
  const s1 = Math.min(out.length, Math.floor((start + duration) * sampleRate));
  for (let i = s0; i < s1; i++) {
    const u = (i - s0) / (s1 - s0);
    const f = f1 * Math.pow(f2 / f1, u); // exponential glide, like a sung line
    phase += (2 * Math.PI * f) / sampleRate;
    const env = Math.min(1, (i - s0) / (0.05 * sampleRate), (s1 - i) / (0.05 * sampleRate));
    out[i] = amp * env * Math.sin(phase);
  }
  return out;
}

export function mix(...bufs: Float32Array[]): Float32Array {
  const out = new Float32Array(Math.max(...bufs.map((b) => b.length)));
  for (const b of bufs) for (let i = 0; i < b.length; i++) out[i] += b[i];
  return out;
}
