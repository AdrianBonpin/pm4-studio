import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DeviceInfo, HfCard, LfCard } from "../types";

export type Status = "idle" | "connecting" | "connected" | "error";

export const POLL_INTERVAL_MS = 380;

/** Connection state plus the reader operations every page shares. */
export function useReader() {
  const [status, setStatus] = useState<Status>("idle");
  const [info, setInfo] = useState<DeviceInfo | null>(null);
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
      setStatus("error");
      setInfo(null);
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
 */
export function useLfPoller(
  active: boolean,
  enabled: boolean,
  onTag: (card: LfCard) => void,
) {
  const onTagRef = useRef(onTag);
  useEffect(() => {
    onTagRef.current = onTag;
  }, [onTag]);

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
      } catch {
        // Transient read failures are normal while the field is empty.
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
