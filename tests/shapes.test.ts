import { describe, expect, it } from 'vitest';
import { SHAPES, getShape, shapeMidi } from '../src/song/shapes';
import { chordPitchClasses } from '../src/audio/chords';

describe('chord shapes', () => {
  it('every shape only sounds notes of its chord', () => {
    for (const [name, shapes] of Object.entries(SHAPES)) {
      const pcs = new Set(chordPitchClasses(name));
      expect(pcs.size, name).toBeGreaterThan(0);
      for (const s of shapes) {
        expect(s.frets, name).toHaveLength(6);
        for (const m of shapeMidi(s)) expect(pcs.has(m % 12), `${name}: ${m}`).toBe(true);
      }
    }
  });

  it('has the required open chords, barre + easy alternates', () => {
    for (const n of ['G', 'C', 'D', 'A', 'E', 'Am', 'Em', 'Dm', 'Bm', 'F', 'G7', 'C7', 'D7', 'A7', 'E7', 'Am7', 'Em7', 'Dm7', 'Bm7'])
      expect(getShape(n), n).not.toBeNull();
    expect(getShape('Bm')!.barre).toBeDefined();
    expect(getShape('Bm', true)!.frets).toEqual([-1, -1, 4, 4, 3, 2]);
    expect(getShape('F', true)!.frets[0]).toBe(-1);
    expect(getShape('G', true)).not.toBeNull();
    expect(getShape('A#')).toEqual(getShape('Bb'));
    expect(getShape('C#m9')).toBeNull();
  });

  it('barres cover the strings they claim', () => {
    for (const [name, shapes] of Object.entries(SHAPES))
      for (const s of shapes)
        if (s.barre)
          for (let i = s.barre.fromString; i <= s.barre.toString; i++)
            expect(s.frets[i], `${name} string ${i}`).toBeGreaterThanOrEqual(s.barre.fret);
  });
});
