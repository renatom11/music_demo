import { describe, expect, it } from 'vitest';
import { flattenSong } from '../src/song/flatten';
import { beingAlive } from '../src/song/songs/being-alive';
import { parseSong } from '../src/song/parse';

describe('flattenSong', () => {
  it('unrolls repeats of the demo song', () => {
    const f = flattenSong(beingAlive);
    // Intro (4) + Verse (2+2+3+2) x3
    expect(f.chords).toHaveLength(4 + 9 * 3);
    expect(f.lines).toHaveLength(1 + 4 * 3);
    expect(f.lines[1]).toMatchObject({ sectionName: 'Verse', pass: 0, passes: 3, sectionStart: true, start: 4 });
    expect(f.lines[5]).toMatchObject({ pass: 1, sectionStart: true, start: 13 });
    expect(f.chords[4]).toEqual({ chord: 'G', beats: 4, lineIndex: 1, posInLine: 0 });
  });

  it('keeps explicit beats and skips empty lines', () => {
    const f = flattenSong(parseSong('title: X\n[A]\nG:2 C\n# just a note\nD\n'));
    expect(f.chords.map((c) => c.beats)).toEqual([2, 4, 4]);
    expect(f.lines).toHaveLength(2);
  });
});
