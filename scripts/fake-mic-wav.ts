// Renders the Being Alive progression (2 strums per chord, 76 bpm) to a WAV for the fake-mic e2e test.
// Usage: npx vite-node scripts/fake-mic-wav.ts out.wav [humAmp=0] [guitarAmp=0.06]
// humAmp > 0 mixes in 60 Hz mains hum (120/180/240/300/360 Hz) from the very start.
import { writeFileSync } from 'node:fs';
import { renderNotes, strum, type SynthNote } from '../src/audio/synth';
import { flattenSong } from '../src/song/flatten';
import { beingAlive } from '../src/song/songs/being-alive';
const sr = 48000, bpm = 76, beat = 60 / bpm;
const humAmp = Number(process.argv[3] ?? 0);
const guitarAmp = Number(process.argv[4] ?? 0.06);
const flat = flattenSong(beingAlive);
const notes: SynthNote[] = [];
let t = 2.0; // 2 s of silence first
const times: number[] = [];
flat.chords.forEach((c, i) => {
  const dur = c.beats * beat;
  times.push(t);
  for (let s = 0; s < 2; s++) {
    const at = t + (s * dur) / 2;
    const ring = s === 1 && flat.chords[i + 1] ? t + dur - at - 0.02 : undefined;
    notes.push(...strum(c.chord, at, ring, guitarAmp));
  }
  t += dur;
});
const sig = renderNotes(notes, sr, t + 4);
if (humAmp > 0) {
  const parts = [[2, 1], [3, 0.7], [4, 0.5], [5, 0.4], [6, 0.3]];
  for (let i = 0; i < sig.length; i++) {
    let v = 0;
    for (const [h, a] of parts) v += a * Math.sin(2 * Math.PI * 60 * h * (i / sr) + h);
    sig[i] += humAmp * v;
  }
}
const buf = Buffer.alloc(44 + sig.length * 2);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + sig.length * 2, 4); buf.write('WAVEfmt ', 8);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24);
buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(sig.length * 2, 40);
for (let i = 0; i < sig.length; i++) buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(sig[i] * 32767))), 44 + i * 2);
writeFileSync(process.argv[2], buf);
console.log('chords', flat.chords.length, 'duration', (t + 4).toFixed(1), 'changes at', times.map((x) => x.toFixed(1)).join(','));
