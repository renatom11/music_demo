import { describe, expect, it } from 'vitest';
import { ChromaExtractor } from '../src/audio/chroma';
import { rankAll } from '../src/audio/chords';
import { mix, renderNotes, strum } from '../src/audio/synth';
import { framesOf } from './helpers/analyser';
import { hum } from './helpers/noise';
import { chordsOf, run } from './helpers/run';
import { FFT, SR, performance } from './helpers/synthetic';

/** Chord heard at time `atMs` when `sig` is analysed frame by frame from the start. */
function chordAt(sig: Float32Array, atMs: number): { name: string | null; ex: ChromaExtractor } {
  const ex = new ChromaExtractor(SR, FFT);
  let name: string | null = null;
  for (const f of framesOf(sig, SR, FFT, 40)) {
    const r = ex.compute(f.db);
    if (Math.abs(f.time - atMs) < 20) name = r.chroma ? rankAll(r.chroma, 1)[0].name : null;
  }
  return { name, ex };
}

describe('background (mains hum) removal', () => {
  it('without it, 60 Hz hum alone looks like B minor — the reason for this feature', () => {
    const ex = new ChromaExtractor(SR, FFT, { background: false });
    const frames = [...framesOf(hum(1, 0.005), SR, FFT, 40)];
    expect(rankAll(ex.compute(frames[frames.length - 1].db).chroma!, 1)[0].name).toBe('Bm');
  });

  it('learns steady hum within ~1.5 s and then treats it as silence', () => {
    const { name, ex } = chordAt(hum(3, 0.005), 2800);
    expect(name).toBeNull();
    const freqs = ex.backgroundTones().map((t) => t.freq);
    expect(freqs.some((f) => Math.abs(f - 180) < 8)).toBe(true);
    expect(freqs.some((f) => Math.abs(f - 300) < 8)).toBe(true);
  });

  it('is not ready (and reports silence) while learning', () => {
    const ex = new ChromaExtractor(SR, FFT);
    const [first] = framesOf(renderNotes(strum('G', 0), SR, 0.5), SR, FFT, 40);
    expect(ex.ready).toBe(false);
    expect(ex.compute(first.db).silent).toBe(true);
    ex.resetNoise();
    expect(ex.ready).toBe(false);
  });

  it.each(['Em', 'G', 'C', 'D', 'Bm'])('a quiet %s strum over hum is still heard as %s', (chord) => {
    const sig = mix(hum(5, 0.005), renderNotes(strum(chord, 3, undefined, 0.01), SR, 5));
    expect(chordAt(sig, 3400).name).toBe(chord);
    expect(chordAt(sig, 4600).name).toBe(chord);
  });

  it('a ringing guitar chord is never mistaken for background', () => {
    const sig = renderNotes(strum('Em', 2, undefined, 0.05), SR, 5);
    expect(chordAt(sig, 4800).name).toBe('Em');
  });

  it.each([0.002, 0.005, 0.01])('the follower ignores hum (amp %s): quiet progression, 8 clean advances', (amp) => {
    const PROG = ['G', 'Em', 'G', 'Em', 'Bm', 'Em', 'C', 'Am', 'D'];
    const body = performance(PROG.map((chord, i) => ({ chord, at: 0.5 + i * 2.4 })), 0.5 + PROG.length * 2.4 + 1);
    const quiet = body.map((x) => x * 0.25);
    const { events, follower } = run(chordsOf(PROG), mix(quiet, hum(quiet.length / SR + 2, amp)), { bpm: 100 });
    expect(events.map((e) => e.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(follower.index).toBe(8);
  });
});
