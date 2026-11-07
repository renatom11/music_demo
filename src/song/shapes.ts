/**
 * Guitar chord shapes, standard tuning. `frets` are low E → high e;
 * -1 = muted, 0 = open. `barre` spans strings fromString..toString (0 = low E).
 */
export type Barre = { fret: number; fromString: number; toString: number };
export type ChordShape = { frets: number[]; barre?: Barre; name?: string };

/** Standard tuning as MIDI notes, low E → high e. */
export const STANDARD_TUNING = [40, 45, 50, 55, 59, 64];

const S = (frets: string, barre?: Barre, name?: string): ChordShape => ({
  frets: [...frets].map((c) => (c === 'x' ? -1 : parseInt(c, 16))),
  ...(barre ? { barre } : {}),
  ...(name ? { name } : {}),
});

/** First entry is the full shape; second (if any) is an easier alternative. */
export const SHAPES: Record<string, ChordShape[]> = {
  G: [S('320003'), S('320033', undefined, 'G (rock)')],
  C: [S('x32010')],
  D: [S('xx0232')],
  A: [S('x02220')],
  E: [S('022100')],
  Am: [S('x02210')],
  Em: [S('022000')],
  Dm: [S('xx0231')],
  Bm: [S('x24432', { fret: 2, fromString: 1, toString: 5 }), S('xx4432', undefined, 'Bm (easy)')],
  F: [S('133211', { fret: 1, fromString: 0, toString: 5 }), S('xx3211', { fret: 1, fromString: 4, toString: 5 }, 'F (easy)')],
  'F#m': [S('244222', { fret: 2, fromString: 0, toString: 5 }), S('xx4222', { fret: 2, fromString: 3, toString: 5 }, 'F#m (easy)')],
  Bb: [S('x13331', { fret: 1, fromString: 1, toString: 5 }), S('xx3331', undefined, 'Bb (easy)')],
  B: [S('x24442', { fret: 2, fromString: 1, toString: 5 })],
  // 7ths
  G7: [S('320001')],
  C7: [S('x32310')],
  D7: [S('xx0212')],
  A7: [S('x02020')],
  E7: [S('020100')],
  B7: [S('x21202')],
  Am7: [S('x02010')],
  Em7: [S('022030'), S('020000', undefined, 'Em7 (easy)')],
  Dm7: [S('xx0211')],
  Bm7: [S('x20202')],
  'F#m7': [S('242222', { fret: 2, fromString: 0, toString: 5 })],
  Cmaj7: [S('x32000')],
  Gmaj7: [S('320002')],
  Dmaj7: [S('xx0222')],
  Amaj7: [S('x02120')],
  Emaj7: [S('021100')],
  Fmaj7: [S('xx3210')],
  // sus / misc
  Asus2: [S('x02200')],
  Asus4: [S('x02230')],
  Dsus2: [S('xx0230')],
  Dsus4: [S('xx0233')],
  Esus4: [S('022200')],
  Csus2: [S('x30013')],
  Gsus4: [S('330013')],
  Cadd9: [S('x32033')],
  'D/F#': [S('2x0232')],
  'G/B': [S('x20003')],
  'C/G': [S('332010')],
};

const ENHARMONIC: Record<string, string> = { 'A#': 'Bb', Gb: 'F#', Db: 'C#', 'D#': 'Eb', 'G#': 'Ab' };

export function getShape(name: string, easy = false): ChordShape | null {
  let list = SHAPES[name];
  if (!list) {
    const m = /^([A-G][#b]?)(.*)$/.exec(name);
    if (m && ENHARMONIC[m[1]]) list = SHAPES[ENHARMONIC[m[1]] + m[2]];
  }
  if (!list) return null;
  return (easy && list[1]) || list[0];
}

/** MIDI notes sounded by a shape, low → high. */
export function shapeMidi(shape: ChordShape): number[] {
  return shape.frets.flatMap((f, s) => (f < 0 ? [] : [STANDARD_TUNING[s] + f]));
}
