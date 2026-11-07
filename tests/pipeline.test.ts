import { describe, expect, it } from 'vitest';
import { Follower } from '../src/audio/follower';
import { ChordPipeline } from '../src/audio/pipeline';
import { framesOf } from './helpers/analyser';
import { chordsOf } from './helpers/run';
import { FFT, SR, performance } from './helpers/synthetic';

describe('ChordPipeline', () => {
  it('reports chroma, bass, onsets and follower state per frame', () => {
    const f = new Follower(chordsOf(['G', 'C']));
    const p = new ChordPipeline(f, SR, FFT);
    f.start(0);
    const frames = [...framesOf(performance([{ chord: 'G', at: 0.1 }], 0.8), SR, FFT, 40)].map((x) => p.process(x.db, x.time));
    expect(frames.some((r) => r.onset)).toBe(true);
    const last = frames[frames.length - 1];
    expect(last.chroma).not.toBeNull();
    expect(last.chordal).toBe(true);
    expect(last.current?.name).toBe('G');
    expect(last.current!.score).toBeGreaterThan(0.8);
    expect(last.lastOnset).not.toBeNull();
    p.reset();
    expect(p.onsets.lastOnset).toBeNull();
  });

  it('sensitivity changes onset and noise thresholds', () => {
    const p = new ChordPipeline(new Follower(chordsOf(['G'])), SR, FFT, 0);
    const low = { k: p.onsets.opts.k, floor: p.chroma.opts.noiseFloor };
    p.setSensitivity(1);
    expect(p.onsets.opts.k).toBeLessThan(low.k);
    expect(p.chroma.opts.noiseFloor).toBeLessThan(low.floor);
  });
});
