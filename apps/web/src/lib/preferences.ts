/** Per-browser conveniences only (active org, last tab). Never relied on for correctness. */
export function readPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(`arenacore:${key}`);
  } catch {
    return null;
  }
}

export function writePreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(`arenacore:${key}`, value);
  } catch {
    // Storage unavailable (private mode); the preference simply isn't remembered.
  }
}
