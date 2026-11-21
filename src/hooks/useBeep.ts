import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { legacyChirp } from "../lib/outcome";
import {
  BEEP_KEY,
  DEFAULT_BEEP,
  loadBeepPreference,
  subscribePreferenceReset,
} from "../lib/preferences";
import { subscribeSignals } from "../lib/signal";

/**
 * Beeper preference, plus the pre-seam `chirp()` helper the unwired pages still
 * carry.
 *
 * The beep frame is fire-and-forget: the firmware never acknowledges it, but the
 * buzzer does sound. A failed chirp must never break the operation it accompanies,
 * so errors are swallowed here.
 *
 * This hook no longer decides what to sound in response to an operation — the
 * outcome seam does. It installs the one subscriber that plays signals on this
 * Reader, and `chirp()` emits a `done` symbol through the seam rather than sending
 * the frame itself. The preference still gates the frame, and is still stored under
 * `pm4studio.beep`; the three-way quiet level that replaces it, and the counted
 * alphabet that replaces one chirp per symbol, are ticket 04's work — they change
 * what this subscriber does, not how a signal reaches it.
 *
 * Components must not reach the beeper any other way (ADR 0008). `chirp` is the
 * last exception, it is marked as such in `lib/outcome.ts`, and ticket 17 deletes
 * it.
 */
export function useBeep() {
  const [beepOn, setBeepOn] = useState<boolean>(() => loadBeepPreference());
  const beepOnRef = useRef(beepOn);
  // Set when the change came from the stored value being cleared rather than
  // from the user: the default then governs the window, but it is not written
  // back, because the point of clearing is that no choice is stored.
  const clearingReset = useRef(false);

  useEffect(() => {
    beepOnRef.current = beepOn;
    if (clearingReset.current) {
      clearingReset.current = false;
      return;
    }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(BEEP_KEY, beepOn ? "1" : "0");
    }
  }, [beepOn]);

  // Clear-all-saved-data removes the key; the preference falls back to the
  // documented default here, without a restart and without re-storing it.
  useEffect(
    () =>
      subscribePreferenceReset(() => {
        setBeepOn((current) => {
          clearingReset.current = current !== DEFAULT_BEEP;
          return DEFAULT_BEEP;
        });
      }),
    [],
  );

  // The audible half of the seam, played. One frame per symbol today; ticket 04
  // turns a symbol into its count of chirps and holds the LED after attention.
  useEffect(
    () =>
      subscribeSignals(() => {
        if (!beepOnRef.current) return;
        void invoke("beep").catch(() => {
          // Never let a beep failure surface as an operation failure.
        });
      }),
    [],
  );

  const chirp = useCallback(async () => {
    legacyChirp();
  }, []);

  return { beepOn, setBeepOn, chirp };
}
