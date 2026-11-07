import './styles.css';
import { beingAlive, SOURCE_NOTE } from './song/songs/being-alive';
import { flattenSong } from './song/flatten';
import type { Song } from './song/types';
import { ChartView } from './ui/chart';
import { Controls } from './ui/controls';
import { h } from './ui/dom';
import { DebugPanel } from './ui/debug';
import { Mic, MicError } from './audio/mic';
import { ChromaExtractor, ChromaSmoother, polyphony } from './audio/chroma';

const app = document.getElementById('app')!;

function showPicker(): void {
  app.replaceChildren(
    h(
      'div.screen',
      {},
      h('h1.brand', {}, 'Chord', h('span', { text: 'Follow' })),
      h('p.tagline', { text: 'Play guitar. The chart follows you.' }),
      h(
        'button.song-card',
        { type: 'button', onclick: () => showPlayer(beingAlive) },
        h('div.grow', {}, h('div.title', { text: beingAlive.title }), h('div.meta', { text: beingAlive.artist })),
      ),
    ),
  );
}

function showPlayer(song: Song): void {
  const flat = flattenSong(song);
  let index = 0;
  const sectionEl = h('div.section');
  const update = () => {
    chart.setPosition(index);
    const line = flat.lines[flat.chords[index].lineIndex];
    sectionEl.textContent = line.passes > 1 ? `${line.sectionName} ${line.pass + 1}/${line.passes}` : line.sectionName;
  };
  const chart = new ChartView(flat, (i) => { index = i; update(); });
  const debug = new DebugPanel();
  const micDot = h('div.mic-dot', { title: 'Mic' });
  const mic = new Mic();
  let raf = 0;
  let extractor: ChromaExtractor | null = null;
  const smoother = new ChromaSmoother(0.4);
  let lastProcess = 0;
  const loop = (t: number) => {
    raf = requestAnimationFrame(loop);
    if (t - lastProcess < 38) return; // ~25 Hz processing
    lastProcess = t;
    const frame = extractor!.compute(mic.getFrame());
    const chroma = smoother.push(frame.chroma);
    micDot.classList.toggle('on', frame.chroma !== null);
    debug.update({ chroma, levelDb: mic.getLevelDb(), polyphony: chroma ? polyphony(chroma) : 0 });
  };
  const stop = () => {
    cancelAnimationFrame(raf);
    mic.stop();
    micDot.classList.remove('on');
    controls.setListening(false);
  };
  const controls = new Controls(
    {
      onStartStop: async () => {
        if (mic.running) return stop();
        try {
          await mic.start();
          extractor = new ChromaExtractor(mic.sampleRate, mic.fftSize);
          controls.setListening(true);
          raf = requestAnimationFrame(loop);
        } catch (e) {
          alert(e instanceof MicError ? e.message : String(e));
        }
      },
      onBack: () => { index = Math.max(0, index - 1); update(); },
      onNext: () => { index = Math.min(flat.chords.length - 1, index + 1); update(); },
      onSensitivity: () => {},
      onToggleDebug: () => {
        debug.visible = !debug.visible;
        controls.setDebugActive(debug.visible);
      },
    },
    0.5,
  );
  app.replaceChildren(
    h(
      'div.player',
      {},
      h(
        'div.topbar',
        {},
        h('button.back-link', { type: 'button', 'aria-label': 'Songs', onclick: showPicker }, '‹'),
        h('div.titles', {}, h('div.song-title', { text: song.title }), sectionEl),
        micDot,
      ),
      chart.el,
      h('div.note', { text: SOURCE_NOTE }),
      debug.el,
      controls.el,
    ),
  );
  update();
}

showPicker();
