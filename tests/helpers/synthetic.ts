import { mix, renderNotes, renderSweep, strum, type SynthNote } from '../../src/audio/synth';
import { frameAt } from './analyser';

export const SR = 48000;
export const FFT = 8192;

/** Analyser frame of a single strummed chord, `t` seconds after the strum. */
export function strumFrame(chord: string, t = 0.3, amp = 0.12): Float32Array {
  const sig = renderNotes(strum(chord, 0, undefined, amp), SR, t + 0.05);
  return frameAt(sig, SR, t, FFT);
}

export type Hit = { chord: string; at: number };

/**
 * A performance: each hit strums `chord` at `at` seconds; the previous chord is
 * damped when the next one is strummed. Optional voice sweeps are mixed in.
 */
export function performance(hits: Hit[], total: number, extra: Float32Array[] = []): Float32Array {
  const notes: SynthNote[] = [];
  hits.forEach((h, i) => {
    const next = hits[i + 1]?.at;
    notes.push(...strum(h.chord, h.at, next !== undefined ? next - h.at - 0.01 : undefined));
  });
  return mix(renderNotes(notes, SR, total), ...extra);
}

export { renderSweep };
