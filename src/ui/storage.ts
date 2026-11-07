/** localStorage that never throws (private mode, blocked storage, quota). */
export const storage = {
  get(key: string): string | null {
    try { return localStorage.getItem(`chordfollow:${key}`); } catch { return null; }
  },
  set(key: string, value: string): void {
    try { localStorage.setItem(`chordfollow:${key}`, value); } catch { /* ignore */ }
  },
};
