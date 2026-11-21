import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { classifyDeviceFailure } from "../lib/readerIdentity";
import type { DeviceInfo, HfCard, LfCard } from "../types";

export type Status =
  | "idle"
  | "connecting"
  | "connected"
  | "absent"
  | "wedged"
  | "error";

export const POLL_INTERVAL_MS = 380;

/** Connection state plus the reader operations every page shares. */
export function useReader() {
  const [status, setStatus] = useState<Status>("idle");
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  /** Firmware revision reported by the Reader, e.g. `H00S07`. */
  const [firmware, setFirmware] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const connect = useCallback(async () => {
    setStatus("connecting");
    setError(null);
    try {
      const d = await invoke<DeviceInfo>("connect");
      if (!mounted.current) return;
      setInfo(d);
      setStatus("connected");
    } catch (e) {
      if (!mounted.current) return;
      setError(String(e));
      // The badge states what is wrong, not merely that something is: an
      // unplugged Reader is a normal state, not a fault.
      const failure = classifyDeviceFailure(String(e));
      setStatus(
        failure === "absent" ? "absent" : failure === "wedged" ? "wedged" : "error",
      );
      setInfo(null);
      setFirmware(null);
      return;
    }

    // The revision is asked for after the handle is open, and its wait is
    // bounded in Rust, so a silent Reader cannot hold the shell in "connecting".
    try {
      const revision = await invoke<string>("firmware_version");
      if (!mounted.current) return;
      setFirmware(revision);
    } catch (e) {
      if (!mounted.current) return;
      setFirmware(null);
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void connect();
  }, [connect]);

  const readLfOnce = useCallback(async (): Promise<LfCard | null> => {
    try {
      return await invoke<LfCard | null>("lf_poll");
    } catch (e) {
      setError(String(e));
      return null;
    }
  }, []);

  const pollHfOnce = useCallback(async (): Promise<HfCard | null> => {
    try {
      return await invoke<HfCard | null>("hf_poll");
    } catch (e) {
      setError(String(e));
      return null;
    }
  }, []);

  return {
    status,
    info,
    firmware,
    error,
    setError,
    connect,
    connected: status === "connected",
    readLfOnce,
    pollHfOnce,
  };
}

/**
 * Polls the 125 kHz field while `active` is true and hands every latched tag to
 * `onTag`. Only one interval ever runs, so the device is never hit twice.
 *
 * A transport failure that means the Reader is gone or wedged stops the loop and
 * is reported through `onFault`, so an empty field is never mistaken for a dead
 * device — and a dead device is never polled forever.
 */
export function useLfPoller(
  active: boolean,
  enabled: boolean,
  onTag: (card: LfCard) => void,
  onFault?: (message: string) => void,
) {
  const onTagRef = useRef(onTag);
  useEffect(() => {
    onTagRef.current = onTag;
  }, [onTag]);
  const onFaultRef = useRef(onFault);
  useEffect(() => {
    onFaultRef.current = onFault;
  }, [onFault]);

  useEffect(() => {
    if (!active || !enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (cancelled) return;
      try {
        const card = await invoke<LfCard | null>("lf_poll");
        if (cancelled) return;
        if (card) {
          onTagRef.current(card);
          return; // caller decides whether to keep polling
        }
      } catch (e) {
        // An empty field is silent, not an error. A real transport failure is a
        // device fault: report it once and stop hammering the handle.
        const failure = classifyDeviceFailure(String(e));
        if (failure === "wedged" || failure === "absent" || failure === "claimed") {
          onFaultRef.current?.(String(e));
          return;
        }
      }
      if (!cancelled) timer = setTimeout(tick, POLL_INTERVAL_MS);
    };

    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, enabled]);
}
