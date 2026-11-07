import { describe, expect, it, vi } from 'vitest';
import { Mic, MicError, MIC_CONSTRAINTS } from '../src/audio/mic';

function fakeNode() {
  return { connect: vi.fn(), disconnect: vi.fn() };
}

function fakeContext() {
  const analyser = {
    ...fakeNode(),
    fftSize: 0,
    smoothingTimeConstant: 1,
    minDecibels: 0,
    maxDecibels: 0,
    getFloatFrequencyData: vi.fn((a: Float32Array) => a.fill(-42)),
    getFloatTimeDomainData: vi.fn((a: Float32Array) => a.fill(0.1)),
  };
  const filter = { ...fakeNode(), type: '', frequency: { value: 0 }, Q: { value: 0 } };
  const gain = { ...fakeNode(), gain: { value: 1 } };
  const ctx = {
    sampleRate: 44100,
    currentTime: 1.5,
    destination: {},
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    createMediaStreamSource: vi.fn(() => fakeNode()),
    createAnalyser: vi.fn(() => analyser),
    createBiquadFilter: vi.fn(() => filter),
    createGain: vi.fn(() => gain),
  };
  return { ctx, analyser, filter, gain };
}

describe('Mic', () => {
  it('opens the mic with voice processing disabled and configures the analyser', async () => {
    const f = fakeContext();
    const track = { stop: vi.fn() };
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }) as unknown as MediaStream);
    const mic = new Mic({ getUserMedia, createContext: () => f.ctx as unknown as AudioContext });
    await mic.start();

    expect(getUserMedia).toHaveBeenCalledWith(MIC_CONSTRAINTS);
    expect(MIC_CONSTRAINTS.audio).toMatchObject({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
    expect(f.ctx.resume).toHaveBeenCalled();
    expect(f.analyser.fftSize).toBe(8192);
    expect(f.analyser.smoothingTimeConstant).toBe(0);
    expect(f.filter.type).toBe('highpass');
    expect(f.filter.frequency.value).toBe(70);
    expect(f.gain.gain.value).toBe(0);
    expect(mic.running).toBe(true);
    expect(mic.sampleRate).toBe(44100);
    expect(mic.getFrame()).toHaveLength(4096);
    expect(mic.getFrame()[10]).toBe(-42);
    expect(mic.getLevelDb()).toBeCloseTo(-20, 3);
    expect(mic.now()).toBe(1500);

    mic.stop();
    expect(track.stop).toHaveBeenCalled();
    expect(f.ctx.close).toHaveBeenCalled();
    expect(mic.running).toBe(false);
    expect(mic.getLevelDb()).toBe(-Infinity);
  });

  it('can skip the high-pass filter', async () => {
    const f = fakeContext();
    const mic = new Mic(
      { getUserMedia: async () => ({ getTracks: () => [] }) as unknown as MediaStream, createContext: () => f.ctx as unknown as AudioContext },
      { highPassHz: null, fftSize: 4096 },
    );
    await mic.start();
    expect(f.ctx.createBiquadFilter).not.toHaveBeenCalled();
    expect(mic.getFrame()).toHaveLength(2048);
  });

  it('maps permission errors to MicError("denied")', async () => {
    const f = fakeContext();
    const err = Object.assign(new Error('no'), { name: 'NotAllowedError' });
    const mic = new Mic({ getUserMedia: () => Promise.reject(err), createContext: () => f.ctx as unknown as AudioContext });
    await expect(mic.start()).rejects.toMatchObject({ kind: 'denied' });
    expect(f.ctx.close).toHaveBeenCalled();
    expect(mic.running).toBe(false);
  });

  it('reports unsupported Web Audio', async () => {
    const mic = new Mic({ getUserMedia: vi.fn(), createContext: () => { throw new Error('nope'); } });
    await expect(mic.start()).rejects.toBeInstanceOf(MicError);
  });
});
