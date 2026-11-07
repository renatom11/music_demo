import { Mic, MicError } from '../audio/mic';
import { Follower, type FollowerChord } from '../audio/follower';
import { ChordPipeline } from '../audio/pipeline';
import { rankAll } from '../audio/chords';
import { detectNotes } from '../audio/notes';
import { flattenSong, type FlatSong } from '../song/flatten';
import { DEFAULT_BPM, type Song } from '../song/types';
import { ChartView } from './chart';
import { Controls } from './controls';
import { DebugPanel } from './debug';
import { h } from './dom';
import { storage } from './storage';
import { renderDiagram } from './diagram';
import { WakeLock } from './wakelock';

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
  private debug = new DebugPanel(() => void this.record());
  private recording = false;
  private micDot = h('div.mic-dot', { title: 'Microphone' });
  private sectionEl = h('div.section');
  private toastEl = h('div.toast', { role: 'status', 'aria-live': 'polite' });
  private overlay: HTMLElement | null = null;
  private raf = 0;
  private lastProcess = 0;
  private toastTimer = 0;
  private sensitivity: number;
  private starting = false;
  private diagrams = h('div.diagrams', { title: 'Tap to switch between full and easy shapes' });
  private easyShapes = storage.get('easy') === '1';
  private wake = new WakeLock();

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
    this.el.classList.toggle('debugging', this.debug.visible);
    this.render(false);
  }

  private extraSlot(): HTMLElement {
    this.diagrams.addEventListener('click', () => {
      this.easyShapes = !this.easyShapes;
      storage.set('easy', this.easyShapes ? '1' : '0');
      this.drawDiagrams(this.follower.index);
    });
    return this.diagrams;
  }

  private drawnDiagrams = '';
  private drawDiagrams(i: number): void {
    const cur = this.flat.chords[i]?.chord;
    const nxt = this.flat.chords[i + 1]?.chord;
    const key = `${cur}|${nxt}|${this.easyShapes}`;
    if (key === this.drawnDiagrams) return;
    this.drawnDiagrams = key;
    const big = renderDiagram(cur, { scale: 1.1, easy: this.easyShapes });
    const parts: HTMLElement[] = [big];
    if (nxt) {
      const small = renderDiagram(nxt, { scale: 0.75, easy: this.easyShapes });
      small.classList.add('small');
      small.append(h('div.caption', { text: `next: ${nxt}` }));
      parts.push(small);
    }
    big.append(h('div.caption', { text: cur }));
    this.diagrams.replaceChildren(...parts);
  }

  private where(index: number): string {
    const line = this.flat.lines[this.flat.chords[index].lineIndex];
    return line.passes > 1 ? `${line.sectionName} ${line.pass + 1}/${line.passes}` : line.sectionName;
  }

  private render(smooth = true): void {
    const i = this.follower.index;
    this.chart.setPosition(i, smooth);
    this.sectionEl.textContent = this.where(i);
    this.onPosition(i);
  }

  private onPosition(index: number): void {
    this.drawDiagrams(index);
  }

  private setSensitivity(v: number): void {
    this.sensitivity = v;
    storage.set('sensitivity', String(v));
    if (this.pipeline) this.pipeline.setSensitivity(v);
    else this.follower.setSensitivity(v);
  }

  private toggleDebug(): void {
    this.debug.visible = !this.debug.visible;
    this.controls.setDebugActive(this.debug.visible);
    this.el.classList.toggle('debugging', this.debug.visible);
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
    this.micDot.classList.remove('on', 'learning');
    this.controls.setListening(false);
    this.onListening(false);
  }

  private onListening(on: boolean): void {
    if (on) void this.wake.acquire();
    else void this.wake.release();
  }

  private loop = (t: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    if (t - this.lastProcess < PROCESS_MS || !this.pipeline) return;
    this.lastProcess = t;
    const r = this.pipeline.process(this.mic.getFrame(), t);
    this.micDot.classList.toggle('on', r.raw !== null);
    this.micDot.classList.toggle('learning', r.learning);
    this.chart.setUncertain(r.confidence < 0.35);
    this.chart.setProgress(r.progress);
    if (this.debug.visible) {
      const frame = this.mic.getFrame();
      this.debug.update({
        expected: this.flat.chords[r.index]?.chord,
        notes: detectNotes(r.peaks),
        spectrum: frame,
        binHz: this.mic.sampleRate / this.mic.fftSize,
        sampleRate: this.mic.sampleRate,
        silent: r.silent,
        learning: r.learning,
        background: this.pipeline.chroma.backgroundTones(),
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

  /** Record a short clip of the raw mic input and download it (for tuning/troubleshooting). */
  private async record(): Promise<void> {
    const stream = this.mic.mediaStream;
    const btn = this.debug.recordBtn;
    if (!stream) { this.toast('Tap Start listening first'); return; }
    if (this.recording || typeof MediaRecorder === 'undefined') {
      if (typeof MediaRecorder === 'undefined') this.toast('Recording is not supported in this browser');
      return;
    }
    const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported?.(t));
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    } catch (e) {
      this.toast(`Could not record: ${e}`);
      return;
    }
    this.recording = true;
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise<void>((res) => { rec.onstop = () => res(); });
    rec.start();
    for (let left = 15; left > 0 && this.mic.running; left--) {
      btn.textContent = `■ Recording… ${left}s`;
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (rec.state !== 'inactive') rec.stop();
    await done;
    this.recording = false;
    btn.textContent = '● Record 15 s clip';
    const mime = rec.mimeType || type || 'audio/webm';
    const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
    const url = URL.createObjectURL(new Blob(chunks, { type: mime }));
    const a = h('a', { href: url, download: `chordfollow-${this.song.id}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    this.toast('Recording saved');
  }

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
