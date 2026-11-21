/**
 * The one signal that a preference's stored value was cleared, and what that
 * means for the module that owns it.
 *
 * Preferences live under keys the user never sees, in `localStorage`: the quiet
 * level (`lib/quietLevel`) and the message corner (`lib/toastCorner`). That is
 * fine until the user asks to clear everything this app saved — then "everything"
 * has to include those keys, and the app has to fall back to the documented
 * default without a restart, because a stored value it just deleted cannot keep
 * governing the window.
 *
 * So there is one reset channel. `lib/clearData` removes the keys and announces
 * it here, and every preference that owns a key listens and returns to its
 * default. The default is not written back by that reset — the point of clearing
 * is that there is no stored choice — which is why a listener has to set its
 * state directly instead of calling the setter that persists. See `useBeep`,
 * which sets the level without saving it.
 *
 * The keys themselves are deliberately not listed here: each preference owns its
 * own key, and `lib/clearData`'s registry names them. A preference added to this
 * app belongs in that registry, or clearing saved data will leave it behind and
 * grow a stored choice back on the next launch.
 */

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
