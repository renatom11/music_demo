import { describe, expect, it } from 'vitest';
import { ChromaExtractor, ChromaSmoother, frequencyWeight, hzToMidi, polyphony } from '../src/audio/chroma';
import { NOTE_NAMES } from '../src/audio/chords';
import { renderNotes } from '../src/audio/synth';
import { frameAt } from './helpers/analyser';
import { FFT, SR, strumFrame } from './helpers/synthetic';

const top = (c: Float32Array, n: number) =>
  [...c].map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]).slice(0, n).map(([, i]) => NOTE_NAMES[i]);

describe('chroma', () => {
  const ex = new ChromaExtractor(SR, FFT);

  it('G major strum peaks on G, B, D', () => {
    const { chroma } = ex.compute(strumFrame('G'));
    expect(chroma).not.toBeNull();
    expect(top(chroma!, 3).sort()).toEqual(['B', 'D', 'G']);
  });

  it('Em strum peaks on E, G, B', () => {
    const { chroma } = ex.compute(strumFrame('Em'));
    expect(top(chroma!, 3).sort()).toEqual(['B', 'E', 'G']);
  });

  it('is L2-normalised', () => {
    const { chroma } = ex.compute(strumFrame('C'));
    const n = Math.hypot(...chroma!);
    expect(n).toBeCloseTo(1, 5);
  });

  it('resolves a low E2 (82 Hz) to E', () => {
    const sig = renderNotes([{ midi: 40, start: 0 }], SR, 0.4, { harmonics: 1 });
    const { chroma } = ex.compute(frameAt(sig, SR, 0.35));
    expect(top(chroma!, 1)).toEqual(['E']);
  });

  it('returns null for silence and very quiet noise', () => {
    const silent = new Float32Array(FFT / 2).fill(-Infinity);
    expect(ex.compute(silent).chroma).toBeNull();
    const noise = new Float32Array(SR);
    for (let i = 0; i < noise.length; i++) noise[i] = (Math.random() - 0.5) * 1e-4;
    expect(ex.compute(frameAt(noise, SR, 0.5)).chroma).toBeNull();
  });

  it('weights low frequencies higher and >1 kHz lower', () => {
    expect(frequencyWeight(80)).toBeGreaterThan(frequencyWeight(500));
    expect(frequencyWeight(500)).toBeGreaterThan(frequencyWeight(1500));
    expect(hzToMidi(440)).toBe(69);
  });
});

describe('ChromaSmoother', () => {
  it('moves gradually toward new frames and keeps unit norm', () => {
    const s = new ChromaSmoother(0.4);
    const a = new Float32Array(12); a[0] = 1;
    const b = new Float32Array(12); b[7] = 1;
    s.push(a);
    const out = s.push(b)!;
    expect(out[0]).toBeGreaterThan(out[7]); // 0.6 vs 0.4
    expect(Math.hypot(...out)).toBeCloseTo(1, 5);
    expect(s.push(null)).toBeNull();
    s.reset();
    expect(s.push(b)![7]).toBeCloseTo(1);
  });
});

describe('polyphony', () => {
  it('counts pitch classes above 35% of max', () => {
    expect(polyphony([1, 0, 0, 0, 0.9, 0, 0, 0.8, 0, 0, 0, 0])).toBe(3);
    expect(polyphony([1, 0, 0, 0, 0.2, 0, 0, 0.3, 0, 0, 0, 0])).toBe(1);
    expect(polyphony(new Array(12).fill(0))).toBe(0);
  });
});
