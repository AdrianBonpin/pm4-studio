import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DeviceInfo, HfCard, LfCard, RawResponse } from "./types";

type Status = "idle" | "connecting" | "connected" | "error";

const SCAN_TIMEOUT_MS = 30_000;
const SCAN_INTERVAL_MS = 350;

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

  // ---- 125 kHz scan loop ------------------------------------------------
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
    <div className="app">
      <div className="drag" data-tauri-drag-region />

      <header className="head">
        <div className="brand">
          <div className="logo" aria-hidden />
          <div>
            <h1>PM4 Studio</h1>
            <p>NFC-PM4 · CYBDZKJ-BSJ reader studio</p>
          </div>
        </div>
        <div className="head-right">
          <span className={`pill ${status}`}>{status}</span>
          <button className="btn ghost" onClick={() => void connect()}>
            {connected ? "Reconnect" : "Connect"}
          </button>
        </div>
      </header>

      {error && (
        <div className="banner">
          <span>{error}</span>
          <button className="x" onClick={() => setError(null)} aria-label="dismiss">
            ×
          </button>
        </div>
      )}

      <section className="card device">
        <h2>Device</h2>
        {info ? (
          <dl className="kv">
            <div>
              <dt>VID:PID</dt>
              <dd className="mono">
                {info.vid.toString(16).padStart(4, "0")}:
                {info.pid.toString(16).padStart(4, "0")}
              </dd>
            </div>
            <div>
              <dt>Product</dt>
              <dd className="mono">{info.product || "—"}</dd>
            </div>
            <div>
              <dt>Manufacturer</dt>
              <dd className="mono">{info.manufacturer || "—"}</dd>
            </div>
            <div>
              <dt>Serial</dt>
              <dd className="mono">{info.serial || "—"}</dd>
            </div>
          </dl>
        ) : (
          <p className="muted">Not connected. Plug the reader in and press Connect.</p>
        )}
      </section>

      <div className="grid">
        <section className="card">
          <div className="card-head">
            <h2>125 kHz badge</h2>
            <span className="tag">EM4100</span>
          </div>
          <p className="muted small">
            Elevator / access badges. Polls command <code>0x0072</code> until a
            badge latches.
          </p>

          <div className="row">
            <button
              className="btn primary"
              disabled={!connected || lfScanning}
              onClick={() => setLfScanning((s) => !s)}
            >
              {lfScanning ? "Stop" : "Scan badge"}
            </button>
            <button className="btn ghost" disabled={!connected} onClick={() => void beep()}>
              Beep
            </button>
          </div>

          {lfScanning && (
            <div className="progress">
              <div className="bar" style={{ width: `${progress}%` }} />
            </div>
          )}

          {lfCard ? (
            <div className="result">
              <div className="big mono">{lfCard.id}</div>
              <dl className="kv tight">
                <div>
                  <dt>EM4100 ID</dt>
                  <dd className="mono">{lfCard.id}</dd>
                </div>
                <div>
                  <dt>data32</dt>
                  <dd className="mono">
                    0x{lfCard.data32.toString(16).padStart(8, "0").toUpperCase()}
                  </dd>
                </div>
                <div>
                  <dt>Facility / card</dt>
                  <dd className="mono">
                    {lfCard.facility} / {lfCard.card}
                  </dd>
                </div>
                <div>
                  <dt>Customer byte</dt>
                  <dd className="mono">
                    0x{lfCard.customer.toString(16).padStart(2, "0").toUpperCase()}
                  </dd>
                </div>
              </dl>
              <details>
                <summary>Raw payload</summary>
                <code className="raw">{lfCard.raw}</code>
              </details>
            </div>
          ) : (
            <p className="muted small">
              {lfScanning ? "Listening for a badge…" : "No badge read yet."}
            </p>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>13.56 MHz tag</h2>
            <span className="tag hf">ISO14443-A</span>
          </div>
          <p className="muted small">
            Single poll via <code>0x0069</code>. Reports the UID when a card is
            present.
          </p>

          <div className="row">
            <button className="btn" disabled={!connected || hfPolling} onClick={() => void pollHf()}>
              {hfPolling ? "Polling…" : "Poll once"}
            </button>
          </div>

          {hfCard ? (
            <div className="result">
              <div className="big mono">{hfCard.uid}</div>
              <dl className="kv tight">
                <div>
                  <dt>UID</dt>
                  <dd className="mono">{hfCard.uid}</dd>
                </div>
              </dl>
              <details>
                <summary>Raw payload</summary>
                <code className="raw">{hfCard.raw}</code>
              </details>
            </div>
          ) : (
            <p className="muted small">No tag polled yet.</p>
          )}
          <p className="note">
            ATQA/SAK offsets are not confirmed on real hardware yet, so only the
            UID is decoded. Use the console below to inspect the full payload.
          </p>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Raw command console</h2>
          <span className="tag">hex</span>
        </div>
        <p className="muted small">
          Frame format <code>55 · cmd(2) · len(2) · payload · (x^FF, x)</code>,
          zero-padded to 64 bytes. Absolute writes are not implemented.
        </p>
        <div className="row">
          <input
            className="input mono"
            value={rawHex}
            spellCheck={false}
            onChange={(e) => setRawHex(e.target.value)}
            placeholder="55 00 72 00 02 00 01 FE 01"
          />
          <button className="btn primary" disabled={!connected || rawBusy} onClick={() => void sendRaw()}>
            {rawBusy ? "Sending…" : "Send"}
          </button>
        </div>
        <div className="row wrap">
          {[
            ["Wake 0x51", "55 00 51 00 01 01 FE 01"],
            ["LF read 0x72", "55 00 72 00 02 00 01 FE 01"],
            ["HF poll 0x69", "55 00 69 00 00 FF 00"],
            ["Beep 0x55", "55 00 55 00 00 FF 00"],
            ["NTAG info 0x83", "55 00 83 00 00 FF 00"],
          ].map(([label, hex]) => (
            <button key={label} className="chip" onClick={() => setRawHex(hex)}>
              {label}
            </button>
          ))}
        </div>

        {rawError && <p className="err small">{rawError}</p>}
        {rawResult && (
          <div className="result">
            <dl className="kv tight">
              <div>
                <dt>Reply cmd</dt>
                <dd className="mono">
                  0x{rawResult.cmd.toString(16).padStart(4, "0").toUpperCase()}
                </dd>
              </div>
              <div>
                <dt>Checksum</dt>
                <dd className={rawResult.checksum_ok ? "ok" : "warn"}>
                  {rawResult.checksum_ok ? "verified" : "not verified"}
                </dd>
              </div>
            </dl>
            <details open>
              <summary>Payload</summary>
              <code className="raw">{rawResult.payload || "(empty)"}</code>
            </details>
          </div>
        )}
      </section>

      <footer className="foot">
        <span>
          Protocol reverse-engineered from USB captures. Credits:{" "}
          <a href="https://github.com/vicrodh/cyb-nfc" target="_blank" rel="noreferrer">
            vicrodh/cyb-nfc
          </a>{" "}
          and{" "}
          <a href="https://github.com/journeyman846/nfcx-tool" target="_blank" rel="noreferrer">
            journeyman846/nfcx-tool
          </a>
          . Not PC/SC, not CCID.
        </span>
      </footer>
    </div>
  );
}
