import { NOTE_NAMES, chordPitchClasses, type RankedChord } from '../audio/chords';
import { gradeNote, IN_TUNE_CENTS, type HeardNote } from '../audio/notes';
import { h } from './dom';

export type DebugInfo = {
  chroma: Float32Array | null;
  levelDb: number;
  polyphony?: number;
  top?: RankedChord[];
  current?: { name: string; score: number };
  next?: { name: string; score: number };
  onsetAgoMs?: number | null;
  /** belief mass per chord position (tracker) */
  belief?: Float32Array;
  position?: number;
  confidence?: number;
  bpm?: number;
  /** the chord that should be sounding now */
  expected?: string;
  /** notes picked out of the spectrum */
  notes?: HeardNote[];
  /** raw analyser frame (dB) and its bin width, for the spectrum view */
  spectrum?: Float32Array;
  binHz?: number;
  sampleRate?: number;
  /** frame was below the silence floor (the tracker ignored it) */
  silent?: boolean;
};

const SPEC_MIN_HZ = 70;
const SPEC_MAX_HZ = 1400;

const GRADE_LABEL = { good: 'in chord', off: 'in chord, out of tune', wrong: 'not in chord' } as const;

/** Live "what I hear" view + chroma bars, top-3 chords, expected-chord scores, input meter. */
export class DebugPanel {
  readonly el: HTMLElement;
  private bars: HTMLElement[] = [];
  private meter: HTMLElement;
  private levelText: HTMLElement;
  private topEl: HTMLElement;
  private scoresEl: HTMLElement;
  private trackEl: HTMLElement;
  private beliefEl: HTMLElement;
  private beliefBars: HTMLElement[] = [];
  private expectedEl: HTMLElement;
  private notesEl: HTMLElement;
  private statusEl: HTMLElement;
  private canvas: HTMLCanvasElement;
  readonly recordBtn: HTMLButtonElement;

  constructor(onRecord: () => void) {
    const chroma = h('div.chroma', { 'aria-hidden': 'true' });
    for (let i = 0; i < 12; i++) {
      const b = h('div.bar');
      this.bars.push(b);
      chroma.append(b);
    }
    this.meter = h('div');
    this.levelText = h('span', { text: '—' });
    this.topEl = h('div.pre', { text: '—' });
    this.scoresEl = h('div.pre', { text: '—' });
    this.trackEl = h('div.full', { text: '' });
    this.beliefEl = h('div.belief', { title: 'Where the tracker thinks you are in the song' });
    this.expectedEl = h('div.expected');
    this.notesEl = h('div.heard', { 'aria-live': 'off' });
    this.statusEl = h('div.full.mic-status');
    this.canvas = h('canvas.spectrum', { height: 90, 'aria-label': 'Live spectrum' });
    this.recordBtn = h('button.btn.small', { type: 'button', onclick: onRecord }, '● Record 15 s clip');
    this.el = h(
      'div.debug',
      { hidden: true },
      h(
        'div.full.hearing',
        {},
        this.expectedEl,
        this.notesEl,
        h(
          'div.legend',
          {},
          h('span.note-chip.good', { text: 'in chord' }),
          h('span.note-chip.off', { text: `out of tune (>${IN_TUNE_CENTS}¢)` }),
          h('span.note-chip.wrong', { text: 'not in chord' }),
        ),
      ),
      h('div.full', {}, this.canvas),
      this.statusEl,
      chroma,
      h('div.chroma-labels', {}, ...NOTE_NAMES.map((n) => h('span', { text: n }))),
      h('div', {}, h('div.k', { text: 'Top chords' }), this.topEl),
      h('div', {}, h('div.k', { text: 'Expected' }), this.scoresEl),
      h('div.full', {}, h('div.k', {}, 'Input ', this.levelText), h('div.meter', {}, this.meter)),
      this.beliefEl,
      this.trackEl,
      h('div.full.row', {}, this.recordBtn, h('span.hint', { text: 'Saves a short recording of what the mic hears, to share for tuning.' })),
    );
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  set visible(v: boolean) {
    this.el.hidden = !v;
  }

  update(info: DebugInfo): void {
    if (!this.visible) return;
    this.updateHearing(info);
    this.drawSpectrum(info);

    const curPcs = new Set(info.expected ? chordPitchClasses(info.expected) : []);
    let max = 0;
    if (info.chroma) for (const v of info.chroma) max = Math.max(max, v);
    this.bars.forEach((b, i) => {
      const v = info.chroma && max > 0 ? info.chroma[i] / max : 0;
      b.style.height = `${Math.round(v * 100)}%`;
      b.classList.toggle('in-cur', curPcs.has(i));
    });
    const lvl = Number.isFinite(info.levelDb) ? info.levelDb : -100;
    this.meter.style.width = `${Math.max(0, Math.min(100, ((lvl + 80) / 80) * 100))}%`;
    this.levelText.textContent = `${lvl.toFixed(0)} dBFS${info.polyphony !== undefined ? ` · ${info.polyphony} pitch classes` : ''}`;
    this.topEl.textContent = info.top?.length ? info.top.map((t) => `${t.name.padEnd(5)} ${t.score.toFixed(2)}`).join('\n') : '—';
    const fmt = (x?: { name: string; score: number }) => (x ? `${x.name.padEnd(5)} ${x.score.toFixed(2)}` : '—');
    this.scoresEl.textContent = `cur  ${fmt(info.current)}\nnext ${fmt(info.next)}`;
    const parts: string[] = [];
    if (info.confidence !== undefined) parts.push(`sure ${(info.confidence * 100).toFixed(0)}%`);
    if (info.bpm !== undefined) parts.push(`${info.bpm.toFixed(0)} bpm`);
    if (info.onsetAgoMs !== undefined) parts.push(info.onsetAgoMs === null ? 'no strum yet' : `last strum ${(info.onsetAgoMs / 1000).toFixed(1)} s ago`);
    this.trackEl.textContent = parts.join(' · ');
    if (info.belief) this.drawBelief(info.belief, info.position ?? -1);
  }

  private updateHearing(info: DebugInfo): void {
    const pcs = info.expected ? chordPitchClasses(info.expected).map((pc) => NOTE_NAMES[pc]) : [];
    this.expectedEl.replaceChildren(
      h('span.k', { text: 'Should hear ' }),
      h('strong', { text: info.expected ?? '—' }),
      pcs.length ? h('span.k', { text: ` (${pcs.join(' ')})` }) : '',
    );
    const notes = info.notes ?? [];
    if (!notes.length) {
      this.notesEl.replaceChildren(h('span.k', { text: 'Hearing: nothing' }));
    } else {
      this.notesEl.replaceChildren(
        ...notes.map((n) => {
          const grade = gradeNote(n, info.expected);
          const chip = h(
            `span.note-chip.${grade}`,
            { title: `${n.name} ${n.freq.toFixed(1)} Hz, ${n.cents >= 0 ? '+' : ''}${n.cents} cents — ${GRADE_LABEL[grade]}` },
            h('b', { text: n.name }),
            ` ${n.freq.toFixed(0)} Hz `,
            h('span.cents', { text: `${n.cents >= 0 ? '+' : '−'}${Math.abs(n.cents)}¢` }),
          );
          chip.style.opacity = String(0.45 + 0.55 * n.strength);
          return chip;
        }),
      );
    }
    const sr = info.sampleRate ? `${(info.sampleRate / 1000).toFixed(1)} kHz` : '—';
    const res = info.binHz ? ` · ${info.binHz.toFixed(1)} Hz/bin` : '';
    const state = info.silent
      ? notes.length
        ? '⚠ too quiet — ignored as silence (raise Sensitivity or move closer)'
        : 'silence'
      : 'listening';
    this.statusEl.textContent = `Mic ${sr}${res} · ${state}`;
    this.statusEl.classList.toggle('warn', !!info.silent && notes.length > 0);
  }

  private drawSpectrum(info: DebugInfo): void {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth || 340;
    const hgt = 90;
    if (c.width !== Math.round(w * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(hgt * dpr);
    }
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hgt);
    const css = getComputedStyle(this.el);
    const col = (v: string, fb: string) => css.getPropertyValue(v).trim() || fb;
    const xOf = (f: number) => (Math.log(f / SPEC_MIN_HZ) / Math.log(SPEC_MAX_HZ / SPEC_MIN_HZ)) * w;

    // Guide lines at every octave of the expected chord's notes.
    const pcs = new Set(info.expected ? chordPitchClasses(info.expected) : []);
    g.font = '9px ui-monospace, monospace';
    for (let midi = 36; midi <= 90; midi++) {
      const f = 440 * Math.pow(2, (midi - 69) / 12);
      if (f < SPEC_MIN_HZ || f > SPEC_MAX_HZ) continue;
      const pc = midi % 12;
      const x = xOf(f);
      if (pcs.has(pc)) {
        g.fillStyle = col('--good', '#2fa84f');
        g.globalAlpha = 0.18;
        g.fillRect(x - 1.5, 0, 3, hgt - 10);
        g.globalAlpha = 0.9;
        g.fillText(NOTE_NAMES[pc], x - 3, hgt - 1);
      } else if (pc === 4 || pc === 9) {
        // faint E and A gridlines for orientation
        g.fillStyle = col('--muted', '#888');
        g.globalAlpha = 0.25;
        g.fillRect(x, 0, 1, hgt - 10);
      }
      g.globalAlpha = 1;
    }

    // Spectrum curve.
    const spec = info.spectrum;
    if (spec && info.binHz) {
      const top = Math.max(-30, ...Array.from(spec.subarray(Math.floor(SPEC_MIN_HZ / info.binHz), Math.ceil(SPEC_MAX_HZ / info.binHz))).filter(Number.isFinite));
      const floor = top - 60;
      g.beginPath();
      let started = false;
      for (let px = 0; px <= w; px += 1) {
        const f = SPEC_MIN_HZ * Math.pow(SPEC_MAX_HZ / SPEC_MIN_HZ, px / w);
        const k = f / info.binHz;
        const k0 = Math.floor(k);
        const d = Math.max(spec[k0] ?? -200, spec[k0 + 1] ?? -200);
        const y = (hgt - 12) * (1 - Math.max(0, Math.min(1, (d - floor) / (top - floor)))) + 1;
        if (!started) { g.moveTo(px, y); started = true; } else g.lineTo(px, y);
      }
      g.strokeStyle = col('--text', '#ddd');
      g.globalAlpha = 0.65;
      g.lineWidth = 1.2;
      g.stroke();
      g.globalAlpha = 1;
    }

    // Detected notes.
    for (const n of info.notes ?? []) {
      const grade = gradeNote(n, info.expected);
      g.fillStyle = col(`--${grade}`, grade === 'good' ? '#2fa84f' : grade === 'off' ? '#e0b000' : '#d9534f');
      const x = xOf(n.freq);
      g.beginPath();
      g.arc(x, 8, 5, 0, Math.PI * 2);
      g.fill();
    }
  }

  private drawBelief(belief: Float32Array, pos: number): void {
    if (this.beliefBars.length !== belief.length) {
      this.beliefBars = Array.from(belief, () => h('div'));
      this.beliefEl.replaceChildren(...this.beliefBars);
    }
    let max = 0;
    for (const v of belief) max = Math.max(max, v);
    this.beliefBars.forEach((b, i) => {
      b.style.height = `${max > 0 ? Math.round((belief[i] / max) * 100) : 0}%`;
      b.classList.toggle('cur', i === pos);
    });
  }
}
