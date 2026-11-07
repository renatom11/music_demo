/** Screen Wake Lock while listening; fails silently where unsupported. */
type Sentinel = { release: () => Promise<void>; addEventListener?: (t: 'release', cb: () => void) => void };

export class WakeLock {
  private sentinel: Sentinel | null = null;
  private wanted = false;
  private onVisible = () => {
    if (this.wanted && document.visibilityState === 'visible' && !this.sentinel) void this.request();
  };

  async acquire(): Promise<void> {
    this.wanted = true;
    document.addEventListener('visibilitychange', this.onVisible);
    await this.request();
  }

  private async request(): Promise<void> {
    try {
      const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<Sentinel> } }).wakeLock;
      if (!wl) return;
      this.sentinel = await wl.request('screen');
      // The browser drops the lock when the tab is hidden; re-acquire on return.
      this.sentinel.addEventListener?.('release', () => { this.sentinel = null; });
    } catch {
      /* unsupported, denied, or low battery — ignore */
    }
  }

  async release(): Promise<void> {
    this.wanted = false;
    document.removeEventListener('visibilitychange', this.onVisible);
    try { await this.sentinel?.release(); } catch { /* ignore */ }
    this.sentinel = null;
  }
}
