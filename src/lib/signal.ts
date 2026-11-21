/**
 * The audible half of the outcome seam.
 *
 * Four symbols, distinguished by count and by absence (ADR 0009): one chirp is
 * *done*, two are *needs you*, three are *attention*, and silence means nothing
 * happened — which is a symbol, not a failure to signal. The symbol is not chosen
 * by whoever reports; it is derived from the outcome's severity in `outcome.ts`,
 * so a message and the sound it makes cannot disagree.
 *
 * `report` is the only caller of `emitSignal` in the app, with one marked
 * exception (`legacyChirp` in `outcome.ts`) for call sites ticket 17 rewires.
 * Nothing here reaches the hardware: turning a symbol into chirps — counts, gaps,
 * the two-second LED hold, a bounded queue, the three-way quiet level — is
 * ticket 04's work, and it arrives by subscribing here. A beep failure is
 * swallowed by the subscriber: the signal is never the only report of an outcome
 * and never gates the operation that produced it.
 */

/** The alphabet. Silence is a member so "nothing happened" is sayable. */
export type SignalSymbol = "done" | "needs-you" | "attention" | "silent";

/** Called once per emitted symbol, in the order the outcomes were reported. */
export type SignalListener = (symbol: SignalSymbol) => void;

const listeners = new Set<SignalListener>();

/**
 * Listen for symbols. Returns the unsubscribe, because a hook that stops playing
 * a signal must not leave its listener behind.
 */
export function subscribeSignals(listener: SignalListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Hand one symbol to whoever is playing signals.
 *
 * Silence is dropped here rather than passed on, so a subscriber never has to
 * decide whether "silent" means "do nothing" or "stop" — it means there is
 * nothing to play. Iterating a copy keeps a listener that unsubscribes during
 * playback from changing the set mid-loop.
 */
export function emitSignal(symbol: SignalSymbol): void {
  if (symbol === "silent") return;
  for (const listener of [...listeners]) listener(symbol);
}
