import { DEFAULT_BEATS, type ChordEvent, type Song } from './types';

/** One chord position in the fully expanded (repeats unrolled) song. */
export type FlatChord = {
  chord: string;
  beats: number;
  lineIndex: number;
  posInLine: number;
};

/** One rendered line in the expanded song. */
export type FlatLine = {
  sectionIndex: number;
  sectionName: string;
  /** 0-based repeat pass, and total passes, for "Verse (2/3)" display. */
  pass: number;
  passes: number;
  /** true for the first line of a section pass — a likely place to restart from. */
  sectionStart: boolean;
  label?: string;
  chords: ChordEvent[];
  /** Index into FlatSong.chords of this line's first chord. */
  start: number;
};

export type FlatSong = { chords: FlatChord[]; lines: FlatLine[] };

export function flattenSong(song: Song): FlatSong {
  const chords: FlatChord[] = [];
  const lines: FlatLine[] = [];
  song.sections.forEach((sec, sectionIndex) => {
    const passes = Math.max(1, sec.repeat ?? 1);
    for (let pass = 0; pass < passes; pass++) {
      let first = true;
      for (const line of sec.lines) {
        if (!line.chords.length) continue;
        const lineIndex = lines.length;
        lines.push({
          sectionIndex,
          sectionName: sec.name,
          pass,
          passes,
          sectionStart: first,
          label: line.label,
          chords: line.chords,
          start: chords.length,
        });
        first = false;
        line.chords.forEach((c, posInLine) =>
          chords.push({ chord: c.chord, beats: c.beats ?? DEFAULT_BEATS, lineIndex, posInLine }),
        );
      }
    }
  });
  return { chords, lines };
}
