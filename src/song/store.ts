import { parseSong } from './parse';
import type { Song } from './types';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export type StoredSong = { id: string; text: string };

const KEY = 'chordfollow:songs';

/** User-added songs, stored as their source text in localStorage. */
export class SongStore {
  constructor(private storage: StorageLike | null = safeLocalStorage(), private reserved: string[] = []) {}

  private read(): StoredSong[] {
    try {
      const raw = this.storage?.getItem(KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter((x) => x && typeof x.id === 'string' && typeof x.text === 'string') : [];
    } catch {
      return [];
    }
  }

  private write(list: StoredSong[]): void {
    try { this.storage?.setItem(KEY, JSON.stringify(list)); } catch { /* quota / private mode */ }
  }

  /** All parseable stored songs, with their source text. */
  list(): { song: Song; text: string }[] {
    return this.read().flatMap(({ id, text }) => {
      try { return [{ song: { ...parseSong(text), id }, text }]; } catch { return []; }
    });
  }

  get(id: string): { song: Song; text: string } | undefined {
    return this.list().find((s) => s.song.id === id);
  }

  /**
   * Parse and save. Throws ParseError on bad input. Pass `id` to overwrite an
   * existing song; otherwise a unique id is derived from the title.
   */
  save(text: string, id?: string): Song {
    const song = parseSong(text);
    const list = this.read();
    let finalId = id ?? song.id;
    if (!id) {
      const taken = new Set([...list.map((s) => s.id), ...this.reserved]);
      for (let n = 2; taken.has(finalId); n++) finalId = `${song.id}-${n}`;
    }
    const entry = { id: finalId, text };
    const i = list.findIndex((s) => s.id === finalId);
    if (i >= 0) list[i] = entry;
    else list.push(entry);
    this.write(list);
    return { ...song, id: finalId };
  }

  remove(id: string): void {
    this.write(this.read().filter((s) => s.id !== id));
  }
}

function safeLocalStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
