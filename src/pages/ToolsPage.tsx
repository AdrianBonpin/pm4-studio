import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Section } from "../components/Section";
import type { RawResponse } from "../types";

interface ToolsPageProps {
  connected: boolean;
}

type Probe = { label: string; cmd: number; payload: string };

/** Candidates worth trying while watching the reader. Nothing here writes a tag. */
const BEEP_PROBES: Probe[] = [
  { label: "Beep (0x0055)", cmd: 0x0055, payload: "" },
  { label: "0x0053", cmd: 0x0053, payload: "" },
  { label: "0x0056", cmd: 0x0056, payload: "" },
  { label: "0x0057", cmd: 0x0057, payload: "" },
];

const LED_PROBES: Probe[] = [
  { label: "0x0040 [01]", cmd: 0x0040, payload: "01" },
  { label: "0x0040 [02]", cmd: 0x0040, payload: "02" },
  { label: "0x0040 [00]", cmd: 0x0040, payload: "00" },
  { label: "0x0056 [01]", cmd: 0x0056, payload: "01" },
  { label: "0x0056 [00]", cmd: 0x0056, payload: "00" },
  { label: "0x0057 [01]", cmd: 0x0057, payload: "01" },
  { label: "0x0057 [00]", cmd: 0x0057, payload: "00" },
  { label: "0x0058 [010000]", cmd: 0x0058, payload: "010000" },
  { label: "0x0059 [01]", cmd: 0x0059, payload: "01" },
];

function ProbeRow({
  probe,
  connected,
  onResult,
  reply,
}: {
  probe: Probe;
  connected: boolean;
  onResult: (label: string, r: RawResponse | null, err?: string) => void;
  reply?: { text: string; ok: boolean };
}) {
  const [busy, setBusy] = useState(false);
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span className="font-mono text-xs text-text">{probe.label}</span>
      <span className="flex items-center gap-3">
        {reply && (
          <span className={`font-mono text-[11px] ${reply.ok ? "text-accent-muted" : "text-text-muted"}`}>
            {reply.text}
          </span>
        )}
        <Button
          variant="secondary"
          disabled={!connected || busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await invoke<RawResponse | null>("send_cmd", {
                cmd: probe.cmd,
                payload: probe.payload,
              });
              onResult(probe.label, r);
            } catch (e) {
              onResult(probe.label, null, String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Send
        </Button>
      </span>
    </li>
  );
}

export function ToolsPage({ connected }: ToolsPageProps) {
  const [replies, setReplies] = useState<Record<string, { text: string; ok: boolean }>>({});
  const [rawHex, setRawHex] = useState("55 00 51 00 01 01 FE 01");
  const [rawResult, setRawResult] = useState<RawResponse | null>(null);
  const [rawErr, setRawErr] = useState<string | null>(null);
  const [rawBusy, setRawBusy] = useState(false);

  const record = (label: string, r: RawResponse | null, err?: string) => {
    setReplies((prev) => ({
      ...prev,
      [label]: err
        ? { text: "error", ok: false }
        : r
          ? { text: r.payload || "(no reply)", ok: true }
          : { text: "(no reply)", ok: false },
    }));
  };

  const sendRaw = async () => {
    setRawBusy(true);
    setRawErr(null);
    setRawResult(null);
    try {
      const r = await invoke<RawResponse | null>("raw_send", { hex: rawHex });
      if (!r) setRawErr("No reply within 1.5 s.");
      else setRawResult(r);
    } catch (e) {
      setRawErr(String(e));
    } finally {
      setRawBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <Section
        title="Find the buzzer"
        hint="Press each and watch the reader. 0x0055 is the confirmed beep."
      >
        <ul className="flex flex-col divide-y divide-border">
          {BEEP_PROBES.map((p) => (
            <ProbeRow
              key={p.label}
              probe={p}
              connected={connected}
              onResult={record}
              reply={replies[p.label]}
            />
          ))}
        </ul>
      </Section>

      <Section
        title="Find LED control"
        hint="Press each and watch the red LED. Nothing here writes a tag."
      >
        <ul className="flex flex-col divide-y divide-border">
          {LED_PROBES.map((p) => (
            <ProbeRow
              key={p.label}
              probe={p}
              connected={connected}
              onResult={record}
              reply={replies[p.label]}
            />
          ))}
        </ul>
        <p className="mt-3 text-xs leading-relaxed text-text-muted">
          Replies here mean the firmware knows the command; the real test is whether the LED
          changes. Tell me which label did something and I will wire it up properly.
        </p>
      </Section>

      <Section
        title="Raw console"
        hint="Frame: 55 · cmd(2) · len(2) · payload · checksum. Zero-padded to 64 bytes."
      >
        <div className="flex items-center gap-2">
          <Input
            className="font-mono"
            value={rawHex}
            placeholder="55 00 51 00 01 01 FE 01"
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
            ["Version 0x54", "55 00 54 00 00 FF 00"],
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

        {rawErr && <p className="mt-3 text-xs text-err">{rawErr}</p>}
        {rawResult && (
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex flex-wrap gap-x-8 gap-y-2 text-xs">
              <span className="text-text-muted">
                cmd{" "}
                <span className="font-mono text-text">
                  0x{rawResult.cmd.toString(16).padStart(4, "0").toUpperCase()}
                </span>
              </span>
              <span className={rawResult.checksum_ok ? "text-ok" : "text-warn"}>
                checksum {rawResult.checksum_ok ? "verified" : "not verified"}
              </span>
            </div>
            <code className="block select-text break-all rounded-lg border border-border bg-canvas px-3 py-2 font-mono text-xs leading-relaxed text-accent-muted">
              {rawResult.payload || "(empty)"}
            </code>
          </div>
        )}
      </Section>
    </div>
  );
}
