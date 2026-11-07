import { NOTE_NAMES, chordPitchClasses, type RankedChord } from '../audio/chords';
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
};

/** Live chroma bars, top-3 chords, expected-chord scores, input meter. */
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

  constructor() {
    const chroma = h('div.chroma', { 'aria-hidden': 'true' });
    for (let i = 0; i < 12; i++) {
      const b = h('div.bar');
      this.bars.push(b);
      chroma.append(b);
    }
    this.meter = h('div');
    this.levelText = h('span', { text: '—' });
    this.topEl = h('div', { text: '—' });
    this.scoresEl = h('div', { text: '—' });
    this.trackEl = h('div.full', { text: '' });
    this.beliefEl = h('div.belief', { title: 'Where the tracker thinks you are' });
    this.el = h(
      'div.debug',
      { hidden: true },
      chroma,
      h('div.chroma-labels', {}, ...NOTE_NAMES.map((n) => h('span', { text: n }))),
      h('div', {}, h('div.k', { text: 'Top chords' }), this.topEl),
      h('div', {}, h('div.k', { text: 'Expected' }), this.scoresEl),
      h('div.full', {}, h('div.k', {}, 'Input ', this.levelText), h('div.meter', {}, this.meter)),
      this.beliefEl,
      this.trackEl,
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
    const curPcs = info.current ? new Set(chordPitchClasses(info.current.name)) : new Set<number>();
    let max = 0;
    if (info.chroma) for (const v of info.chroma) max = Math.max(max, v);
    this.bars.forEach((b, i) => {
      const v = info.chroma && max > 0 ? info.chroma[i] / max : 0;
      b.style.height = `${Math.round(v * 100)}%`;
      b.classList.toggle('in-cur', curPcs.has(i));
    });
    const lvl = Number.isFinite(info.levelDb) ? info.levelDb : -100;
    this.meter.style.width = `${Math.max(0, Math.min(100, ((lvl + 80) / 80) * 100))}%`;
    this.levelText.textContent = `${lvl.toFixed(0)} dBFS${info.polyphony !== undefined ? ` · ${info.polyphony} notes` : ''}`;
    this.topEl.textContent = info.top?.length
      ? info.top.map((t) => `${t.name.padEnd(5)} ${t.score.toFixed(2)}`).join('\n')
      : '—';
    this.topEl.style.whiteSpace = 'pre';
    const fmt = (x?: { name: string; score: number }) => (x ? `${x.name.padEnd(5)} ${x.score.toFixed(2)}` : '—');
    this.scoresEl.style.whiteSpace = 'pre';
    this.scoresEl.textContent = `cur  ${fmt(info.current)}\nnext ${fmt(info.next)}`;
    const parts: string[] = [];
    if (info.confidence !== undefined) parts.push(`conf ${(info.confidence * 100).toFixed(0)}%`);
    if (info.bpm !== undefined) parts.push(`${info.bpm.toFixed(0)} bpm`);
    if (info.onsetAgoMs !== undefined) parts.push(info.onsetAgoMs === null ? 'no onset' : `onset ${Math.round(info.onsetAgoMs)} ms ago`);
    this.trackEl.textContent = parts.join(' · ');
    if (info.belief) this.drawBelief(info.belief, info.position ?? -1);
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
