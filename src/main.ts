import './styles.css';
import { beingAlive, SOURCE_NOTE } from './song/songs/being-alive';
import { ParseError } from './song/parse';
import { SongStore } from './song/store';
import type { Song } from './song/types';
import { Player } from './ui/player';
import { h } from './ui/dom';

const app = document.getElementById('app')!;
const BUILT_IN: { song: Song; note?: string }[] = [{ song: beingAlive, note: SOURCE_NOTE }];
const store = new SongStore(undefined, BUILT_IN.map((b) => b.song.id));
let player: Player | null = null;

const TEMPLATE = `title: My Song
artist: Someone
key: G
bpm: 90

[Intro]
G D | Em C

[Verse x2]
G D
Em C   # optional note (no lyrics)
G:2 D:2 C

[Chorus]
C G
D Em
`;

function showPicker(): void {
  player?.destroy();
  player = null;
  const custom = store.list();
  app.replaceChildren(
    h(
      'div.screen',
      {},
      h('h1.brand', {}, 'Chord', h('span', { text: 'Follow' })),
      h('p.tagline', { text: 'Play guitar. The chart listens and follows you — even if you skip around.' }),
      ...BUILT_IN.map(({ song, note }) =>
        h(
          'button.song-card',
          { type: 'button', onclick: () => showPlayer(song, note) },
          h('div.grow', {}, h('div.title', { text: song.title }), h('div.meta', { text: song.artist })),
          h('span', { 'aria-hidden': 'true', text: '›' }),
        ),
      ),
      ...custom.map(({ song }) =>
        h(
          'div.song-card',
          {},
          h(
            'button.grow',
            { type: 'button', style: 'all: unset; cursor: pointer; flex: 1', onclick: () => showPlayer(song) },
            h('div.title', { text: song.title }),
            h('div.meta', { text: song.artist || 'My song' }),
          ),
          h('button.del', { type: 'button', 'aria-label': `Edit ${song.title}`, onclick: () => showEditor(song.id) }, '✎'),
          h(
            'button.del',
            {
              type: 'button',
              'aria-label': `Delete ${song.title}`,
              onclick: () => {
                if (confirm(`Delete “${song.title}”?`)) { store.remove(song.id); showPicker(); }
              },
            },
            '×',
          ),
        ),
      ),
      h('div.row', {}, h('button.btn', { type: 'button', onclick: () => showEditor() }, '+ Add song')),
      h('p.hint', {}, 'Tip: allow the microphone, put the phone near the guitar, and just play. Use ◀ ▶ or tap a chord any time.'),
    ),
  );
}

function showEditor(id?: string): void {
  player?.destroy();
  player = null;
  const existing = id ? store.get(id) : undefined;
  const ta = h('textarea.song-text', { spellcheck: 'false', autocapitalize: 'off', 'aria-label': 'Song chart' });
  ta.value = existing?.text ?? TEMPLATE;
  const err = h('div.error', { role: 'alert' });
  const save = () => {
    try {
      const song = store.save(ta.value, existing?.song.id);
      showPlayer(song);
    } catch (e) {
      err.textContent = e instanceof ParseError ? e.message : String(e);
    }
  };
  app.replaceChildren(
    h(
      'div.screen',
      {},
      h('div.row', {}, h('button.btn', { type: 'button', onclick: showPicker }, '‹ Songs'), h('strong', { text: existing ? 'Edit song' : 'Add song' })),
      h(
        'p.hint',
        {},
        h('code', { text: 'title:' }), ' ', h('code', { text: 'artist:' }), ' ', h('code', { text: 'bpm:' }), ' headers, then ',
        h('code', { text: '[Section]' }), ' or ', h('code', { text: '[Verse x3]' }), '. One line of chords per chart line; ',
        h('code', { text: '|' }), ' is just visual; ', h('code', { text: 'G:2' }), ' = 2 beats (default 4); ',
        h('code', { text: '# note' }), ' adds a label. Chords only — please don’t paste lyrics. Saved on this device only.',
      ),
      ta,
      err,
      h('div.row', {}, h('button.btn.primary', { type: 'button', onclick: save }, 'Save & play'), h('button.btn', { type: 'button', onclick: showPicker }, 'Cancel')),
    ),
  );
}

function showPlayer(song: Song, note?: string): void {
  player?.destroy();
  player = new Player(song, { onExit: showPicker, note });
  app.replaceChildren(player.el);
}

showPicker();
