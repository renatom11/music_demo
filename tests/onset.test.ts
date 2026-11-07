import { describe, expect, it } from 'vitest';
import { OnsetDetector, median, type Onset } from '../src/audio/onset';
import { renderNotes, renderSweep } from '../src/audio/synth';
import { framesOf } from './helpers/analyser';
import { FFT, SR, performance } from './helpers/synthetic';

function onsetsOf(sig: Float32Array, det = new OnsetDetector(SR, FFT)) {
  const out: Onset[] = [];
  for (const f of framesOf(sig, SR, FFT, 40)) {
    const o = det.process(f.db, f.time);
    if (o) out.push(o); // spread keeps being refined in place
  }
  return out.map((o) => ({ time: o.time, spread: o.spread }));
}

describe('onset detector', () => {
  it('a strum from silence spreads over 3+ pitch classes', () => {
    const det = new OnsetDetector(SR, FFT);
    const found = onsetsOf(performance([{ chord: 'G', at: 0.3 }], 1), det);
    expect(found).toHaveLength(1);
    expect(found[0].spread).toBeGreaterThanOrEqual(3);
    expect(det.lastOnset?.settled).toBe(true);
  });

  it('fires once per strum, shortly after it', () => {
    const strums = [0.3, 1.3, 2.3, 3.3];
    const sig = performance(strums.map((at, i) => ({ chord: i % 2 ? 'Em' : 'G', at })), 4.2);
    const found = onsetsOf(sig);
    expect(found).toHaveLength(strums.length);
    found.forEach((o, i) => {
      expect(o.time / 1000 - strums[i]).toBeGreaterThanOrEqual(0);
      expect(o.time / 1000 - strums[i]).toBeLessThan(0.15);
      // G → Em shares G and B, so the *new* energy covers ≥2 pitch classes.
      expect(o.spread).toBeGreaterThanOrEqual(2);
    });
  });

  it('a smooth sung glide gives only start-up onsets, never a chordal one', () => {
    const found = onsetsOf(renderSweep(SR, 3, 200, 600, 0.2, 0.2, 2.6));
    expect(found.length).toBeLessThanOrEqual(2); // fade-in only
    expect(found.filter((o) => o.time > 600)).toEqual([]);
    expect(found.every((o) => o.spread <= 2)).toBe(true);
  });

  it('a single plucked note has a narrow spread', () => {
    const found = onsetsOf(renderNotes([{ midi: 57, start: 0.5, amp: 0.2 }], SR, 1.2));
    expect(found).toHaveLength(1);
    expect(found[0].spread).toBeLessThanOrEqual(2);
  });

  it('ignores silence and respects the refractory period', () => {
    const det = new OnsetDetector(SR, FFT, { refractoryMs: 500 });
    const silent = new Float32Array(FFT / 2).fill(-Infinity);
    expect(det.process(silent, 0)).toBeNull();
    expect(det.process(silent, 40)).toBeNull();
    const loud = new Float32Array(FFT / 2).fill(-20);
    expect(det.process(loud, 80)).not.toBeNull();
    expect(det.process(silent, 120)).toBeNull();
    expect(det.process(loud, 160)).toBeNull(); // within 500 ms
    expect(det.lastOnset?.time).toBe(80);
    det.reset();
    expect(det.lastOnset).toBeNull();
  });

  it('median', () => {
    expect(median([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});
