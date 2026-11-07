/** A single chord occurrence. `beats` defaults to 4 when omitted. */
export type ChordEvent = { chord: string; beats?: number };
/** One line of the chart. `label` is a user note — never lyrics. */
export type Line = { label?: string; chords: ChordEvent[] };
export type Section = { name: string; lines: Line[]; repeat?: number };
export type Song = {
  id: string;
  title: string;
  artist: string;
  key?: string;
  capo?: number;
  bpm?: number;
  sections: Section[];
  sources?: string[];
};

export const DEFAULT_BEATS = 4;
export const DEFAULT_BPM = 80;
