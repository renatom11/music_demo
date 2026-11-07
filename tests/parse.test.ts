import { describe, expect, it } from 'vitest';
import { ParseError, parseSong, serializeSong, slugify } from '../src/song/parse';
import type { Song } from '../src/song/types';
import { BEING_ALIVE_TEXT, beingAlive } from '../src/song/songs/being-alive';

const TEXT = `title: Being Alive
artist: Eleri Ward (Stephen Sondheim)
key: G
bpm: 76

[Intro]
G Em | G Em

[Verse x3]
G Em
G:2 Em:2
Bm Em C   # build
Am D
`;

const EXPECTED: Song = {
  id: 'being-alive',
  title: 'Being Alive',
  artist: 'Eleri Ward (Stephen Sondheim)',
  key: 'G',
  bpm: 76,
  sections: [
    { name: 'Intro', lines: [{ chords: [{ chord: 'G' }, { chord: 'Em' }, { chord: 'G' }, { chord: 'Em' }] }] },
    {
      name: 'Verse',
      repeat: 3,
      lines: [
        { chords: [{ chord: 'G' }, { chord: 'Em' }] },
        { chords: [{ chord: 'G', beats: 2 }, { chord: 'Em', beats: 2 }] },
        { label: 'build', chords: [{ chord: 'Bm' }, { chord: 'Em' }, { chord: 'C' }] },
        { chords: [{ chord: 'Am' }, { chord: 'D' }] },
      ],
    },
  ],
};

describe('parseSong', () => {
  it('parses the text format, including x3 and :2', () => {
    expect(parseSong(TEXT)).toStrictEqual(EXPECTED);
  });

  it('round-trips through serializeSong', () => {
    expect(parseSong(serializeSong(EXPECTED))).toStrictEqual(EXPECTED);
    expect(parseSong(serializeSong(beingAlive))).toStrictEqual({ ...beingAlive, id: 'being-alive' });
  });

  it('parses the demo song', () => {
    const s = parseSong(BEING_ALIVE_TEXT);
    expect(s.sections.map((x) => x.name)).toEqual(['Intro', 'Verse']);
    expect(s.sections[1].repeat).toBe(3);
    expect(s.sources).toHaveLength(2);
  });

  it('handles sharps, slash chords, capo, sources and missing sections', () => {
    const s = parseSong('title: X\ncapo: 2\nsource: a\nsource: b\nF#m D/F# Bb Cmaj7 Asus4 # tag\n');
    expect(s.capo).toBe(2);
    expect(s.sources).toEqual(['a', 'b']);
    expect(s.sections).toEqual([
      {
        name: 'Song',
        lines: [{ label: 'tag', chords: ['F#m', 'D/F#', 'Bb', 'Cmaj7', 'Asus4'].map((chord) => ({ chord })) }],
      },
    ]);
  });

  it('treats a header-like chord token inside a section as a chord', () => {
    const s = parseSong('title: X\n[A]\nG:2 C\n');
    expect(s.sections[0].lines[0].chords).toEqual([{ chord: 'G', beats: 2 }, { chord: 'C' }]);
  });

  it('reports errors with line numbers', () => {
    expect(() => parseSong('title: X\n[A]\nG Hm\n')).toThrow(ParseError);
    expect(() => parseSong('title: X\n[A]\nG Hm\n')).toThrow(/Line 3/);
    expect(() => parseSong('[A]\nG\n')).toThrow(/title/);
    expect(() => parseSong('title: X\n')).toThrow(/no chords/);
    expect(() => parseSong('title: X\nbpm: fast\nG')).toThrow(/bpm/);
  });

  it('slugifies titles', () => {
    expect(slugify('Being Alive!')).toBe('being-alive');
    expect(slugify('???')).toBe('song');
  });
});
