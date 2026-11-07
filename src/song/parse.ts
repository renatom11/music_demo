import { parseChordName } from '../audio/chords';
import type { ChordEvent, Line, Section, Song } from './types';

export class ParseError extends Error {
  constructor(message: string, public line: number) {
    super(`Line ${line}: ${message}`);
  }
}

const HEADER_KEYS = new Set(['title', 'artist', 'key', 'capo', 'bpm', 'source', 'id']);

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'song'
  );
}

/**
 * Parse the plain-text chord chart format:
 *
 *   title: Being Alive
 *   bpm: 76
 *   [Verse x3]
 *   G Em | G:2 Em:2   # optional label
 */
export function parseSong(text: string): Song {
  const song: Song = { id: '', title: '', artist: '', sections: [] };
  let section: Section | null = null;

  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('//')) return;

    const header = /^([a-zA-Z]+)\s*:\s*(.*)$/.exec(trimmed);
    if (header && HEADER_KEYS.has(header[1].toLowerCase()) && !section) {
      const key = header[1].toLowerCase();
      const value = header[2].trim();
      switch (key) {
        case 'title': song.title = value; break;
        case 'artist': song.artist = value; break;
        case 'key': song.key = value; break;
        case 'id': song.id = value; break;
        case 'source': (song.sources ??= []).push(value); break;
        case 'capo':
        case 'bpm': {
          const n = Number(value);
          if (!Number.isFinite(n) || n < 0) throw new ParseError(`${key} must be a number`, lineNo);
          song[key] = n;
          break;
        }
      }
      return;
    }

    const sec = /^\[(.+?)(?:\s+[x×](\d+))?\]$/.exec(trimmed);
    if (sec) {
      section = { name: sec[1].trim(), lines: [] };
      if (sec[2]) {
        const n = Number(sec[2]);
        if (n < 1) throw new ParseError('repeat must be at least 1', lineNo);
        if (n > 1) section.repeat = n;
      }
      song.sections.push(section);
      return;
    }

    // Chord line, with an optional "# label" (a '#' preceded by whitespace or at start).
    let body = trimmed;
    let label: string | undefined;
    const lab = /(?:^|\s)#\s*(.*)$/.exec(body);
    if (lab) {
      label = lab[1].trim() || undefined;
      body = body.slice(0, lab.index).trim();
    }
    const chords: ChordEvent[] = [];
    for (const tokRaw of body.split(/\s+/)) {
      const tok = tokRaw.replace(/^\|+|\|+$/g, '');
      if (!tok) continue;
      const m = /^(.+?)(?::(\d+(?:\.\d+)?))?$/.exec(tok)!;
      const name = m[1];
      if (!parseChordName(name)) throw new ParseError(`unknown chord "${name}"`, lineNo);
      const ev: ChordEvent = { chord: name };
      if (m[2] !== undefined) {
        const beats = Number(m[2]);
        if (!(beats > 0)) throw new ParseError(`beats must be > 0 in "${tok}"`, lineNo);
        ev.beats = beats;
      }
      chords.push(ev);
    }
    if (!chords.length && !label) return;
    if (!section) {
      section = { name: 'Song', lines: [] };
      song.sections.push(section);
    }
    const line: Line = { chords };
    if (label) line.label = label;
    section.lines.push(line);
  });

  if (!song.title) throw new ParseError('missing "title:" header', 1);
  if (!song.sections.some((s) => s.lines.some((l) => l.chords.length)))
    throw new ParseError('song has no chords', lines.length);
  if (!song.id) song.id = slugify(song.title);
  return song;
}

/** Inverse of parseSong (modulo whitespace and "|" separators). */
export function serializeSong(song: Song): string {
  const out: string[] = [];
  out.push(`title: ${song.title}`);
  if (song.artist) out.push(`artist: ${song.artist}`);
  if (song.key) out.push(`key: ${song.key}`);
  if (song.capo !== undefined) out.push(`capo: ${song.capo}`);
  if (song.bpm !== undefined) out.push(`bpm: ${song.bpm}`);
  for (const s of song.sources ?? []) out.push(`source: ${s}`);
  for (const sec of song.sections) {
    out.push('');
    out.push(`[${sec.name}${sec.repeat && sec.repeat > 1 ? ` x${sec.repeat}` : ''}]`);
    for (const line of sec.lines) {
      const chords = line.chords.map((c) => (c.beats !== undefined ? `${c.chord}:${c.beats}` : c.chord)).join(' ');
      out.push(line.label ? `${chords}${chords ? ' ' : ''}# ${line.label}` : chords);
    }
  }
  return out.join('\n') + '\n';
}
