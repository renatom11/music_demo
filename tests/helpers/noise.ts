import { SR } from './synthetic';

/** Mains hum as a phone mic hears it: harmonics of 60 Hz (120, 180, 240, 300, 360 Hz). */
export function hum(seconds: number, amp: number, mains = 60): Float32Array {
  const out = new Float32Array(Math.ceil(seconds * SR));
  const parts: [number, number][] = [[2, 1], [3, 0.7], [4, 0.5], [5, 0.4], [6, 0.3]];
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    let v = 0;
    for (const [h, a] of parts) v += a * Math.sin(2 * Math.PI * mains * h * t + h);
    out[i] = amp * v;
  }
  return out;
}
