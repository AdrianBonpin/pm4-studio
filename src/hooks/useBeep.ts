import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

const KEY = "pm4studio.beep";

/**
 * Beeper preference plus a chirp helper.
 *
 * The reader's beep frame (0x0055) is fire-and-forget: the firmware never
 * acknowledges it, but the buzzer does sound. A failed chirp must never break
 * the operation it accompanies, so errors are swallowed here.
 */
export function useBeep() {
  const [beepOn, setBeepOn] = useState<boolean>(() => {
    if (typeof localStorage === "undefined") return true;
    const v = localStorage.getItem(KEY);
    return v === null ? true : v === "1";
  });
  const ref = useRef(beepOn);

  useEffect(() => {
    ref.current = beepOn;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(KEY, beepOn ? "1" : "0");
    }
  }, [beepOn]);

  const chirp = useCallback(async () => {
    if (!ref.current) return;
    try {
      await invoke("beep");
    } catch {
      // Never let a beep failure surface as an operation failure.
    }
  }, []);

  return { beepOn, setBeepOn, chirp };
}
