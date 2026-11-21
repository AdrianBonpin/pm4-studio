import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Section } from "../components/Section";
import type { RawResponse } from "../types";

interface ToolsPageProps {
  connected: boolean;
}

const PRESETS: [string, string][] = [
  ["Wake 0x51", "55 00 51 00 01 01 FE 01"],
  ["LF read 0x72", "55 00 72 00 02 00 01 FE 01"],
  ["HF poll 0x69", "55 00 69 00 00 FF 00"],
  ["Beep 0x53", "55 00 53 00 00 FF 00"],
  ["LED off 0x55", "55 00 55 00 00 FF 00"],
  ["Version 0x54", "55 00 54 00 00 FF 00"],
  ["NTAG info 0x83", "55 00 83 00 00 FF 00"],
];

export function ToolsPage({ connected }: ToolsPageProps) {
  const [rawHex, setRawHex] = useState("55 00 53 00 00 FF 00");
  const [rawResult, setRawResult] = useState<RawResponse | null>(null);
  const [rawErr, setRawErr] = useState<string | null>(null);
  const [rawBusy, setRawBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const run = async (cmd: string) => {
    if (cmd === "beep") {
      try {
        await invoke("beep");
        setNote("Beep sent. 0x0053 chirps once and drives the LED off → on.");
      } catch (e) {
        setNote(String(e));
      }
      return;
    }
    try {
      await invoke("led_off");
      setNote("LED off sent. 0x0055 is the LED-off frame, not a beep.");
    } catch (e) {
      setNote(String(e));
    }
  };

  const sendRaw = async () => {
    setRawBusy(true);
    setRawErr(null);
    setRawResult(null);
    try {
      const r = await invoke<RawResponse | null>("raw_send", { hex: rawHex });
      if (!r) setRawErr("No reply within 1.5 s. Some frames (beep, LED) never reply.");
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
        title="Indicator"
        hint="Confirmed on this hardware. Both frames are fire-and-forget: they act, then send nothing back."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={!connected} onClick={() => void run("beep")}>
            Beep <span className="font-mono text-[11px] opacity-70">0x53</span>
          </Button>
          <Button variant="secondary" disabled={!connected} onClick={() => void run("led_off")}>
            LED off <span className="font-mono text-[11px] opacity-70">0x55</span>
          </Button>
        </div>
        {note && <p className="mt-3 text-xs leading-relaxed text-text-muted">{note}</p>}
        <dl className="mt-4 flex flex-col gap-2 text-xs">
          <div className="flex gap-3">
            <dt className="w-16 shrink-0 font-mono text-text-muted">0x0053</dt>
            <dd className="text-text">Beep, and the LED goes off → on.</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-16 shrink-0 font-mono text-text-muted">0x0055</dt>
            <dd className="text-text">LED off.</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs leading-relaxed text-text-muted">
          No LED-on-only command has been identified — 0x0053 is the only thing seen to
          light it, and it always chirps first.
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
          {PRESETS.map(([label, hex]) => (
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
