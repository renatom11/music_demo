import { describe, expect, it } from 'vitest';
import { Follower } from '../src/audio/follower';
import { chordTemplate } from '../src/audio/chords';
import { chordVoicing, mix, renderNotes, renderSweep, type SynthNote } from '../src/audio/synth';
import { chordsOf, run } from './helpers/run';
import { SR, performance, type Hit } from './helpers/synthetic';

/** Strum each chord once, every `secs` seconds. */
const hitsEvery = (names: string[], secs: number, t0 = 0.1): Hit[] => names.map((chord, i) => ({ chord, at: t0 + i * secs }));

/** Strum each chord on every beat. */
const hitsOnBeats = (names: string[], bpm: number, beats = 4, t0 = 0.1): Hit[] => {
  const beat = 60 / bpm;
  return names.flatMap((chord, i) => Array.from({ length: beats }, (_, b) => ({ chord, at: t0 + (i * beats + b) * beat })));
};

const PROG = ['G', 'Em', 'G', 'Em', 'Bm', 'Em', 'C', 'Am', 'D'];

describe('follower (synthesized audio)', () => {
  it('follows G → Em → G → Em → Bm → Em → C → Am → D: exactly 8 advances, ends on D', () => {
    const sig = performance(hitsEvery(PROG, 2.4), PROG.length * 2.4 + 1);
    const { events, follower } = run(chordsOf(PROG), sig, { bpm: 100 });
    expect(events.map((e) => e.kind)).toEqual(Array(8).fill('advance'));
    expect(events.map((e) => e.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(follower.index).toBe(8);
  });

  it('follows when strumming on every beat, at a tempo different from the chart', () => {
    // Chart says 80 bpm, player plays at 96.
    const sig = performance(hitsOnBeats(PROG, 96), (PROG.length * 4 * 60) / 96 + 1);
    const { events, follower } = run(chordsOf(PROG), sig, { bpm: 80 });
    expect(events.map((e) => e.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(follower.index).toBe(8);
  });

  it('change is shown promptly (< 600 ms after the strum)', () => {
    const sig = performance(hitsEvery(PROG, 2.4), PROG.length * 2.4 + 1);
    const { events } = run(chordsOf(PROG), sig, { bpm: 100 });
    events.forEach((e, i) => {
      const strumMs = (0.1 + (i + 1) * 2.4) * 1000;
      expect(e.time - strumMs).toBeGreaterThan(0);
      expect(e.time - strumMs).toBeLessThan(600);
    });
  });

  it('singing a sweep (200–600 Hz) over a held G does not advance to Em', () => {
    const total = 6;
    const guitar = performance([{ chord: 'G', at: 0.1 }, { chord: 'G', at: 3.1 }], total);
    const voice = [renderSweep(SR, total, 200, 600, 0.25, 0.5, 2.5), renderSweep(SR, total, 600, 200, 0.25, 3.3, 2.5)];
    const sig = performance([], total, [guitar, ...voice]);
    const { events, follower } = run(chordsOf(['G', 'Em', 'G', 'Em']), sig, { bpm: 40 });
    expect(events).toEqual([]);
    expect(follower.index).toBe(0);
  });

  it('a sustained sung E over a held G does not advance to Em', () => {
    const total = 5;
    const guitar = performance([{ chord: 'G', at: 0.1 }, { chord: 'G', at: 2.6 }], total);
    const voice = renderSweep(SR, total, 329.6, 329.6, 0.08, 0.6, 3.5);
    const { events } = run(chordsOf(['G', 'Em', 'G']), performance([], total, [guitar, voice]), { bpm: 40 });
    expect(events).toEqual([]);
  });

  it.each([0.06, 0.1, 0.15])('singing an E/B-heavy melody (amp %s) over a held G does not advance', (amp) => {
    const total = 7;
    const guitar = performance([{ chord: 'G', at: 0.1 }, { chord: 'G', at: 3.1 }], total);
    const melody = [64, 62, 59, 64, 69, 66, 64, 71, 64, 60, 64, 62];
    const voice = renderNotes(
      melody.map((midi, i) => ({ midi, start: 0.4 + i * 0.5, duration: 0.48, amp })),
      SR, total, { harmonics: 4, decay: 20 },
    );
    const { events } = run(chordsOf(['G', 'Em', 'G', 'C']), mix(guitar, voice), { bpm: 40 });
    expect(events).toEqual([]);
  });

  it('follows a fingerpicked (arpeggiated) progression', () => {
    const notes: SynthNote[] = [];
    let t = 0.1;
    for (const c of PROG) {
      const v = chordVoicing(c);
      for (const i of [0, 3, 4, 5, 2, 4, 3, 5]) {
        notes.push({ midi: v[Math.min(i, v.length - 1)], start: t, amp: 0.15, duration: 2.0 });
        t += 0.3;
      }
    }
    const { events, follower } = run(chordsOf(PROG), renderNotes(notes, SR, t + 1), { bpm: 100 });
    expect(events.map((e) => e.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(follower.index).toBe(8);
  });

  it.each([0.01, 0.03])('tolerates background noise (±%s)', (n) => {
    const base = performance(hitsEvery(PROG, 2.4), PROG.length * 2.4 + 1);
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const sig = Float32Array.from(base, (x) => x + (rnd() - 0.5) * 2 * n);
    const { events, follower } = run(chordsOf(PROG), sig, { bpm: 100 });
    expect(events).toHaveLength(8);
    expect(follower.index).toBe(8);
  });

  it('G | G: an early second strum does not advance; one after the chord duration does', () => {
    // 80 bpm, 4 beats = 3 s. Strums at 0, 1.5 s (too early) and 3.0 s (on time).
    const hits: Hit[] = [{ chord: 'G', at: 0.1 }, { chord: 'G', at: 1.6 }, { chord: 'G', at: 3.1 }];
    const sig = performance(hits, 4.5);
    const { events } = run(chordsOf(['G', 'G', 'C']), sig, { bpm: 80 });
    expect(events).toHaveLength(1);
    expect(events[0].index).toBe(1);
    expect(events[0].time).toBeGreaterThan(3100);
    expect(events[0].time).toBeLessThan(3700);
  });

  it('pauses during silence and resumes', () => {
    const hits: Hit[] = [
      { chord: 'G', at: 0.1 }, { chord: 'Em', at: 2.1 }, // then 4 s of silence (damped)
      { chord: 'Bm', at: 7.6 }, { chord: 'Em', at: 9.6 },
    ];
    const notes = performance(hits.slice(0, 2).concat([]), 12);
    // damp the Em at 3.5 s by rendering separately
    const a = performance([{ chord: 'G', at: 0.1 }, { chord: 'Em', at: 2.1 }, { chord: 'Em', at: 3.5 }], 3.6);
    const b = performance(hits.slice(2), 12);
    const sig = new Float32Array(b.length);
    sig.set(a.subarray(0, Math.round(3.5 * SR)));
    for (let i = 0; i < b.length; i++) sig[i] += b[i];
    void notes;
    const { events, follower } = run(chordsOf(['G', 'Em', 'Bm', 'Em', 'C']), sig, { bpm: 80 });
    expect(events.map((e) => e.index)).toEqual([1, 2, 3]);
    expect(follower.index).toBe(3);
  });

  it('finds you when you start in the middle of the song', () => {
    const song = ['G', 'Em', 'G', 'Em', 'Bm', 'Em', 'C', 'Am', 'D', 'G', 'Em'];
    const sig = performance(hitsEvery(['Bm', 'Em', 'C', 'Am', 'D'], 2.4), 5 * 2.4 + 0.8);
    const { follower } = run(chordsOf(song), sig, { bpm: 100 });
    expect(follower.index).toBe(8);
  });

  it('follows you back when you repeat an earlier line', () => {
    const song = ['G', 'Em', 'Bm', 'Em', 'C', 'Am', 'D', 'G'];
    // Play up to C, go back to Bm, then carry on.
    const played = ['G', 'Em', 'Bm', 'Em', 'C', 'Bm', 'Em', 'C', 'Am', 'D'];
    const sig = performance(hitsEvery(played, 2.4), played.length * 2.4 + 0.8);
    const { follower, events } = run(chordsOf(song), sig, { bpm: 100 });
    expect(events.some((e) => e.kind === 'jump' && e.index === 2)).toBe(true);
    expect(follower.index).toBe(6);
  });

  it('copes with a skipped chord', () => {
    const song = ['G', 'Em', 'Bm', 'C', 'Am', 'D'];
    const played = ['G', 'Em', 'C', 'Am', 'D']; // skipped Bm
    const sig = performance(hitsEvery(played, 2.4), played.length * 2.4 + 0.8);
    const { follower } = run(chordsOf(song), sig, { bpm: 100 });
    expect(follower.index).toBe(5);
  });

  it('declares done after the last chord rings out', () => {
    const names = ['G', 'C'];
    const sig = performance([{ chord: 'G', at: 0.1 }, { chord: 'C', at: 2.1 }, { chord: 'C', at: 3.0 }], 9);
    // damp everything after 3.6 s
    sig.fill(0, Math.round(3.6 * SR));
    const { done, follower } = run(chordsOf(names, 2), sig, { bpm: 80 });
    expect(follower.index).toBe(1);
    expect(done).toBe(true);
  });
});

describe('follower (unit)', () => {
  const tpl = (n: string) => Float32Array.from(chordTemplate(n)!);

  it('manual next/back/jump always work and emit manual events', () => {
    const f = new Follower(chordsOf(['G', 'Em', 'C']));
    const kinds: string[] = [];
    f.on('position', (e) => kinds.push(`${e.kind}:${e.index}`));
    f.start(0);
    f.next(10);
    f.next(20);
    expect(f.index).toBe(2);
    f.back(30);
    expect(f.index).toBe(1);
    f.jump(0, 40);
    expect(f.index).toBe(0);
    f.jump(99, 50);
    expect(f.index).toBe(2);
    expect(kinds).toEqual(['manual:0', 'manual:1', 'manual:2', 'manual:1', 'manual:0', 'manual:2']);
  });

  it('Next on the last chord finishes the song; Back un-finishes', () => {
    const f = new Follower(chordsOf(['G', 'C']));
    let done = 0;
    f.on('done', () => done++);
    f.start(0);
    f.next(1);
    f.next(2);
    expect(f.status).toBe('done');
    expect(done).toBe(1);
    f.back(3);
    expect(f.status).toBe('listening');
    f.restart(4);
    expect(f.index).toBe(0);
    expect(f.status).toBe('idle');
  });

  it('emits lineChange when the line changes', () => {
    const f = new Follower(chordsOf(['G', 'Em', 'C', 'D']));
    const lines: number[] = [];
    f.on('lineChange', (l) => lines.push(l));
    f.start(0);
    f.next(1);
    f.next(2);
    expect(lines).toEqual([0, 1]);
  });

  it('ignores frames while idle and when silent', () => {
    const f = new Follower(chordsOf(['G', 'Em']));
    f.update(tpl('Em'), 0);
    expect(f.index).toBe(0);
    f.start(0);
    for (let t = 40; t < 3000; t += 40) f.update(null, t);
    expect(f.index).toBe(0);
  });

  it('a manual jump is not undone by an attack that happened before it', () => {
    const f = new Follower(chordsOf(['G', 'Em', 'C']));
    f.start(0);
    f.onset(100);
    f.jump(2, 150);
    for (let t = 160; t < 1000; t += 40) f.update(tpl('C'), t);
    expect(f.index).toBe(2);
  });

  it('adapts its tempo estimate from chord changes', () => {
    const f = new Follower(chordsOf(['G', 'Em', 'G', 'Em', 'G', 'Em']), { bpm: 80 });
    f.start(0);
    let t = 0;
    for (let i = 0; i < 6; i++) {
      const c = tpl(i % 2 ? 'Em' : 'G');
      f.onset(t);
      for (let k = 0; k < 50; k++, t += 40) f.update(c, t); // 2 s per chord = 120 bpm
    }
    expect(f.index).toBe(5);
    expect(f.bpm).toBeGreaterThan(88);
  });

  it('sensitivity maps onto the model', () => {
    const f = new Follower(chordsOf(['G', 'C']));
    f.setSensitivity(1);
    const hi = { ...f.opts };
    f.setSensitivity(0);
    expect(hi.holdMs).toBeLessThan(f.opts.holdMs);
    expect(hi.beta).toBeGreaterThan(f.opts.beta);
    expect(f.isRepeat(0)).toBe(false);
    expect(new Follower(chordsOf(['G', 'G'])).isRepeat(0)).toBe(true);
    expect(() => new Follower([])).toThrow();
  });
});
