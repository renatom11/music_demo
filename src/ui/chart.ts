import type { FlatSong } from '../song/flatten';
import { h } from './dom';

/** Renders the expanded chord chart and highlights the current / next position. */
export class ChartView {
  readonly el: HTMLElement;
  private pills: HTMLElement[] = [];
  private lineEls: HTMLElement[] = [];
  private current = -1;
  private currentLine = -1;

  constructor(private song: FlatSong, private onJump: (index: number) => void) {
    this.el = h('div.chart', { role: 'list', 'aria-label': 'Chord chart' });
    song.lines.forEach((line, li) => {
      const header =
        line.sectionStart &&
        h('div.section-name', {
          text: line.passes > 1 ? `${line.sectionName} ${line.pass + 1}/${line.passes}` : line.sectionName,
        });
      const pills = line.chords.map((c, pos) => {
        const index = line.start + pos;
        const pill = h(
          'button.pill',
          { type: 'button', 'data-index': index, 'aria-label': `Jump to ${c.chord}`, onclick: () => this.onJump(index) },
          c.chord,
          c.beats !== undefined && c.beats !== 4 ? h('span.beats', { text: `${c.beats}` }) : null,
        );
        this.pills[index] = pill;
        return pill;
      });
      const lineEl = h(
        'div.line',
        { role: 'listitem', 'data-line': li },
        header,
        h('div.pills', {}, ...pills),
        line.label ? h('div.label', { text: line.label }) : null,
      );
      this.lineEls.push(lineEl);
      this.el.append(lineEl);
    });
    this.el.append(h('div.chart-end'));
  }

  /** Highlight position `index`; `next` gets a subtle outline. `smooth` scrolls with animation. */
  setPosition(index: number, smooth = true): void {
    if (index === this.current) return;
    this.pills.forEach((p, i) => {
      p.classList.toggle('current', i === index);
      p.classList.toggle('next', i === index + 1);
      p.classList.toggle('played', i < index);
    });
    this.current = index;
    const line = this.song.chords[Math.min(index, this.song.chords.length - 1)]?.lineIndex ?? 0;
    if (line !== this.currentLine) {
      this.lineEls.forEach((el, i) => {
        el.classList.toggle('current', i === line);
        el.classList.toggle('prev', i === line - 1);
        el.classList.toggle('next', i === line + 1);
        el.classList.toggle('past', i < line - 1);
      });
      this.currentLine = line;
      this.scrollToLine(line, smooth);
    }
  }

  /** Mark positions the tracker is unsure about (e.g. while re-locating). */
  setUncertain(uncertain: boolean): void {
    this.el.classList.toggle('uncertain', uncertain);
  }

  scrollToLine(line: number, smooth = true): void {
    const el = this.lineEls[line];
    if (!el) return;
    // Keep the previous line visible above the current one.
    const top = el.offsetTop - this.el.clientHeight * 0.28;
    this.el.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
  }
}
