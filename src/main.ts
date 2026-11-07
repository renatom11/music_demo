import './styles.css';
import { beingAlive, SOURCE_NOTE } from './song/songs/being-alive';
import { flattenSong } from './song/flatten';
import type { Song } from './song/types';
import { ChartView } from './ui/chart';
import { Controls } from './ui/controls';
import { h } from './ui/dom';

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
  const controls = new Controls(
    {
      onStartStop: () => {},
      onBack: () => { index = Math.max(0, index - 1); update(); },
      onNext: () => { index = Math.min(flat.chords.length - 1, index + 1); update(); },
      onSensitivity: () => {},
      onToggleDebug: () => {},
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
        h('div.mic-dot'),
      ),
      chart.el,
      h('div.note', { text: SOURCE_NOTE }),
      controls.el,
    ),
  );
  update();
}

showPicker();
