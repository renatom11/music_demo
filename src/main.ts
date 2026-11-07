import './styles.css';
import { beingAlive, SOURCE_NOTE } from './song/songs/being-alive';
import type { Song } from './song/types';
import { Player } from './ui/player';
import { h } from './ui/dom';

const app = document.getElementById('app')!;
let player: Player | null = null;

function showPicker(): void {
  player?.destroy();
  player = null;
  app.replaceChildren(
    h(
      'div.screen',
      {},
      h('h1.brand', {}, 'Chord', h('span', { text: 'Follow' })),
      h('p.tagline', { text: 'Play guitar. The chart follows you.' }),
      h(
        'button.song-card',
        { type: 'button', onclick: () => showPlayer(beingAlive, SOURCE_NOTE) },
        h('div.grow', {}, h('div.title', { text: beingAlive.title }), h('div.meta', { text: beingAlive.artist })),
      ),
    ),
  );
}

function showPlayer(song: Song, note?: string): void {
  player = new Player(song, { onExit: showPicker, note });
  app.replaceChildren(player.el);
}

showPicker();
