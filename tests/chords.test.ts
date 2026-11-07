import { describe, expect, it } from 'vitest';
import {
  chordKey, chordPitchClasses, chordTemplate, cosine, parseChordName, rankAll, sameChord, scoreChord,
} from '../src/audio/chords';
import { ChromaExtractor } from '../src/audio/chroma';
import { FFT, SR, strumFrame } from './helpers/synthetic';

const ex = new ChromaExtractor(SR, FFT, { background: false });

describe('chord name parser', () => {
  it.each([
    ['G', [7, 11, 2]], ['Em', [4, 7, 11]], ['Bm', [11, 2, 6]], ['C', [0, 4, 7]], ['Am', [9, 0, 4]],
    ['D', [2, 6, 9]], ['F#m', [6, 9, 1]], ['Bb', [10, 2, 5]], ['Cmaj7', [0, 4, 7, 11]], ['Asus4', [9, 2, 4]],
    ['D/F#', [2, 6, 9]], ['G/B', [7, 11, 2]], ['E7', [4, 8, 11, 2]], ['Am7', [9, 0, 4, 7]], ['Bdim', [11, 2, 5]],
    ['Dsus2', [2, 4, 9]],
  ])('%s', (name, pcs) => {
    expect(new Set(chordPitchClasses(name))).toEqual(new Set(pcs));
  });

  it('adds a slash bass as an extra weighted note', () => {
    const p = parseChordName('C/B')!;
    expect(p.bass).toBe(11);
    expect(p.notes.get(11)).toBe(0.8);
    expect(p.notes.get(0)).toBe(1);
  });

  it('rejects junk and normalises aliases/enharmonics', () => {
    expect(parseChordName('H')).toBeNull();
    expect(parseChordName('Gzz')).toBeNull();
    expect(parseChordName('G/X')).toBeNull();
    expect(chordKey('A#')).toBe(chordKey('Bb'));
    expect(sameChord('Gmaj', 'G')).toBe(true);
    expect(sameChord('Amin', 'Am')).toBe(true);
    expect(sameChord('G', 'Em')).toBe(false);
    expect(sameChord('Hm', 'Hm')).toBe(false);
  });

  it('builds unit templates with root > third/fifth > seventh', () => {
    const t = chordTemplate('G7')!;
    expect(Math.hypot(...t)).toBeCloseTo(1, 5);
    expect(t[7]).toBeGreaterThan(t[11]);
    expect(t[11]).toBeGreaterThan(t[5]);
    expect(chordTemplate('Q')).toBeNull();
    expect(scoreChord(t, 'Q')).toBe(0);
    expect(cosine(t, t)).toBeCloseTo(1, 5);
  });
});

describe('chord recognition from synthesized strums', () => {
  it.each(['G', 'Em', 'Bm', 'C', 'Am', 'D', 'A', 'E', 'Dm', 'F'])('%s ranks #1 for its own strum', (name) => {
    const { chroma } = ex.compute(strumFrame(name));
    const ranked = rankAll(chroma!);
    expect(ranked[0].name).toBe(name);
    expect(ranked[0].score).toBeGreaterThan(0.85);
  });

  it('still recognises a decaying strum after 2 s', () => {
    for (const name of ['G', 'Em', 'C', 'D']) {
      const { chroma } = ex.compute(strumFrame(name, 2));
      expect(rankAll(chroma!, 1)[0].name).toBe(name);
    }
  });

  it('G strum scores higher on G than on Em', () => {
    const { chroma } = ex.compute(strumFrame('G'));
    expect(scoreChord(chroma!, 'G') - scoreChord(chroma!, 'Em')).toBeGreaterThan(0.1);
  });

  it('rankAll covers 96 templates', () => {
    const { chroma } = ex.compute(strumFrame('G'));
    expect(rankAll(chroma!)).toHaveLength(96);
  });
});
