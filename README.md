# ChordFollow 🎸

A free, mobile-first web app that **listens to you play guitar** and follows a chord chart. It highlights the chord you're on, outlines the next one, shows fingering diagrams, and scrolls as you play. It tries hard to ignore your singing.

- **Live:** _not deployed yet. See [Deploy](#deploy) and put the Pages URL here._
- **Demo song:** "Being Alive" (Eleri Ward cover, Sondheim). Chords only, no lyrics.
- **$0 to run:** no backend, no accounts, no analytics, no network calls after load. All the audio processing runs in your browser with the Web Audio API.

## How it follows you

Most chord followers ask "did the next chord just start?". ChordFollow instead keeps a probability for **every position in the song** and updates all of them about 25 times a second (an HMM score follower):

- **Duration model + tempo tracking:** it knows how long each chord should last at your current tempo, so it expects the next change and shows a progress bar under the current chord.
- **Attack-gated changes:** chords change on a strum or picked note. Repeated chords (`G | G`) advance on the strum that lands after the chord's length.
- **Singing rejection:** polyphony gate, a check for single harmonic series (voice-like attacks), a separate bass-register chroma (your low strings sit below most singing), and chord evidence counted mainly right after attacks.
- **Pauses and jumps:** silence freezes it. If you go back a line, restart a verse, skip a chord or start in the middle, it finds you ("Found you → Verse 2/3").
- **Fingerpicking works too.**
- ◀ ▶ and tapping any chord always override it.

Details and trade-offs are in [DECISIONS.md](DECISIONS.md).

## Use it

1. Open the site on your phone and pick a song.
2. Tap **Start listening** and allow the microphone.
3. Play. Lean the phone against something near the guitar.
4. Use the **Sensitivity** slider: left = only clear, loud playing; right = quiet playing and fast reactions.
5. **⚙** opens the debug panel: live chroma, top 3 chords, current vs next score, input level, the tracker's belief over the song, and tempo.
6. Tap a diagram to switch between full and easy shapes.

## Run locally

Needs Node 18+ (22 recommended).

```bash
npm install
npm run dev        # http://localhost:5173 (mic works on localhost)
npm test           # unit tests (Vitest, synthetic audio, no mic needed)
npm run build      # type-check + production build into dist/
npm run e2e        # optional: real-browser test with a fake mic (needs Playwright + Chromium)
```

To test on a phone during development, the page must be served over HTTPS (browsers only allow the mic on HTTPS or localhost). Deploy a preview, or use a tunnel.

**No guitar?** Open `/test.html` on a laptop. It plays synthesized strums, the whole Being Alive progression, and a "voice sweep over G" into the speakers, so you can point the app (on a phone, or another tab) at it.

## Deploy

Cloudflare Pages (free, HTTPS included, which the mic needs).

**From your machine:**

```bash
npx wrangler login
npx wrangler pages project create chordfollow --production-branch main   # first time only
npm run deploy     # = npm run build && wrangler pages deploy dist --project-name chordfollow
```

Wrangler prints the URL (e.g. `https://chordfollow.pages.dev`). Put it at the top of this README.

**From GitHub Actions:** `.github/workflows/deploy.yml` runs the tests, builds, and deploys on every push to `main`. Add these repository secrets:

- `CLOUDFLARE_API_TOKEN`: a token with the *Cloudflare Pages: Edit* permission
- `CLOUDFLARE_ACCOUNT_ID`

## Add a song

Tap **+ Add song** in the app and paste a chart in this format. Songs you add are saved on your device (localStorage).

```
title: Being Alive
artist: Eleri Ward (Stephen Sondheim)
key: G
bpm: 76
source: https://example.com/where-the-chords-came-from

[Intro]
G Em | G Em

[Verse x3]
G Em
G:2 Em:2        # ":2" = 2 beats (default 4)
Bm Em C   # build   ← optional label after " #"
Am D
```

- `[Name]` starts a section; `[Name xN]` repeats it N times.
- Each line of chords is one chart line. `|` is only visual.
- Headers: `title` (required), `artist`, `key`, `bpm`, `capo`, `source` (repeatable).
- Supported chords: major, `m`, `7`, `maj7`, `m7`, `sus2`, `sus4`, `dim`, plus `5`, `6`, `m6`, `add9`, `9`, `aug`, `dim7`, `m7b5`, `7sus4`, sharps/flats and slash chords (`D/F#`).
- **Chords only. Please don't paste lyrics.**

To ship a song with the app, add a file next to `src/song/songs/being-alive.ts` and list it in `BUILT_IN` in `src/main.ts`.

## Code map

```
src/
  main.ts                 screens: song picker, add/edit song, player
  testpage.ts             /test.html tone generator
  audio/
    mic.ts                getUserMedia (no voice DSP) → 70 Hz high-pass → AnalyserNode(8192)
    chroma.ts             FFT frame → 12-bin chroma (+ bass chroma), EMA smoother, polyphony
    onset.ts              spectral-flux onsets, spread, monophonic (voice) detection
    chords.ts             chord-name parser, weighted templates, cosine scoring, rankAll
    follower.ts           HMM score follower (position, tempo, pause, re-localisation)
    pipeline.ts           frame → chroma → onsets → follower (shared by app and tests)
    synth.ts              plucked-string synth (tests and /test.html)
  song/
    types.ts parse.ts flatten.ts store.ts shapes.ts songs/being-alive.ts
  ui/
    player.ts chart.ts diagram.ts controls.ts debug.ts wakelock.ts dom.ts storage.ts
tests/                    Vitest specs + AnalyserNode emulation helpers
scripts/                  fake-mic WAV generator + Playwright e2e
```

## Sources for the demo chart

Chords from free community charts. Check them against the recording.

- https://tabs.ultimate-guitar.com/tab/eleri-ward/being-alive-chords-4357019
- https://chordify.net/chords/eleri-ward-songs/being-alive-chords
