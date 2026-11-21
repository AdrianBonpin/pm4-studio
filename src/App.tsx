import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Nfc, Radio, ScanLine, Terminal, Cpu, X } from "lucide-react";
import { Badge } from "./components/ui/Badge";
import { Button } from "./components/ui/Button";
import { Card } from "./components/ui/Card";
import { Input } from "./components/ui/Input";
import { isMacOS, isTauri } from "./lib/platform";
import type { DeviceInfo, HfCard, LfCard, RawResponse } from "./types";

type Status = "idle" | "connecting" | "connected" | "error";

const SCAN_TIMEOUT_MS = 30_000;
const SCAN_INTERVAL_MS = 350;

const STATUS_COLOR: Record<Status, string> = {
  idle: "#A1A1AA",
  connecting: "#FBBF24",
  connected: "#4ADE80",
  error: "#F87171",
};

function Field({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[11px] uppercase tracking-wide text-text-muted">{label}</span>
      <span className={`text-sm text-text truncate ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

export default function App() {
  const [status, setStatus] = useState<Status>("idle");
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [lfScanning, setLfScanning] = useState(false);
  const [lfElapsed, setLfElapsed] = useState(0);
  const [lfCard, setLfCard] = useState<LfCard | null>(null);

  const [hfPolling, setHfPolling] = useState(false);
  const [hfCard, setHfCard] = useState<HfCard | null>(null);

  const [rawHex, setRawHex] = useState("55 00 51 00 01 01 FE 01");
  const [rawResult, setRawResult] = useState<RawResponse | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);
  const [rawBusy, setRawBusy] = useState(false);

  const stopRef = useRef(false);

  const connect = useCallback(async () => {
    setStatus("connecting");
    setError(null);
    try {
      const d = await invoke<DeviceInfo>("connect");
      setInfo(d);
      setStatus("connected");
    } catch (e) {
      setError(String(e));
      setStatus("error");
      setInfo(null);
    }
  }, []);

  useEffect(() => {
    void connect();
  }, [connect]);

  useEffect(() => {
    if (!lfScanning) return;
    stopRef.current = false;
    setLfCard(null);
    setLfElapsed(0);
    const started = Date.now();

    const tick = async () => {
      if (stopRef.current) return;
      const elapsed = Date.now() - started;
      setLfElapsed(elapsed);
      if (elapsed > SCAN_TIMEOUT_MS) {
        setLfScanning(false);
        setError("Scan timed out. Place the badge flat on the reader, case off.");
        return;
      }
      try {
        const card = await invoke<LfCard | null>("lf_poll");
        if (stopRef.current) return;
        if (card) {
          setLfCard(card);
          setLfScanning(false);
          return;
        }
      } catch (e) {
        setLfScanning(false);
        setError(String(e));
        return;
      }
      if (!stopRef.current) setTimeout(tick, SCAN_INTERVAL_MS);
    };

    void tick();
    return () => {
      stopRef.current = true;
    };
  }, [lfScanning]);

  const pollHf = async () => {
    setHfPolling(true);
    setError(null);
    try {
      const card = await invoke<HfCard | null>("hf_poll");
      setHfCard(card);
      if (!card) setError("No 13.56 MHz tag in the field.");
    } catch (e) {
      setError(String(e));
    } finally {
      setHfPolling(false);
    }
  };

  const sendRaw = async () => {
    setRawBusy(true);
    setRawError(null);
    setRawResult(null);
    try {
      const r = await invoke<RawResponse | null>("raw_send", { hex: rawHex });
      if (!r) setRawError("No reply within 1.5 s.");
      else setRawResult(r);
    } catch (e) {
      setRawError(String(e));
    } finally {
      setRawBusy(false);
    }
  };

  const beep = async () => {
    try {
      await invoke("beep");
    } catch (e) {
      setError(String(e));
    }
  };

  const connected = status === "connected";
  const progress = Math.min(100, (lfElapsed / SCAN_TIMEOUT_MS) * 100);

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-canvas text-text select-none">
      {/* macOS "Overlay" title bar: in-flow strip the window can be dragged by.
          Traffic lights float over it. Only inside Tauri on macOS. */}
      {isTauri() && isMacOS() && (
        <div data-tauri-drag-region aria-hidden className="h-9 shrink-0 bg-canvas" />
      )}

      <header
        data-tauri-drag-region
        className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-6 py-4"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-raised text-accent-muted">
            <Nfc size={20} />
          </div>
          <div className="min-w-0">
            <h1 className="font-heading text-lg leading-tight text-text">PM4 Studio</h1>
            <p className="truncate text-xs text-text-muted">
              NFC-PM4 · CYBDZKJ-BSJ reader studio
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Badge label={status} color={STATUS_COLOR[status]} />
          <Button variant="secondary" onClick={() => void connect()}>
            {connected ? "Reconnect" : "Connect"}
          </Button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
        <div className="mx-auto flex max-w-4xl flex-col gap-4">
          {error && (
            <div className="flex items-start justify-between gap-3 rounded-xl border border-err/40 bg-err/10 px-4 py-3 text-sm text-err">
              <span>{error}</span>
              <button
                onClick={() => setError(null)}
                aria-label="Dismiss"
                className="cursor-pointer text-err/70 transition-colors hover:text-err"
              >
                <X size={16} />
              </button>
            </div>
          )}

          <Card>
            <div className="mb-3 flex items-center gap-2">
              <Cpu size={14} className="text-text-muted" />
              <h2 className="font-heading text-sm text-text">Device</h2>
            </div>
            {info ? (
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                <Field
                  label="VID:PID"
                  value={`${info.vid.toString(16).padStart(4, "0")}:${info.pid
                    .toString(16)
                    .padStart(4, "0")}`}
                />
                <Field label="Product" value={info.product || "—"} />
                <Field label="Manufacturer" value={info.manufacturer || "—"} />
                <Field label="Serial" value={info.serial || "—"} />
              </div>
            ) : (
              <p className="text-sm text-text-muted">
                Not connected. Plug the reader in and press Connect.
              </p>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ScanLine size={14} className="text-text-muted" />
                  <h2 className="font-heading text-sm text-text">125 kHz badge</h2>
                </div>
                <Badge label="EM4100" color="#60A5FA" />
              </div>
              <p className="mb-4 text-xs leading-relaxed text-text-muted">
                Elevator / access badges. Polls command{" "}
                <span className="font-mono text-accent-muted">0x0072</span> until a badge latches.
              </p>

              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  disabled={!connected}
                  onClick={() => setLfScanning((s) => !s)}
                >
                  {lfScanning ? "Stop" : "Scan badge"}
                </Button>
                <Button variant="ghost" disabled={!connected} onClick={() => void beep()}>
                  Beep
                </Button>
              </div>

              {lfScanning && (
                <div className="mt-4 h-1 overflow-hidden rounded-full bg-surface-raised">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-200 ease-linear"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}

              {lfCard ? (
                <div className="mt-4 border-t border-border pt-4">
                  <div className="mb-3 font-mono text-2xl tracking-wider text-accent-muted">
                    {lfCard.id}
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                    <Field
                      label="data32"
                      value={`0x${lfCard.data32.toString(16).padStart(8, "0").toUpperCase()}`}
                    />
                    <Field label="Facility / card" value={`${lfCard.facility} / ${lfCard.card}`} />
                    <Field
                      label="Customer byte"
                      value={`0x${lfCard.customer.toString(16).padStart(2, "0").toUpperCase()}`}
                    />
                  </div>
                  <details className="mt-3">
                    <summary className="cursor-pointer text-[11px] uppercase tracking-wide text-text-muted hover:text-text">
                      Raw payload
                    </summary>
                    <code className="mt-2 block select-text break-all rounded-lg border border-border bg-canvas px-3 py-2 font-mono text-xs leading-relaxed text-accent-muted">
                      {lfCard.raw}
                    </code>
                  </details>
                </div>
              ) : (
                <p className="mt-4 text-xs text-text-muted">
                  {lfScanning ? "Listening for a badge…" : "No badge read yet."}
                </p>
              )}
            </Card>

            <Card>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Radio size={14} className="text-text-muted" />
                  <h2 className="font-heading text-sm text-text">13.56 MHz tag</h2>
                </div>
                <Badge label="ISO14443-A" color="#C084FC" />
              </div>
              <p className="mb-4 text-xs leading-relaxed text-text-muted">
                Single poll via <span className="font-mono text-accent-muted">0x0069</span>. Reports
                the UID when a card is present.
              </p>

              <Button
                variant="secondary"
                disabled={!connected || hfPolling}
                onClick={() => void pollHf()}
              >
                {hfPolling ? "Polling…" : "Poll once"}
              </Button>

              {hfCard ? (
                <div className="mt-4 border-t border-border pt-4">
                  <div className="mb-3 font-mono text-2xl tracking-wider text-accent-muted">
                    {hfCard.uid}
                  </div>
                  <Field label="UID" value={hfCard.uid} />
                  <details className="mt-3">
                    <summary className="cursor-pointer text-[11px] uppercase tracking-wide text-text-muted hover:text-text">
                      Raw payload
                    </summary>
                    <code className="mt-2 block select-text break-all rounded-lg border border-border bg-canvas px-3 py-2 font-mono text-xs leading-relaxed text-accent-muted">
                      {hfCard.raw}
                    </code>
                  </details>
                </div>
              ) : (
                <p className="mt-4 text-xs text-text-muted">No tag polled yet.</p>
              )}

              <p className="mt-4 rounded-lg border border-warn/25 bg-warn/5 px-3 py-2 text-[11px] leading-relaxed text-warn">
                ATQA/SAK offsets are not confirmed on real hardware yet, so only the UID is decoded.
                Use the console below to inspect the full payload.
              </p>
            </Card>
          </div>

          <Card>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Terminal size={14} className="text-text-muted" />
                <h2 className="font-heading text-sm text-text">Raw command console</h2>
              </div>
              <Badge label="hex" color="#A1A1AA" />
            </div>
            <p className="mb-4 text-xs leading-relaxed text-text-muted">
              Frame format{" "}
              <span className="font-mono text-accent-muted">55 · cmd(2) · len(2) · payload · (x^FF, x)</span>
              , zero-padded to 64 bytes. Tag writes are not implemented.
            </p>

            <div className="flex items-center gap-2">
              <Input
                className="font-mono"
                value={rawHex}
                placeholder="55 00 72 00 02 00 01 FE 01"
                onChange={setRawHex}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && connected && !rawBusy) void sendRaw();
                }}
              />
              <Button
                variant="primary"
                className="shrink-0"
                disabled={!connected || rawBusy}
                onClick={() => void sendRaw()}
              >
                {rawBusy ? "Sending…" : "Send"}
              </Button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {[
                ["Wake 0x51", "55 00 51 00 01 01 FE 01"],
                ["LF read 0x72", "55 00 72 00 02 00 01 FE 01"],
                ["HF poll 0x69", "55 00 69 00 00 FF 00"],
                ["Beep 0x55", "55 00 55 00 00 FF 00"],
                ["NTAG info 0x83", "55 00 83 00 00 FF 00"],
              ].map(([label, hex]) => (
                <button
                  key={label}
                  onClick={() => setRawHex(hex)}
                  className="cursor-pointer rounded-full border border-border px-2.5 py-1 font-mono text-[11px] text-text-muted transition-colors hover:border-border-hover hover:text-text"
                >
                  {label}
                </button>
              ))}
            </div>

            {rawError && <p className="mt-3 text-xs text-err">{rawError}</p>}
            {rawResult && (
              <div className="mt-4 border-t border-border pt-4">
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  <Field
                    label="Reply cmd"
                    value={`0x${rawResult.cmd.toString(16).padStart(4, "0").toUpperCase()}`}
                  />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[11px] uppercase tracking-wide text-text-muted">
                      Checksum
                    </span>
                    <span
                      className={`text-sm ${rawResult.checksum_ok ? "text-ok" : "text-warn"}`}
                    >
                      {rawResult.checksum_ok ? "verified" : "not verified"}
                    </span>
                  </div>
                </div>
                <code className="mt-3 block select-text break-all rounded-lg border border-border bg-canvas px-3 py-2 font-mono text-xs leading-relaxed text-accent-muted">
                  {rawResult.payload || "(empty)"}
                </code>
              </div>
            )}
          </Card>

          <footer className="px-1 pb-2 text-[11px] leading-relaxed text-text-muted">
            Protocol reverse-engineered from USB captures. Credits:{" "}
            <a
              href="https://github.com/vicrodh/cyb-nfc"
              target="_blank"
              rel="noreferrer"
              className="text-accent-muted hover:underline"
            >
              vicrodh/cyb-nfc
            </a>{" "}
            and{" "}
            <a
              href="https://github.com/journeyman846/nfcx-tool"
              target="_blank"
              rel="noreferrer"
              className="text-accent-muted hover:underline"
            >
              journeyman846/nfcx-tool
            </a>
            . Not PC/SC, not CCID.
          </footer>
        </div>
      </main>
    </div>
  );
}
