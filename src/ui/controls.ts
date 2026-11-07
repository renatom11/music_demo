import { h } from './dom';

export type ControlHandlers = {
  onStartStop: () => void;
  onBack: () => void;
  onNext: () => void;
  onSensitivity: (value: number) => void;
  onToggleDebug: () => void;
};

/** Bottom bar: ◀ ▶, Start/Stop, ⚙, sensitivity slider. */
export class Controls {
  readonly el: HTMLElement;
  private startBtn: HTMLButtonElement;
  private debugBtn: HTMLButtonElement;
  readonly slider: HTMLInputElement;

  constructor(handlers: ControlHandlers, sensitivity: number) {
    this.startBtn = h('button.start', { type: 'button', onclick: handlers.onStartStop }, 'Start listening');
    this.debugBtn = h('button.icon', { type: 'button', 'aria-label': 'Toggle debug panel', onclick: handlers.onToggleDebug }, '⚙');
    this.slider = h('input', {
      type: 'range', min: 0, max: 1, step: 0.05, value: sensitivity, 'aria-label': 'Sensitivity',
      oninput: (e: Event) => handlers.onSensitivity(Number((e.target as HTMLInputElement).value)),
    });
    this.el = h(
      'div.controls',
      {},
      h(
        'div.nav',
        {},
        h('button', { type: 'button', 'aria-label': 'Back', onclick: handlers.onBack }, '◀'),
        h('button', { type: 'button', 'aria-label': 'Next', onclick: handlers.onNext }, '▶'),
      ),
      this.startBtn,
      this.debugBtn,
      h('label.sens', {}, 'Sensitivity', this.slider),
    );
  }

  setListening(listening: boolean): void {
    this.startBtn.textContent = listening ? 'Stop' : 'Start listening';
    this.startBtn.classList.toggle('stop', listening);
  }

  setStartEnabled(enabled: boolean, label?: string): void {
    this.startBtn.disabled = !enabled;
    if (label) this.startBtn.textContent = label;
  }

  setDebugActive(active: boolean): void {
    this.debugBtn.classList.toggle('active', active);
  }
}
