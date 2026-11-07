/**
 * /test.html — plays synthesized chords out of the speaker so the mic path can
 * be checked on a laptop without a guitar. Open the app on a phone (or another
 * tab) and play these into it.
 */
import './styles.css';
import { renderNotes, renderSweep, strum, mix, type SynthNote } from './audio/synth';
import { flattenSong } from './song/flatten';
import { beingAlive } from './song/songs/being-alive';
import { h } from './ui/dom';

let ctx: AudioContext | null = null;
let current: AudioBufferSourceNode | null = null;

function audio(): AudioContext {
  if (!ctx) {
    const Ctor: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
  }
  void ctx.resume();
  return ctx;
}

function play(samples: Float32Array): void {
  const c = audio();
  current?.stop();
  const buf = c.createBuffer(1, samples.length, c.sampleRate);
  buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(c.destination);
  src.start();
  current = src;
}

const sr = () => audio().sampleRate;

function playChord(name: string): void {
  play(renderNotes(strum(name, 0.02, undefined, 0.14), sr(), 3));
}

function playProgression(bpm: number, strumsPerChord: number): void {
  const flat = flattenSong(beingAlive);
  const beat = 60 / bpm;
  const notes: SynthNote[] = [];
  let t = 0.1;
  flat.chords.forEach((c, i) => {
    const dur = c.beats * beat;
    const next = flat.chords[i + 1];
    for (let s = 0; s < strumsPerChord; s++) {
      const at = t + (s * dur) / strumsPerChord;
      const ringFor = s === strumsPerChord - 1 && next ? t + dur - at - 0.02 : undefined;
      notes.push(...strum(c.chord, at, ringFor, 0.12));
    }
    t += dur;
  });
  play(renderNotes(notes, sr(), t + 2));
}

function playSingOverG(): void {
  const total = 6;
  const g = renderNotes([...strum('G', 0.1), ...strum('G', 3.1)], sr(), total);
  const voice = renderSweep(sr(), total, 220, 520, 0.18, 0.6, 2.2);
  const voice2 = renderSweep(sr(), total, 520, 260, 0.18, 3.3, 2.2);
  play(mix(g, voice, voice2));
}

const chords = ['G', 'Em', 'Bm', 'C', 'Am', 'D', 'A', 'E', 'Dm', 'F', 'G7', 'D7', 'Cmaj7', 'Asus4', 'D/F#'];
const app = document.getElementById('app')!;
app.replaceChildren(
  h(
    'div.screen',
    {},
    h('h1.brand', {}, 'Test ', h('span', { text: 'tones' })),
    h('p.hint', { text: 'Plays synthesized guitar out of this device. Open ChordFollow on another device (or tab, with speakers on) and press Start listening, then play these into its mic.' }),
    h('strong', { text: 'Single strums' }),
    h('div.row', {}, ...chords.map((c) => h('button.btn', { type: 'button', onclick: () => playChord(c) }, c))),
    h('strong', { text: 'Being Alive progression' }),
    h(
      'div.row',
      {},
      h('button.btn.primary', { type: 'button', onclick: () => playProgression(beingAlive.bpm ?? 76, 1) }, '1 strum / chord'),
      h('button.btn', { type: 'button', onclick: () => playProgression(beingAlive.bpm ?? 76, 4) }, '4 strums / chord'),
      h('button.btn', { type: 'button', onclick: () => playProgression((beingAlive.bpm ?? 76) * 1.2, 2) }, '20% faster'),
    ),
    h('strong', { text: 'Singing rejection' }),
    h('div.row', {}, h('button.btn', { type: 'button', onclick: playSingOverG }, 'Voice sweep over held G (should NOT advance)')),
    h('div.row', {}, h('button.btn', { type: 'button', onclick: () => current?.stop() }, '■ Stop'), h('a.btn', { href: '/' }, '← App')),
  ),
);
