import { describe, expect, it } from 'vitest';
import { ChromaExtractor } from '../src/audio/chroma';
import { detectNotes, gradeNote, midiName, noteOf } from '../src/audio/notes';
import { renderNotes } from '../src/audio/synth';
import { frameAt } from './helpers/analyser';
import { FFT, SR, strumFrame } from './helpers/synthetic';

const ex = new ChromaExtractor(SR, FFT);
const notesOf = (db: Float32Array) => detectNotes(ex.compute(db).peaks);

describe('note naming', () => {
  it('names notes and measures cents', () => {
    expect(midiName(69)).toBe('A4');
    expect(midiName(40)).toBe('E2');
    expect(noteOf(440)).toEqual({ midi: 69, cents: 0 });
    expect(noteOf(440 * Math.pow(2, 20 / 1200))).toEqual({ midi: 69, cents: 20 });
    expect(noteOf(440 * Math.pow(2, -30 / 1200))).toEqual({ midi: 69, cents: -30 });
  });
});

describe('detectNotes', () => {
  it('a single plucked A3 is one note — its overtones are folded in', () => {
    const sig = renderNotes([{ midi: 57, start: 0 }], SR, 0.4);
    const notes = notesOf(frameAt(sig, SR, 0.35));
    expect(notes.map((n) => n.name)).toEqual(['A3']);
    expect(notes[0].freq).toBeGreaterThan(218);
    expect(notes[0].freq).toBeLessThan(222);
    expect(Math.abs(notes[0].cents)).toBeLessThanOrEqual(5);
  });

  it('a G strum shows only G, B and D notes, all green against G', () => {
    const notes = notesOf(strumFrame('G'));
    expect(notes.length).toBeGreaterThanOrEqual(3);
    expect(new Set(notes.map((n) => n.name[0]))).toEqual(new Set(['G', 'B', 'D']));
    for (const n of notes) expect(gradeNote(n, 'G')).toBe('good');
    // ...and against Em, the D is red
    expect(notes.filter((n) => n.name[0] === 'D').every((n) => gradeNote(n, 'Em') === 'wrong')).toBe(true);
  });

  it.each(['Em', 'Bm', 'C', 'Am', 'D', 'F'])('every note heard in a %s strum is green against %s', (chord) => {
    const notes = notesOf(strumFrame(chord));
    expect(notes.length).toBeGreaterThanOrEqual(2);
    for (const n of notes) expect(`${n.name}:${gradeNote(n, chord)}`).toBe(`${n.name}:good`);
  });

  it('flags an out-of-tune chord tone as yellow', () => {
    const detuned = 69 + 0.3; // A4, 30 cents sharp
    const sig = renderNotes([{ midi: detuned, start: 0 }], SR, 0.4);
    const [n] = notesOf(frameAt(sig, SR, 0.35));
    expect(n.name).toBe('A4');
    expect(n.cents).toBeGreaterThanOrEqual(25);
    expect(gradeNote(n, 'A')).toBe('off');
    expect(gradeNote(n, 'D')).toBe('off');
    expect(gradeNote(n, 'G')).toBe('wrong');
    expect(gradeNote(n, undefined)).toBe('wrong');
  });

  it('reports peaks even below the silence floor, and nothing for digital silence', () => {
    const quiet = renderNotes([{ midi: 55, start: 0, amp: 0.0004 }], SR, 0.4);
    const r = ex.compute(frameAt(quiet, SR, 0.35));
    expect(r.silent).toBe(true);
    expect(detectNotes(r.peaks)[0]?.name).toBe('G3');
    expect(detectNotes([])).toEqual([]);
  });
});
