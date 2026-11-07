/**
 * Emulates AnalyserNode.getFloatFrequencyData with smoothingTimeConstant = 0:
 * Blackman window, FFT, |X|/N, 20·log10.
 */
export function fftMagnitudesDb(samples: Float32Array, end: number, fftSize: number): Float32Array {
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  const a0 = 0.42, a1 = 0.5, a2 = 0.08;
  for (let n = 0; n < fftSize; n++) {
    const idx = end - fftSize + n;
    const x = idx >= 0 && idx < samples.length ? samples[idx] : 0;
    const w = a0 - a1 * Math.cos((2 * Math.PI * n) / fftSize) + a2 * Math.cos((4 * Math.PI * n) / fftSize);
    re[n] = x * w;
  }
  fft(re, im);
  const out = new Float32Array(fftSize / 2);
  for (let k = 0; k < fftSize / 2; k++) {
    const mag = Math.hypot(re[k], im[k]) / fftSize;
    out[k] = mag > 0 ? 20 * Math.log10(mag) : -Infinity;
  }
  return out;
}

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2], ai = im[i + k + len / 2];
        const tr = ar * cr - ai * ci, ti = ar * ci + ai * cr;
        re[i + k + len / 2] = re[i + k] - tr;
        im[i + k + len / 2] = im[i + k] - ti;
        re[i + k] += tr;
        im[i + k] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

export type Frame = { time: number; db: Float32Array };

/** Slice a signal into analyser frames every `hopMs`, like the app's processing loop. */
export function* framesOf(samples: Float32Array, sampleRate: number, fftSize = 8192, hopMs = 40): Generator<Frame> {
  const hop = Math.round((hopMs / 1000) * sampleRate);
  for (let end = hop; end <= samples.length; end += hop) {
    yield { time: (end / sampleRate) * 1000, db: fftMagnitudesDb(samples, end, fftSize) };
  }
}

/** Analyser frame of a signal at time `t` seconds. */
export function frameAt(samples: Float32Array, sampleRate: number, t: number, fftSize = 8192): Float32Array {
  return fftMagnitudesDb(samples, Math.round(t * sampleRate), fftSize);
}
