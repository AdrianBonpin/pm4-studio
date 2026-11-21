/**
 * The one operation that owns the Reader at a time, as far as the webview knows.
 *
 * The backend already serialises every device call behind one mutex, so two
 * operations can never interleave on the wire. What the mutex cannot do is stop
 * the *polling* loop from asking a question during a write: a poll reply would be
 * read by the Rust stream before or after the write's own frames, and on the
 * 125 kHz path a stale read has already been mistaken for a write result once.
 *
 * So a long operation announces itself here, and the pollers check before each
 * tick. Nothing is queued or delayed: a poll during a write is simply not sent.
 * The write therefore sees the Reader alone, which is what the spec's
 * "background polling runs only when no operation holds the lock" asks for.
 *
 * Deliberately tiny and dependency-free: it is a flag with listeners, not a
 * scheduler, and it never fails a write.
 */

let depth = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // A broken listener must never break the operation that announced itself:
      // this flag exists to protect a write, not to gate it on UI code.
    }
  }
}

/**
 * Take the Reader for one operation. Returns the release function, which is
 * safe to call more than once and is the only way the flag goes back down.
 *
 * The depth counter exists because releasing must be possible from a `finally`
 * as well as from a component unmount; nesting is not otherwise expected.
 */
export function beginDeviceOperation(): () => void {
  depth += 1;
  notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    depth = Math.max(0, depth - 1);
    notify();
  };
}

/** True while any operation holds the Reader, so pollers must not touch it. */
export function isDeviceBusy(): boolean {
  return depth > 0;
}

/** Called whenever the flag changes. Returns the unsubscribe function. */
export function subscribeDeviceBusy(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only: drop every hold, so one test cannot leak a hold into the next. */
export function resetDeviceOperationsForTest(): void {
  depth = 0;
  notify();
}
