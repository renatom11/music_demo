import { Follower, type FollowerChord, type FollowerOptions, type PositionChange } from '../../src/audio/follower';
import { ChordPipeline } from '../../src/audio/pipeline';
import { framesOf } from './analyser';
import { FFT, SR } from './synthetic';

export const chordsOf = (names: string[], beats = 4): FollowerChord[] =>
  names.map((chord, i) => ({ chord, beats, lineIndex: Math.floor(i / 2), lineStart: i % 2 === 0, sectionStart: i === 0 }));

export function run(
  chords: FollowerChord[],
  signal: Float32Array,
  opts: Partial<FollowerOptions> & { startAt?: number; sensitivity?: number } = {},
) {
  const follower = new Follower(chords, opts);
  const pipe = new ChordPipeline(follower, SR, FFT, opts.sensitivity ?? 0.5);
  const events: (PositionChange & { time: number })[] = [];
  let done = false;
  let t = 0;
  follower.on('position', (e) => { if (e.kind !== 'manual') events.push({ ...e, time: t }); });
  follower.on('done', () => { done = true; });
  follower.start(0, opts.startAt ?? 0);
  const trace: { time: number; index: number; best: number; conf: number; onset: boolean }[] = [];
  for (const f of framesOf(signal, SR, FFT, 40)) {
    t = f.time;
    const r = pipe.process(f.db, f.time);
    trace.push({ time: f.time, index: r.index, best: r.best, conf: r.confidence, onset: !!r.onset });
  }
  return { follower, events, done, trace };
}
