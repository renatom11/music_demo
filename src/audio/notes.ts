/**
 * Turn spectral peaks into the notes a listener would name ("G3, 196 Hz, −4¢")
 * and grade them against the chord that should be sounding.
 *
 * Each plucked string produces a fundamental plus overtones at 2×, 3×, 4×…
 * We walk the peaks from low to high and fold any peak that sits on an
 * overtone of an already-found note into that note, so a G chord shows as
 * G B D G B G rather than a dozen partials.
 */
import type { Peak } from './chroma';
import { NOTE_NAMES, chordPitchClasses } from './chords';

export type HeardNote = {
  freq: number;
  /** nearest MIDI note */
  midi: number;
  /** e.g. "G3" */
  name: string;
  pitchClass: number;
  /** deviation from equal temperament (A4 = 440 Hz), −50..+50 */
  cents: number;
  db: number;
  /** 0..1 relative to the loudest note */
  strength: number;
};

export type NoteGrade = 'good' | 'off' | 'wrong';

export type NoteOptions = {
  /** ignore peaks more than this many dB below the loudest */
  rangeDb: number;
  /** max notes returned */
  max: number;
  /** a peak within this many cents of an overtone of a found note is folded in */
  harmonicCents: number;
  /** highest overtone checked */
  maxHarmonic: number;
};

export const DEFAULT_NOTE_OPTIONS: NoteOptions = { rangeDb: 30, max: 8, harmonicCents: 30, maxHarmonic: 6 };

/** |cents| up to this is "in tune" (green); beyond it is out of tune (yellow). */
export const IN_TUNE_CENTS = 15;

export function midiName(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export function noteOf(freq: number): { midi: number; cents: number } {
  const exact = 69 + 12 * Math.log2(freq / 440);
  const midi = Math.round(exact);
  return { midi, cents: Math.round((exact - midi) * 100) };
}

const centsBetween = (a: number, b: number): number => 1200 * Math.log2(a / b);

export function detectNotes(peaks: Peak[], opts: Partial<NoteOptions> = {}): HeardNote[] {
  const o = { ...DEFAULT_NOTE_OPTIONS, ...opts };
  if (!peaks.length) return [];
  const loudest = Math.max(...peaks.map((p) => p.db));
  const candidates = peaks.filter((p) => p.db >= loudest - o.rangeDb).sort((a, b) => a.freq - b.freq);
  const found: { peak: Peak; db: number }[] = [];
  // Every peak seen so far — notes *and* overtones — can explain higher peaks:
  // an octave string folded into a lower note still has its own overtones.
  const partials: Peak[] = [];
  for (const p of candidates) {
    let overtone = false;
    for (const f of partials) {
      const h = Math.round(p.freq / f.freq);
      // An overtone that is much louder than what it sits on is more likely its own note.
      if (h >= 2 && h <= o.maxHarmonic && Math.abs(centsBetween(p.freq, h * f.freq)) <= o.harmonicCents && p.db <= f.db + 6) {
        overtone = true;
        break;
      }
    }
    partials.push(p);
    if (!overtone) found.push({ peak: p, db: p.db });
  }
  const strongest = found.sort((a, b) => b.db - a.db).slice(0, o.max);
  const top = strongest[0]?.db ?? 0;
  return strongest
    .map(({ peak }) => {
      const { midi, cents } = noteOf(peak.freq);
      return {
        freq: peak.freq,
        midi,
        name: midiName(midi),
        pitchClass: ((midi % 12) + 12) % 12,
        cents,
        db: peak.db,
        strength: Math.max(0, Math.min(1, 1 - (top - peak.db) / o.rangeDb)),
      };
    })
    .sort((a, b) => a.freq - b.freq);
}

/**
 * green  'good'  — a note of the expected chord, in tune
 * yellow 'off'   — a note of the expected chord, but more than IN_TUNE_CENTS out
 * red    'wrong' — not in the expected chord
 */
export function gradeNote(note: Pick<HeardNote, 'pitchClass' | 'cents'>, chord: string | undefined): NoteGrade {
  if (!chord) return 'wrong';
  const pcs = chordPitchClasses(chord);
  if (!pcs.includes(note.pitchClass)) return 'wrong';
  return Math.abs(note.cents) <= IN_TUNE_CENTS ? 'good' : 'off';
}
