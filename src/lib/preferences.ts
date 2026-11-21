/**
 * The preferences this app keeps in the webview's own storage, and the one
 * signal that they were cleared.
 *
 * A preference lives under a key the user never sees, in `localStorage`. That is
 * fine until the user asks to clear everything: then "everything this app saved"
 * has to include these keys, and the app has to fall back to the documented
 * default without a restart, because a stored value it just deleted cannot keep
 * governing the window.
 *
 * So there is one reset channel: `clearSavedData` removes the keys and announces
 * it, and every preference that owns a key listens and returns to its default.
 * The default is not written back by that reset — the point of clearing is that
 * there is no stored choice — which is why the listener has to tell the
 * preference's own persistence not to fire for the change it caused. See
 * `useBeep`.
 */

/** The beep preference, as it has been stored since the sidebar toggle. */
export const BEEP_KEY = "pm4studio.beep";

/** The documented default: a fresh install beeps. */
export const DEFAULT_BEEP = true;

/** The stored beep preference, or the default. */
export function loadBeepPreference(storage?: Pick<Storage, "getItem"> | null): boolean {
  const source = storage ?? (typeof localStorage === "undefined" ? null : localStorage);
  if (!source) return DEFAULT_BEEP;
  try {
    const stored = source.getItem(BEEP_KEY);
    return stored === null ? DEFAULT_BEEP : stored === "1";
  } catch {
    return DEFAULT_BEEP;
  }
}

const listeners = new Set<() => void>();

/** Listen for "the stored preferences were cleared". */
export function subscribePreferenceReset(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tell every preference that its stored value is gone. */
export function notifyPreferenceReset(): void {
  for (const listener of [...listeners]) listener();
}
