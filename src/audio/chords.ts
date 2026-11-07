/** Chord templates and scoring against 12-bin chroma vectors. */

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

type Interval = [semitones: number, weight: number];

const TRIAD: Interval[] = [[0, 1], [4, 0.9], [7, 0.9]];
const MINOR: Interval[] = [[0, 1], [3, 0.9], [7, 0.9]];

/** Quality suffix -> weighted intervals. Root 1.0, third/fifth 0.9, 7ths 0.7. */
const QUALITIES: Record<string, Interval[]> = {
  '': TRIAD,
  m: MINOR,
  '7': [...TRIAD, [10, 0.7]],
  maj7: [...TRIAD, [11, 0.7]],
  m7: [...MINOR, [10, 0.7]],
  sus2: [[0, 1], [2, 0.9], [7, 0.9]],
  sus4: [[0, 1], [5, 0.9], [7, 0.9]],
  dim: [[0, 1], [3, 0.9], [6, 0.9]],
  // Extras that show up in community charts.
  '5': [[0, 1], [7, 0.9]],
  aug: [[0, 1], [4, 0.9], [8, 0.9]],
  '6': [...TRIAD, [9, 0.7]],
  m6: [...MINOR, [9, 0.7]],
  add9: [...TRIAD, [2, 0.7]],
  madd9: [...MINOR, [2, 0.7]],
  '9': [...TRIAD, [10, 0.7], [2, 0.6]],
  m9: [...MINOR, [10, 0.7], [2, 0.6]],
  maj9: [...TRIAD, [11, 0.7], [2, 0.6]],
  '7sus4': [[0, 1], [5, 0.9], [7, 0.9], [10, 0.7]],
  dim7: [[0, 1], [3, 0.9], [6, 0.9], [9, 0.7]],
  m7b5: [[0, 1], [3, 0.9], [6, 0.9], [10, 0.7]],
};

const ALIASES: Record<string, string> = {
  min: 'm', '-': 'm', mi: 'm', M: '', maj: '', M7: 'maj7', 'Δ': 'maj7', 'Δ7': 'maj7', ma7: 'maj7',
  min7: 'm7', '-7': 'm7', sus: 'sus4', '+': 'aug', '°': 'dim', o: 'dim', ø: 'm7b5', '2': 'sus2',
  add2: 'add9', '4': 'sus4',
};

/** The qualities used for "what chord is this?" ranking (debug panel). */
export const RANK_QUALITIES = ['', 'm', '7', 'maj7', 'm7', 'sus2', 'sus4', 'dim'] as const;

export type ParsedChord = {
  root: number;
  quality: string;
  bass?: number;
  /** pitch class -> weight */
  notes: Map<number, number>;
};

function parsePitch(s: string): number | null {
  const m = /^([A-G])([#b♯♭]?)$/.exec(s);
  if (!m) return null;
  let pc = LETTER_PC[m[1]];
  if (m[2] === '#' || m[2] === '♯') pc += 1;
  if (m[2] === 'b' || m[2] === '♭') pc -= 1;
  return (pc + 12) % 12;
}

const parseCache = new Map<string, ParsedChord | null>();

export function parseChordName(name: string): ParsedChord | null {
  if (parseCache.has(name)) return parseCache.get(name)!;
  let result: ParsedChord | null = null;
  const m = /^([A-G][#b♯♭]?)([^/]*)(?:\/([A-G][#b♯♭]?))?$/.exec(name.trim());
  if (m) {
    const root = parsePitch(m[1]);
    let q = m[2];
    if (!(q in QUALITIES)) q = ALIASES[q] ?? q;
    const bass = m[3] !== undefined ? parsePitch(m[3]) : undefined;
    if (root !== null && q in QUALITIES && bass !== null) {
      const notes = new Map<number, number>();
      for (const [iv, w] of QUALITIES[q]) notes.set((root + iv) % 12, w);
      if (bass !== undefined && !notes.has(bass)) notes.set(bass, 0.8);
      result = { root, quality: q, bass, notes };
    }
  }
  parseCache.set(name, result);
  return result;
}

/** Canonical key: equal for enharmonic spellings and aliases ("Bb" == "A#", "Gmaj" == "G"). */
export function chordKey(name: string): string | null {
  const p = parseChordName(name);
  if (!p) return null;
  return `${p.root}:${p.quality}${p.bass !== undefined ? `/${p.bass}` : ''}`;
}

export function sameChord(a: string, b: string): boolean {
  const ka = chordKey(a);
  return ka !== null && ka === chordKey(b);
}

const templateCache = new Map<string, Float32Array | null>();

/** Unit-length 12-vector template for a chord name, or null if unknown. */
export function chordTemplate(name: string): Float32Array | null {
  if (templateCache.has(name)) return templateCache.get(name)!;
  const p = parseChordName(name);
  let t: Float32Array | null = null;
  if (p) {
    t = new Float32Array(12);
    for (const [pc, w] of p.notes) t[pc] = w;
    normalize(t);
  }
  templateCache.set(name, t);
  return t;
}

export function normalize(v: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s);
  if (n > 0) for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < 12; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

/** Cosine similarity between a chroma vector and a chord's template (0 for unknown chords). */
export function scoreChord(chroma: ArrayLike<number>, name: string): number {
  const t = chordTemplate(name);
  return t ? cosine(chroma, t) : 0;
}

export function chordDisplayName(root: number, quality: string): string {
  return NOTE_NAMES[root] + quality;
}

const ALL_NAMES: string[] = [];
for (let r = 0; r < 12; r++) for (const q of RANK_QUALITIES) ALL_NAMES.push(chordDisplayName(r, q));

export type RankedChord = { name: string; score: number };

/** Score every template (12 roots × 8 qualities), best first. */
export function rankAll(chroma: ArrayLike<number>, limit = ALL_NAMES.length): RankedChord[] {
  const out = ALL_NAMES.map((name) => ({ name, score: scoreChord(chroma, name) }));
  // Ties (e.g. a triad vs. its 7th) go to the simpler chord: ALL_NAMES lists triads first.
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

/** Pitch classes of a chord, root first. */
export function chordPitchClasses(name: string): number[] {
  const p = parseChordName(name);
  if (!p) return [];
  return [...p.notes.keys()];
}
