import { Mic, MicError } from '../audio/mic';
import { Follower, type FollowerChord } from '../audio/follower';
import { ChordPipeline } from '../audio/pipeline';
import { rankAll } from '../audio/chords';
import { flattenSong, type FlatSong } from '../song/flatten';
import { DEFAULT_BPM, type Song } from '../song/types';
import { ChartView } from './chart';
import { Controls } from './controls';
import { DebugPanel } from './debug';
import { h } from './dom';
import { storage } from './storage';

const PROCESS_MS = 38; // ~25 Hz analysis

export type PlayerOptions = { onExit: () => void; note?: string; sources?: string[] };

export function followerChords(flat: FlatSong): FollowerChord[] {
  return flat.chords.map((c) => {
    const line = flat.lines[c.lineIndex];
    return { chord: c.chord, beats: c.beats, lineIndex: c.lineIndex, lineStart: c.posInLine === 0, sectionStart: c.posInLine === 0 && line.sectionStart };
  });
}

/** The listening screen: chart, diagrams, controls, debug panel. */
export class Player {
  readonly el: HTMLElement;
  private flat: FlatSong;
  private follower: Follower;
  private pipeline: ChordPipeline | null = null;
  private mic = new Mic();
  private chart: ChartView;
  private controls: Controls;
  private debug = new DebugPanel();
  private micDot = h('div.mic-dot', { title: 'Microphone' });
  private sectionEl = h('div.section');
  private toastEl = h('div.toast', { role: 'status', 'aria-live': 'polite' });
  private overlay: HTMLElement | null = null;
  private raf = 0;
  private lastProcess = 0;
  private toastTimer = 0;
  private sensitivity: number;
  private starting = false;

  constructor(readonly song: Song, opts: PlayerOptions) {
    this.flat = flattenSong(song);
    this.follower = new Follower(followerChords(this.flat), { bpm: song.bpm ?? DEFAULT_BPM });
    this.sensitivity = Number(storage.get('sensitivity') ?? 0.5);
    this.follower.setSensitivity(this.sensitivity);
    this.chart = new ChartView(this.flat, (i) => this.follower.jump(i, performance.now()));
    this.controls = new Controls(
      {
        onStartStop: () => void this.toggle(),
        onBack: () => this.follower.back(performance.now()),
        onNext: () => this.follower.next(performance.now()),
        onSensitivity: (v) => this.setSensitivity(v),
        onToggleDebug: () => this.toggleDebug(),
      },
      this.sensitivity,
    );
    if (storage.get('debug') === '1') { this.debug.visible = true; this.controls.setDebugActive(true); }

    this.follower.on('position', (e) => {
      this.render();
      if (e.kind === 'jump') this.toast(`Found you → ${this.where(e.index)}`);
    });
    this.follower.on('done', () => this.showDone());

    const sources = opts.sources ?? song.sources ?? [];
    this.el = h(
      'div.player',
      {},
      h(
        'div.topbar',
        {},
        h('button.back-link', { type: 'button', 'aria-label': 'Back to songs', onclick: () => { this.destroy(); opts.onExit(); } }, '‹'),
        h('div.titles', {}, h('div.song-title', { text: song.title }), this.sectionEl),
        this.micDot,
      ),
      this.toastEl,
      this.chart.el,
      this.extraSlot(),
      opts.note
        ? h('div.note', {}, opts.note, ...sources.flatMap((s, i) => [' ', h('a', { href: s, target: '_blank', rel: 'noopener', text: `[${i + 1}]` })]))
        : null,
      this.debug.el,
      this.controls.el,
    );
    this.render(false);
  }

  /** Hook for subclasses / later milestones to add UI between chart and controls. */
  protected extraSlot(): HTMLElement | null {
    return null;
  }

  private where(index: number): string {
    const line = this.flat.lines[this.flat.chords[index].lineIndex];
    return line.passes > 1 ? `${line.sectionName} ${line.pass + 1}/${line.passes}` : line.sectionName;
  }

  protected render(smooth = true): void {
    const i = this.follower.index;
    this.chart.setPosition(i, smooth);
    this.sectionEl.textContent = this.where(i);
    this.onPosition(i);
  }

  /** Called whenever the shown position changes. */
  protected onPosition(_index: number): void {}

  private setSensitivity(v: number): void {
    this.sensitivity = v;
    storage.set('sensitivity', String(v));
    if (this.pipeline) this.pipeline.setSensitivity(v);
    else this.follower.setSensitivity(v);
  }

  private toggleDebug(): void {
    this.debug.visible = !this.debug.visible;
    this.controls.setDebugActive(this.debug.visible);
    storage.set('debug', this.debug.visible ? '1' : '0');
  }

  private toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 1800);
  }

  async toggle(): Promise<void> {
    if (this.mic.running) return this.stop();
    if (this.starting) return;
    this.starting = true;
    this.controls.setStartEnabled(false, 'Starting…');
    try {
      await this.mic.start(); // inside the tap: creates + resumes the AudioContext
      this.pipeline = new ChordPipeline(this.follower, this.mic.sampleRate, this.mic.fftSize, this.sensitivity);
      if (this.follower.status === 'done') this.follower.restart(performance.now());
      this.follower.start(performance.now());
      this.controls.setStartEnabled(true);
      this.controls.setListening(true);
      this.onListening(true);
      this.lastProcess = 0;
      this.raf = requestAnimationFrame(this.loop);
    } catch (e) {
      this.controls.setStartEnabled(true);
      this.controls.setListening(false);
      this.toast(e instanceof MicError ? e.message : `Could not start: ${e}`);
    } finally {
      this.starting = false;
    }
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.mic.stop();
    this.follower.stop();
    this.pipeline = null;
    this.micDot.classList.remove('on');
    this.controls.setListening(false);
    this.onListening(false);
  }

  /** Called when listening starts/stops. */
  protected onListening(_on: boolean): void {}

  private loop = (t: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    if (t - this.lastProcess < PROCESS_MS || !this.pipeline) return;
    this.lastProcess = t;
    const r = this.pipeline.process(this.mic.getFrame(), t);
    this.micDot.classList.toggle('on', r.raw !== null);
    this.chart.setUncertain(r.confidence < 0.35);
    this.chart.setProgress(r.progress);
    if (this.debug.visible) {
      this.debug.update({
        chroma: r.chroma,
        levelDb: this.mic.getLevelDb(),
        polyphony: r.polyphony,
        top: r.chroma ? rankAll(r.chroma, 3) : [],
        current: r.current,
        next: r.next,
        onsetAgoMs: r.lastOnset ? t - r.lastOnset.time : null,
        belief: this.follower.mass,
        position: r.index,
        confidence: r.confidence,
        bpm: this.follower.bpm,
      });
    }
  };

  private showDone(): void {
    this.overlay?.remove();
    this.overlay = h(
      'div.done-overlay',
      {},
      h('div', { text: 'Done 🎸' }),
      h('button.btn.primary', { type: 'button', onclick: () => this.restart() }, 'Restart'),
    );
    this.el.append(this.overlay);
  }

  restart(): void {
    this.overlay?.remove();
    this.overlay = null;
    const now = performance.now();
    this.follower.restart(now);
    if (this.mic.running) this.follower.start(now, 0);
  }

  destroy(): void {
    this.stop();
    clearTimeout(this.toastTimer);
  }
}
