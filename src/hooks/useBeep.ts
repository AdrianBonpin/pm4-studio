/**
 * The shell's beeper: the quiet level, and the one subscriber that plays signals.
 *
 * `report(outcome)` hands one symbol to the audible half of the seam (ADR 0008).
 * This hook is the only thing in the app that listens for those symbols, and the
 * only thing that reaches the beeper. What it adds to the seam is everything the
 * signal needs to become a sound:
 *
 *   * **The quiet level gates it.** Off plays nothing, errors and warnings only
 *     plays the failure and needs-checking symbols, and All plays everything the
 *     alphabet defines. The level is read from storage when a symbol arrives, so
 *     changing it in Settings takes effect on the next signal without a reload.
 *   * **The alphabet decides the count.** The symbol is handed to
 *     `lib/signalQueue`, which asks `lib/chirpSequence` how many chirps, how far
 *     apart, and whether the LED is held — one chirp for done, two for needs-you,
 *     three for attention with the LED held for two seconds, and nothing at all
 *     for silence.
 *   * **A beeper failure is never an operation's failure.** The chirp frame is
 *     fire-and-forget and the firmware never acknowledges it, so every send is
 *     swallowed here. The signal is never the only report of an outcome.
 *
 * The level's own migration lives in `lib/quietLevel`, which reads the boolean
 * preference this replaced rather than reinterpreting it.
 *
 * There is exactly one way into the beeper and it is the seam: `report(outcome)`
 * is what emits a symbol, and this subscriber is the only thing that plays one.
 * Nothing else in the app can make a sound, which is why an operation that
 * forgets to report itself is a visible gap rather than a silence (ADR 0008).
 *
 * Clear-all-saved-data is the third thing here: it removes the stored keys this
 * preference is read from, so the hook listens for that and returns the level to
 * its documented default in the window that is already open — without writing the
 * default back, because the point of clearing is that no choice is stored.
 */

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { subscribePreferenceReset } from "../lib/preferences";
import {
  DEFAULT_QUIET_LEVEL,
  audibleAt,
  loadQuietLevel,
  saveQuietLevel,
  type QuietLevel,
} from "../lib/quietLevel";
import { createSignalQueue, type SignalTimers } from "../lib/signalQueue";
import { subscribeSignals } from "../lib/signal";

/** Test seam: the clock the queue schedules chirps with. Production omits it. */
export interface UseBeepOptions {
  readonly timers?: SignalTimers;
}

export function useBeep(options: UseBeepOptions = {}) {
  const [quietLevel, setQuietLevelState] = useState<QuietLevel>(() => loadQuietLevel());

  // Installed once, as the shell's single subscriber. A second one would play
  // every signal twice, which is why Settings receives the level as a prop
  // instead of calling this hook itself.
  useEffect(() => {
    const player = createSignalQueue({
      timers: options.timers,
      effects: {
        // Both frames are fire-and-forget: the firmware acknowledges neither, so
        // there is nothing to report but the fact that the frame was sent, and a
        // failure here stops here. Never let a beep failure surface as an
        // operation failure.
        chirp: () => {
          void invoke("beep").catch(() => {});
        },
        releaseLed: () => {
          void invoke("led_off").catch(() => {});
        },
      },
    });

    const stop = subscribeSignals((symbol) => {
      // Read on arrival rather than mirrored in a ref, so the level in force is
      // always the one stored — a preference changed seconds ago is honoured.
      if (!audibleAt(loadQuietLevel(), symbol)) return;
      player.enqueue(symbol);
    });

    return () => {
      stop();
      player.clear();
    };
    // The timers are a test seam and do not change over a component's life, so the
    // subscriber is installed once and removed with the shell.
  }, []);

  // Clear-all-saved-data removes the keys this preference is read from, so the
  // level shown in Settings has to fall back with them. Set here rather than
  // re-read from storage, because there is nothing left in storage to read, and
  // deliberately not saved: a cleared preference must stay cleared.
  useEffect(
    () => subscribePreferenceReset(() => setQuietLevelState(DEFAULT_QUIET_LEVEL)),
    [],
  );

  const setQuietLevel = useCallback((level: QuietLevel) => {
    setQuietLevelState(level);
    saveQuietLevel(level);
  }, []);

  return { quietLevel, setQuietLevel };
}
