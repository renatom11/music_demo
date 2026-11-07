# Decisions

Choices made while building ChordFollow without stopping for questions. Each one says what changed from the spec, or what the spec left open.

## Project / hosting

- **Repo:** the code lives in the existing `renatom11/music_demo` repository on branch `claude/modest-mayer-mthz1s`, not a new `chordfollow` repo. The build session could only reach this repository, so `gh repo create` wasn't possible. The npm package is still named `chordfollow`.
- **Deploy:** the build session had no Cloudflare login, so `wrangler pages deploy` couldn't run. Two ways to deploy are set up:
  - `npm run deploy` (local, after `npx wrangler login`)
  - `.github/workflows/deploy.yml`: tests, builds and deploys on every push to `main` once the repo has `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets.
  The live URL goes in the README after the first deploy.
- **Dependencies:** zero runtime dependencies. Dev only: Vite 5, TypeScript 5, Vitest 2, @types/node.

## Scope change: a probabilistic follower instead of a next-chord state machine

The product owner asked for a tracker that is "on top of you": it predicts where you're going, copes with pauses, finds you when you go back or start mid-song, and is smart rather than just matching the current chord. So `follower.ts` is a **hidden-Markov score follower** instead of the spec's §4 state machine. It still meets every behaviour §4 asks for:

| Spec §4 rule | How the HMM covers it |
|---|---|
| compare current vs next chord | every position is scored each frame; neighbours dominate through the transition model |
| `nxt > cur + margin`, `nxt > minScore` | emission sharpness `beta` (Sensitivity) + display hysteresis (`switchMass`, `lead`) |
| onset within ~400 ms | moving to the next chord only happens near an attack (`onsetWindowMs`); chroma evidence is also gated by attacks (`evidenceMs`) |
| hold ≥ 200 ms | display hysteresis `holdMs` (Sensitivity-scaled) |
| same chord repeated | per-beat duration chain: G\|G changes on the strum after the expected duration |
| tempo from recent changes | running bpm estimate from detected changes, clamped to 0.6–1.6× the chart bpm |
| lookahead +2 (skipped chord) | `skipProb` transition to i+2 |
| manual Next/Back reset | `jump()` puts all belief on the chosen position and ignores earlier attacks |

New beyond the spec:
- **Pause:** silence freezes the model, and nothing advances while you stop.
- **Re-localisation:** a little probability always flows to likely restart points: song start, section starts, line starts, and nearby positions. After a pause (≥1.5 s) the first attack spreads much more. So it finds you if you go back a line, restart a verse, skip ahead, or start mid-song. A UI toast says "Found you → Verse 2/3".
- **Prediction:** a progress bar under the current chord shows how far through it the model thinks you are, at the current tempo.
- **Fingerpicking:** the Eleri Ward recording is fingerpicked, so single-note attacks also open the change gate (with less weight), and evidence builds up across the arpeggio. Tested with a synthesized arpeggio.

### "Detecting individual notes" (spec §10, out of scope)
The owner said this shouldn't be out of scope. v1 handles it the way that matters for following: individual note attacks drive the tracker, and the chroma builds up picked notes into a chord. Showing which note or string you played (tabs) is still not built. The groundwork is in place (peak-picked pitches in `chroma.ts`, harmonic-series analysis in `onset.ts`).

## Audio pipeline

- **Chroma uses spectral peaks, not every bin** (with parabolic interpolation). At 8192 points / 48 kHz each bin is about 5.9 Hz, wider than a semitone below ~100 Hz. The analyser's Blackman window also smears each partial over ~6 bins. Peak picking keeps pitches sharp and ignores the noise floor.
- **Bass chroma (< 200 Hz):** a second chroma from the guitar's low register. Most singing, and nearly all of a female voice, sits above it. The chord score is 40 % full chroma + 60 % bass chroma when the bass has energy. This was the most effective single change for singing rejection.
- **Singing rejection layers:** the spec's polyphony gate (≥3 pitch classes at ≥35 %; non-chordal frames get a much flatter emission). On top of that:
  - Attack gating: chroma counts fully for 700 ms after an attack and 20 % otherwise, so a held sung note can't slowly drag the position.
  - Monophonic-attack detection: if ≥85 % of the new energy fits one harmonic series, it's a voice or single note and only weakly opens the gate.
  - The bass chroma above.
- **Onset detector:** the 170 ms analyser window makes one strum rise over 3–4 frames. A decaying envelope of recent flux (`peakRel`) and a level-relative floor keep it to one onset per strum. "Spread" (how many pitch classes gained energy) is counted only at spectral peaks, over the 3 frames after the attack.
- **Processing rate:** about 25 Hz (every ~38 ms), driven by `requestAnimationFrame`.
- **iOS:** the `AudioContext` is created and resumed synchronously inside the Start tap, before `getUserMedia` is awaited. The analyser goes through a muted gain to the destination, because some Safari versions don't process nodes that aren't connected.
- **Sensitivity slider** (0–1, default 0.5): scales emission sharpness, hold time, switch threshold, onset `k`, the minimum flux and the silence floor together.

## Background hum removal (added after the first real-guitar test)

Reported symptom: "it hears B minor really well, but not E minor or G". Mains hum on a 60 Hz grid shows up at 120, 180, 240, 300 and 360 Hz, which are B2, F#3, B3, D4 and F#4, each 40–50¢ off. That is a **B minor chord**. Simulated hum alone ranks Bm first (0.92), and quiet Em/G/C/D strums drift toward Bm as they decay. The tell-tale sign in the note view is a set of notes sitting ~40–50¢ out of tune.

Fix, in `chroma.ts`:
- **Steady-tone detection:** each frequency bin keeps its last ~1.2 s of levels (30 frames). A bin that stayed within 3 dB the whole time is background. Plucked strings decay faster than ~2.5 dB/s, so they never qualify. A slower subtraction that learned anything sustained also removed held guitar chords and was rejected.
- **Learned profile:** once a bin is background, its level is remembered (fading over ~20 s) and subtracted with a ~4 dB margin while you play over it, so hum doesn't leak back in during a strum.
- **Warm-up:** the first ~1.2 s after Start are spent learning the room. The mic dot is amber and frames count as silence. Without this, Start → hum → "Bm" made the follower jump to the Bm position before you played.
- **Chord clock from the first strum:** after Start or a manual jump, the current chord's duration is timed from your first attack, not from the tap.
- The ⚙ panel lists the background tones being ignored ("Ignoring background hum: 120 Hz 180 Hz …").

Tests: hum alone → Bm without the filter, silence with it; quiet Em/G/C/D/Bm over hum are recognised correctly; a long-ringing Em is not filtered; the follower makes exactly 8 clean advances over three hum levels. Plus a real-browser e2e (`E2E_HUM=0.005 E2E_GUITAR=0.015 npm run e2e`).

## "What I hear" troubleshooting view

- Notes come from the same interpolated spectral peaks as the chroma. Peaks that sit on an overtone (2–6×, within 30¢) of a lower peak are folded into it, so a G strum reads "G2 B2 D3", not a dozen partials. Octave-doubled strings fold into the lower string; that's unavoidable from the spectrum alone.
- Showing fewer chips than strings is expected: an octave-doubled string (E2 + E3 + E4 in Em) folds into the lowest one, so Em shows as E, B, G.
- Grading is against the chord the chart currently highlights: green = chord tone within ±15¢, yellow = chord tone further out (up to ±50¢, after which it rounds to the neighbouring note and turns red), red = not a chord tone.
- Peaks are reported even when the frame is below the silence floor, so the panel can say "too quiet — ignored as silence" instead of looking dead.
- The clip recorder uses MediaRecorder on the raw mic stream (webm/opus, or m4a on iOS).

## Song format

- `# label` at the end of a chord line adds a user label (never lyrics). Only a `#` after whitespace counts, so `F#m` still parses.
- Lines before any `[Section]` go into a section called "Song".
- `source:` headers (repeatable) hold chart links; `capo:` is supported.
- Custom songs are stored as their source text in `localStorage` (`chordfollow:songs`). They can be edited and deleted, and their ids never collide with built-in songs.
- Being Alive uses exactly the spec's chart (Intro + Verse ×3, 76 bpm). The UI shows the "check against the recording" note and links to both sources.

## UI

- The chart shows every line. The current line is large, the previous line dimmed above, the next line below, and it scrolls smoothly so the current line sits about 28 % from the top. A tinted current pill means the tracker is unsure (< 35 % confidence).
- Tapping the diagrams switches between full and easy shapes (Bm, F, F#m, Bb, Em7, G). The choice is remembered.
- While the debug panel is open, the diagrams are hidden so everything fits on a phone.
- The Sensitivity, debug and easy-shapes settings persist in localStorage, with every read and write in try/catch.

## Testing

- 95 unit tests (Vitest). They use synthetic audio: plucked-string synthesis plus an exact emulation of `AnalyserNode.getFloatFrequencyData` (Blackman window, |X|/N, dB).
- Follower scenarios cover:
  - the spec's 8-advance progression, plus a tempo different from the chart
  - latency under 600 ms
  - a voice sweep, a sustained sung E, and an E/B-heavy sung melody at three loudness levels over a held G
  - G|G timing, pause/resume, starting mid-song, going back a line, a skipped chord
  - a fingerpicked progression, background noise, and the Done state
- `npm run e2e` drives the built app in headless Chromium with a WAV as the fake microphone, through the real Web Audio path. Result: all 30 Being Alive changes followed in order, each about 0.3–0.6 s after the strum.

## Known limitations

- It was tuned on synthesized guitar. Real guitars, rooms and phone mics will need tuning with real recordings. The debug panel (chroma, top chords, belief strip, tempo, onset age) exists for this.
- Very loud singing over a single strum left to decay for many seconds can still win. Strumming again fixes it right away.
- Chords not in the template set (e.g. 13ths) fall back to "unknown" in the parser. Add them to `QUALITIES` in `chords.ts`.
