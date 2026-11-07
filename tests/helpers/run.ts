import { Follower, type FollowerChord, type FollowerOptions, type PositionChange } from '../../src/audio/follower';
import { ChordPipeline } from '../../src/audio/pipeline';
import { framesOf } from './analyser';
import { FFT, SR } from './synthetic';

export const chordsOf = (names: string[], beats = 4): FollowerChord[] =>
  names.map((chord, i) => ({ chord, beats, lineIndex: Math.floor(i / 2), lineStart: i % 2 === 0, sectionStart: i === 0 }));

/**
 * Like the app: Start is tapped `LEAD_MS` before the music begins (the first
 * ~1.2 s are spent learning the room's background). Reported times are
 * relative to the start of the music.
 */
export const LEAD_MS = 1500;

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
  follower.start(-LEAD_MS, opts.startAt ?? 0);
  const trace: { time: number; index: number; best: number; conf: number; onset: boolean }[] = [];
  const lead = new Float32Array(Math.round((LEAD_MS / 1000) * SR) + signal.length);
  lead.set(signal, lead.length - signal.length);
  for (const f of framesOf(lead, SR, FFT, 40)) {
    const time = f.time - LEAD_MS;
    t = time;
    const r = pipe.process(f.db, time);
    trace.push({ time, index: r.index, best: r.best, conf: r.confidence, onset: !!r.onset });
  }
  return { follower, events, done, trace };
}
