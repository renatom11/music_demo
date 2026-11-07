import { parseSong } from '../parse';

/**
 * Chords only — no lyrics. From free community charts; check against the recording.
 */
export const BEING_ALIVE_TEXT = `title: Being Alive
artist: Eleri Ward (Stephen Sondheim)
key: G
bpm: 76
source: https://tabs.ultimate-guitar.com/tab/eleri-ward/being-alive-chords-4357019
source: https://chordify.net/chords/eleri-ward-songs/being-alive-chords

[Intro]
G Em | G Em

[Verse x3]
G Em
G Em
Bm Em C
Am D
`;

export const beingAlive = { ...parseSong(BEING_ALIVE_TEXT), id: 'being-alive' };
export const SOURCE_NOTE = 'Chords from free community charts — check against the recording.';
