import { describe, expect, it } from 'vitest';
import { SongStore, type StorageLike } from '../src/song/store';
import { ParseError } from '../src/song/parse';

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const TEXT = 'title: My Song\nartist: Me\n[Verse x2]\nG C\nD G\n';

describe('SongStore', () => {
  it('saves, lists, edits and removes songs', () => {
    const mem = memory();
    const store = new SongStore(mem, ['being-alive']);
    const song = store.save(TEXT);
    expect(song.id).toBe('my-song');
    expect(store.list().map((s) => s.song.title)).toEqual(['My Song']);
    expect(new SongStore(mem).get('my-song')?.text).toBe(TEXT); // persisted

    const again = store.save(TEXT);
    expect(again.id).toBe('my-song-2');
    store.save(TEXT.replace('My Song', 'Renamed'), 'my-song');
    expect(store.get('my-song')?.song.title).toBe('Renamed');
    expect(store.list()).toHaveLength(2);

    store.remove('my-song');
    expect(store.list().map((s) => s.song.id)).toEqual(['my-song-2']);
  });

  it('never collides with built-in song ids', () => {
    const store = new SongStore(memory(), ['being-alive']);
    expect(store.save('title: Being Alive\nG\n').id).toBe('being-alive-2');
  });

  it('rejects invalid text and survives corrupt storage', () => {
    const mem = memory();
    const store = new SongStore(mem);
    expect(() => store.save('no title here')).toThrow(ParseError);
    mem.data.set('chordfollow:songs', '{not json');
    expect(store.list()).toEqual([]);
    mem.data.set('chordfollow:songs', JSON.stringify([{ id: 'x', text: 'garbage' }, { nope: 1 }]));
    expect(store.list()).toEqual([]);
    expect(new SongStore(null).list()).toEqual([]);
  });
});
