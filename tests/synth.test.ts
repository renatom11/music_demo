import { describe, expect, it } from 'vitest';
import { chordVoicing, midiToHz, mix, renderNotes, renderSweep, strum } from '../src/audio/synth';

describe('synth', () => {
  it('voices chords from the shape dictionary, or a close voicing', () => {
    expect(chordVoicing('G')).toEqual([43, 47, 50, 55, 59, 67]);
    expect(chordVoicing('C#dim').length).toBeGreaterThanOrEqual(3);
    expect(chordVoicing('nope')).toEqual([]);
    expect(midiToHz(69)).toBe(440);
  });

  it('renders decaying, damped notes', () => {
    const sig = renderNotes([{ midi: 57, start: 0, duration: 0.5 }], 8000, 1);
    const rms = (a: number, b: number) => Math.sqrt(sig.slice(a, b).reduce((s, x) => s + x * x, 0) / (b - a));
    expect(rms(0, 800)).toBeGreaterThan(rms(2400, 3200));
    expect(rms(5000, 8000)).toBe(0);
  });

  it('strums low to high with small offsets', () => {
    const s = strum('Em', 1);
    expect(s).toHaveLength(6);
    expect(s[5].start).toBeGreaterThan(s[0].start);
  });

  it('sweeps and mixes', () => {
    const a = renderSweep(8000, 1, 200, 400, 0.5);
    expect(Math.max(...a)).toBeLessThanOrEqual(0.5);
    const m = mix(a, new Float32Array(10).fill(1));
    expect(m.length).toBe(a.length);
    expect(m[0]).toBe(a[0] + 1);
  });
});
