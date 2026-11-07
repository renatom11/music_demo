/**
 * Song follower: a hidden-Markov "score follower" over every chord position.
 *
 * Instead of only asking "did the next chord start?", it keeps a probability
 * for *every* position in the song and updates all of them each frame:
 *
 *  - Duration model: each chord is a chain of one sub-state per beat, paced by
 *    a running tempo estimate. Probability mass flows forward through the chain
 *    as time passes, so the model *expects* the next change and is "on top of"
 *    the player rather than reacting late.
 *  - Onset gating: moving to the next chord needs an attack (strum or picked
 *    note) — the closer to the end of the chord, the more likely. Identical
 *    repeated chords (G | G) therefore advance on the strum that lands after
 *    the expected duration.
 *  - Emissions: every chroma frame is scored against every chord; chordal
 *    frames (≥3 pitch classes) count fully, voice-like frames barely count.
 *  - Silence freezes the model (pause). After a pause, or whenever what you
 *    play stops matching, mass re-spreads over the song (weighted toward
 *    section/line starts and nearby positions), so it can find you if you go
 *    back, skip ahead, or start in the middle.
 *  - Display hysteresis: the highlighted chord only changes when another
 *    position clearly wins for `holdMs`.
 */
import { polyphony } from './chroma';
import { chordKey, sameChord, scoreChord } from './chords';

export type FollowerChord = { chord: string; beats: number; lineIndex?: number; lineStart?: boolean; sectionStart?: boolean };

export type FollowerStatus = 'idle' | 'listening' | 'done';

export type FollowerOptions = {
  bpm: number;
  /** tempo estimate is clamped to bpm × [min, max] */
  bpmRange: [number, number];
  /** emission sharpness for chordal frames */
  beta: number;
  /** emission sharpness for non-chordal (e.g. sung) frames */
  weakBeta: number;
  /** pitch classes needed for a "chordal" frame and their relative threshold */
  minPoly: number;
  polyRel: number;
  /** how long an attack keeps the "change chord" gate open */
  onsetWindowMs: number;
  /** probability of leaving a chord at an attack when its duration is up */
  onsetAdvance: number;
  /** fraction of advancing mass that skips a chord */
  skipProb: number;
  /** per-second probability of moving on without a detected attack */
  leakPerSec: number;
  /**
   * Evidence gate: chroma counts fully for `evidenceMs` after an attack and only
   * `idleEvidence`× afterwards. Chord changes come with attacks; a sustained sung
   * note over a ringing chord does not get to rewrite where we are.
   */
  evidenceMs: number;
  idleEvidence: number;
  /** weight of the bass-register chroma in the chord score (when present) */
  bassWeight: number;
  /** re-localisation mass: continuous, per attack, and per attack after a pause */
  jumpPerSec: number;
  jumpOnOnset: number;
  jumpAfterPause: number;
  pauseMs: number;
  /** display: winner must have this much mass and lead the shown position by `lead`× */
  switchMass: number;
  lead: number;
  holdMs: number;
  doneSilenceMs: number;
};

export const DEFAULT_FOLLOWER_OPTIONS: FollowerOptions = {
  bpm: 80,
  bpmRange: [0.6, 1.6],
  beta: 10,
  weakBeta: 1.5,
  minPoly: 3,
  polyRel: 0.35,
  onsetWindowMs: 400,
  onsetAdvance: 0.75,
  skipProb: 0.05,
  leakPerSec: 0.005,
  evidenceMs: 700,
  idleEvidence: 0.2,
  bassWeight: 0.6,
  jumpPerSec: 0.002,
  jumpOnOnset: 0.01,
  jumpAfterPause: 0.3,
  pauseMs: 1500,
  switchMass: 0.4,
  lead: 1.5,
  holdMs: 200,
  doneSilenceMs: 2500,
};

export type PositionChange = { index: number; prev: number; kind: 'advance' | 'skip' | 'jump' | 'manual' };

export type FollowerEvents = {
  position: (e: PositionChange) => void;
  lineChange: (line: number) => void;
  done: () => void;
};

export type FollowerFrame = {
  index: number;
  chordal: boolean;
  polyphony: number;
  current?: { name: string; score: number };
  next?: { name: string; score: number };
  /** probability mass on the shown position */
  confidence: number;
  /** most likely position (may differ from the shown one during hold) */
  best: number;
  /** 0..1, expected progress through the current chord */
  progress: number;
};

export class Follower {
  readonly opts: FollowerOptions;
  index = 0;
  status: FollowerStatus = 'idle';
  bpm: number;
  /** probability mass per chord position */
  readonly mass: Float32Array;

  private K: number[];
  private off: number[];
  private belief: Float64Array;
  private scratch: Float64Array;
  private keys: string[];
  private uniqueKeys: string[];
  private keyIndex: number[];
  private jumpWeight: Float64Array;
  private listeners: { [K in keyof FollowerEvents]: FollowerEvents[K][] } = { position: [], lineChange: [], done: [] };

  private lastTime: number | null = null;
  private lastOnsetTime = -Infinity;
  private lastOnsetStrength = 0;
  private silenceSince: number | null = null;
  private pausedBeforeOnset = true;
  private switchTime = 0;
  private candidate = -1;
  private candidateSince = 0;
  private lastLine = -1;

  constructor(readonly chords: FollowerChord[], opts: Partial<FollowerOptions> = {}) {
    if (!chords.length) throw new Error('Follower needs at least one chord');
    this.opts = { ...DEFAULT_FOLLOWER_OPTIONS, ...opts };
    this.bpm = this.opts.bpm;
    this.K = chords.map((c) => Math.max(1, Math.round(c.beats)));
    this.off = [];
    let s = 0;
    for (const k of this.K) { this.off.push(s); s += k; }
    this.belief = new Float64Array(s);
    this.scratch = new Float64Array(s);
    this.mass = new Float32Array(chords.length);
    this.keys = chords.map((c) => chordKey(c.chord) ?? `?${c.chord}`);
    this.uniqueKeys = [...new Set(this.keys)];
    this.keyIndex = this.keys.map((k) => this.uniqueKeys.indexOf(k));
    // Prior for "where might the player (re)start?": song start > section start > line start > anywhere.
    this.jumpWeight = Float64Array.from(chords, (c, i) =>
      i === 0 ? 4 : c.sectionStart ? 3 : c.lineStart ? 1.5 : 0.3,
    );
    this.place(0);
  }

  on<E extends keyof FollowerEvents>(event: E, cb: FollowerEvents[E]): () => void {
    this.listeners[event].push(cb);
    return () => { this.listeners[event] = this.listeners[event].filter((f) => f !== cb) as never; };
  }

  private emit<E extends keyof FollowerEvents>(event: E, ...args: Parameters<FollowerEvents[E]>): void {
    for (const cb of this.listeners[event]) (cb as (...a: unknown[]) => void)(...args);
  }

  get lineIndex(): number {
    return this.chords[this.index].lineIndex ?? 0;
  }

  /** Map the 0..1 Sensitivity slider onto the model. 0.5 = defaults. */
  setSensitivity(s: number): void {
    const d = DEFAULT_FOLLOWER_OPTIONS;
    const x = Math.max(0, Math.min(1, s));
    this.opts.beta = d.beta * (0.6 + 0.8 * x);
    this.opts.holdMs = d.holdMs * (1.5 - x);
    this.opts.switchMass = d.switchMass * (1.25 - 0.5 * x);
    this.opts.onsetAdvance = Math.min(0.95, d.onsetAdvance * (0.8 + 0.4 * x));
  }

  start(now: number, from = this.index): void {
    this.status = 'listening';
    this.lastTime = null;
    this.silenceSince = null;
    this.pausedBeforeOnset = true;
    this.lastOnsetTime = -Infinity;
    this.place(from, 0.7);
    this.switchTime = now;
    this.setIndex(from, 'manual', now, true);
  }

  stop(): void {
    if (this.status !== 'done') this.status = 'idle';
  }

  /** Reset to the top of the song. */
  restart(now: number): void {
    this.bpm = this.opts.bpm;
    this.status = 'idle';
    this.place(0);
    this.setIndex(0, 'manual', now, true);
  }

  next(now: number): void {
    if (this.index >= this.chords.length - 1) {
      if (this.status === 'listening') this.finish();
      return;
    }
    this.jump(this.index + 1, now);
  }

  back(now: number): void {
    if (this.status === 'done') this.status = 'listening';
    this.jump(Math.max(0, this.index - 1), now);
  }

  /** Manual jump (Next/Back/tap): trust the user completely. */
  jump(index: number, now: number): void {
    const i = Math.max(0, Math.min(this.chords.length - 1, index));
    if (this.status === 'done') this.status = 'listening';
    this.place(i);
    this.candidate = -1;
    // An attack before the tap shouldn't immediately move us again.
    this.lastOnsetTime = -Infinity;
    this.setIndex(i, 'manual', now, true);
  }

  /** Called when an attack is detected. strength: 1 = strum, 0.35 = single note. */
  onset(time: number, strength = 1): void {
    this.lastOnsetTime = time;
    this.lastOnsetStrength = strength;
    this.freshOnset = true;
  }
  private freshOnset = false;

  /** Update the strength of the latest attack as its spread becomes known. */
  refineOnset(strength: number): void {
    this.lastOnsetStrength = strength;
  }

  /**
   * Process one (smoothed) chroma frame. `null` = silence.
   * `bass` is the optional low-register chroma (voice-resistant).
   */
  update(chroma: Float32Array | null, now: number, bass: Float32Array | null = null): FollowerFrame {
    const o = this.opts;
    const dt = this.lastTime === null ? 40 : Math.max(1, Math.min(150, now - this.lastTime));
    this.lastTime = now;
    const poly = chroma ? polyphony(chroma, o.polyRel) : 0;
    const chordal = poly >= o.minPoly;
    const frame = (): FollowerFrame => this.frameInfo(chroma, poly, chordal, now);

    if (this.status !== 'listening') { this.freshOnset = false; return frame(); }

    if (!chroma) {
      this.silenceSince ??= now;
      if (now - this.silenceSince >= o.pauseMs) this.pausedBeforeOnset = true;
      const last = this.chords.length - 1;
      if (
        this.index === last &&
        now - this.silenceSince >= o.doneSilenceMs &&
        now - this.switchTime >= 0.6 * this.chordMs(last)
      ) this.finish();
      this.freshOnset = false;
      return frame();
    }
    this.silenceSince = null;

    this.predict(dt, now);
    const since = now - this.lastOnsetTime;
    const gate = since >= 0 && since <= o.evidenceMs ? o.idleEvidence + (1 - o.idleEvidence) * this.lastOnsetStrength : o.idleEvidence;
    this.observe(chroma, bass, chordal, gate);
    this.freshOnset = false;
    this.updateDisplay(now);
    return frame();
  }

  private chordMs(i: number): number {
    return (this.chords[i].beats * 60000) / this.bpm;
  }

  /** Transition step of the HMM. */
  private predict(dt: number, now: number): void {
    const o = this.opts;
    const b = this.belief;
    const nb = this.scratch.fill(0);
    const n = this.chords.length;
    const beatMs = 60000 / this.bpm;
    const pStep = Math.min(0.9, dt / beatMs);
    const leak = (o.leakPerSec * dt) / 1000;
    const sinceOnset = now - this.lastOnsetTime;
    const gate = sinceOnset >= 0 && sinceOnset <= o.onsetWindowMs;
    const share = gate ? dt / o.onsetWindowMs : 0;

    for (let i = 0; i < n; i++) {
      const K = this.K[i];
      const base = this.off[i];
      const hasNext = i + 1 < n;
      for (let k = 0; k < K; k++) {
        const s = base + k;
        const m = b[s];
        if (m <= 0) continue;
        let toNext = 0;
        let toSkip = 0;
        if (hasNext) {
          // How far through the chord this sub-state is: late sub-states leave readily at an attack.
          const frac = (k + 1) / K;
          const atOnset = 1 - Math.pow(1 - o.onsetAdvance * this.lastOnsetStrength * frac ** 3, share);
          toNext = Math.min(0.95, leak + atOnset);
          if (i + 2 < n && gate) {
            toSkip = toNext * o.skipProb;
            toNext -= toSkip;
          }
        }
        const step = k < K - 1 ? pStep * (1 - toNext - toSkip) : 0;
        nb[s] += m * (1 - toNext - toSkip - step);
        if (step) nb[s + 1] += m * step;
        if (toNext) nb[this.off[i + 1]] += m * toNext;
        if (toSkip) nb[this.off[i + 2]] += m * toSkip;
      }
    }

    // Re-localisation: spread a little mass over plausible restart points.
    let eps = (o.jumpPerSec * dt) / 1000;
    if (this.freshOnset) {
      eps += o.jumpOnOnset;
      if (this.pausedBeforeOnset) eps += o.jumpAfterPause;
      this.pausedBeforeOnset = false;
    }
    if (eps > 0) {
      let wsum = 0;
      const w = this.jumpScratch(this.index);
      for (let i = 0; i < n; i++) wsum += w[i];
      for (let s = 0; s < nb.length; s++) nb[s] *= 1 - eps;
      for (let i = 0; i < n; i++) nb[this.off[i]] += (eps * w[i]) / wsum;
    }
    this.belief.set(nb);
  }

  private jumpW: Float64Array | null = null;
  private jumpScratch(center: number): Float64Array {
    const w = (this.jumpW ??= new Float64Array(this.chords.length));
    for (let i = 0; i < w.length; i++) {
      const d = Math.abs(i - center);
      // Nearby positions (going back a line, repeating a bar) are more likely than far ones.
      w[i] = this.jumpWeight[i] * (1 + 6 * Math.exp(-d / 6));
    }
    return w;
  }

  private scoresScratch: Float64Array | null = null;
  /** Emission step: weight every position by how well its chord matches the frame. */
  private observe(chroma: Float32Array, bass: Float32Array | null, chordal: boolean, gate: number): void {
    const o = this.opts;
    const scores = (this.scoresScratch ??= new Float64Array(this.uniqueKeys.length));
    let maxScore = -Infinity;
    for (let u = 0; u < this.uniqueKeys.length; u++) {
      const firstIdx = this.keyIndex.indexOf(u);
      const name = this.chords[firstIdx].chord;
      scores[u] = bass
        ? (1 - o.bassWeight) * scoreChord(chroma, name) + o.bassWeight * scoreChord(bass, name)
        : scoreChord(chroma, name);
      if (scores[u] > maxScore) maxScore = scores[u];
    }
    const beta = (chordal ? o.beta : o.weakBeta) * gate;
    for (let u = 0; u < scores.length; u++) scores[u] = 0.01 + Math.exp(beta * (scores[u] - maxScore));

    const b = this.belief;
    let total = 0;
    for (let i = 0; i < this.chords.length; i++) {
      const e = scores[this.keyIndex[i]];
      for (let k = 0; k < this.K[i]; k++) {
        b[this.off[i] + k] *= e;
        total += b[this.off[i] + k];
      }
    }
    if (!(total > 0)) { this.place(this.index); return; }
    for (let s = 0; s < b.length; s++) b[s] /= total;
    this.computeMass();
  }

  private computeMass(): void {
    for (let i = 0; i < this.chords.length; i++) {
      let m = 0;
      for (let k = 0; k < this.K[i]; k++) m += this.belief[this.off[i] + k];
      this.mass[i] = m;
    }
  }

  private bestPosition(): number {
    let best = 0;
    for (let i = 1; i < this.mass.length; i++) if (this.mass[i] > this.mass[best]) best = i;
    return best;
  }

  private updateDisplay(now: number): void {
    const o = this.opts;
    const best = this.bestPosition();
    if (best === this.index) { this.candidate = -1; return; }
    const ok = this.mass[best] >= o.switchMass && this.mass[best] >= o.lead * this.mass[this.index];
    if (!ok) { this.candidate = -1; return; }
    if (best !== this.candidate) { this.candidate = best; this.candidateSince = now; return; }
    // Bigger jumps must be more certain/longer-held than a plain advance.
    const forward = best - this.index;
    const hold = forward === 1 || forward === 2 ? o.holdMs : o.holdMs * 2.5;
    if (now - this.candidateSince < hold) return;
    const kind = forward === 1 ? 'advance' : forward === 2 ? 'skip' : 'jump';
    if (kind !== 'jump') this.updateTempo(now, this.index, best);
    this.setIndex(best, kind, now);
    this.candidate = -1;
  }

  private updateTempo(now: number, from: number, to: number): void {
    const interval = now - this.switchTime;
    let beats = 0;
    for (let i = from; i < to; i++) beats += this.chords[i].beats;
    if (interval <= 0 || beats <= 0) return;
    const est = (beats * 60000) / interval;
    if (est < this.bpm * 0.5 || est > this.bpm * 2) return; // probably a miss/stall, not tempo
    const [lo, hi] = this.opts.bpmRange;
    this.bpm = Math.max(this.opts.bpm * lo, Math.min(this.opts.bpm * hi, 0.75 * this.bpm + 0.25 * est));
  }

  private setIndex(i: number, kind: PositionChange['kind'], now: number, force = false): void {
    const prev = this.index;
    if (i === prev && !force) return;
    this.index = i;
    this.switchTime = now;
    this.emit('position', { index: i, prev, kind });
    const line = this.lineIndex;
    if (line !== this.lastLine) {
      this.lastLine = line;
      this.emit('lineChange', line);
    }
  }

  /** Put (most of) the belief on chord `i`. */
  private place(i: number, certainty = 1): void {
    this.belief.fill(0);
    const w = this.jumpScratch(i);
    let wsum = 0;
    for (const v of w) wsum += v;
    for (let j = 0; j < this.chords.length; j++) this.belief[this.off[j]] = ((1 - certainty) * w[j]) / wsum;
    this.belief[this.off[i]] += certainty;
    this.computeMass();
  }

  private finish(): void {
    if (this.status === 'done') return;
    this.status = 'done';
    this.emit('done');
  }

  private frameInfo(chroma: Float32Array | null, poly: number, chordal: boolean, now: number): FollowerFrame {
    const cur = this.chords[this.index];
    const nxt = this.chords[this.index + 1];
    return {
      index: this.index,
      chordal,
      polyphony: poly,
      current: chroma ? { name: cur.chord, score: scoreChord(chroma, cur.chord) } : undefined,
      next: chroma && nxt ? { name: nxt.chord, score: scoreChord(chroma, nxt.chord) } : undefined,
      confidence: this.mass[this.index],
      best: this.bestPosition(),
      progress: Math.min(1, (now - this.switchTime) / this.chordMs(this.index)),
    };
  }

  /** True when chords i and i+1 are the same chord (timing decides the change). */
  isRepeat(i: number): boolean {
    return i + 1 < this.chords.length && sameChord(this.chords[i].chord, this.chords[i + 1].chord);
  }
}
