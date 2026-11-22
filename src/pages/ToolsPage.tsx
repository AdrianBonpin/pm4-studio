import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Section } from "../components/Section";
import {
  BUILD_REFUSAL_DETAIL,
  BUILD_REFUSAL_LABEL,
  READ_ONLY_BODY,
  READ_ONLY_TITLE,
  buildRefusalFrom,
  capabilityFrom,
  permittedSentence,
} from "../lib/consoleRefusal";
import { isTauri } from "../lib/platform";
import { outcomes, report } from "../lib/outcome";
import type { BuildRefusal, ConsoleCapability, RawResponse } from "../types";

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

/**
 * Tools: the raw console, and nothing else.
 *
 * The console sends whatever frame it is typed, which is how the protocol was
 * cracked and is also a route past every write guard (ADR 0006). So it asks the
 * backend which mode the binary is in and marks itself from that answer: a
 * release build sends only commands that cannot change a Tag and says so before
 * the console is used, while a development build is left alone. The console
 * never decides on its own what may be sent — the backend refuses, and this page
 * reports the refusal as a limit of the build rather than as trouble with the
 * Tag in position, which is what a guard refusal would be.
 *
 * Everything else that used to be stacked on this page has a home of its own
 * now: the indicator test and the Reader's capability limits are in
 * Settings → Diagnostics, and the preferences are in Settings → Feedback. Tools
 * keeps the one surface ADR 0006 argues must stay visible, and nothing grows back
 * on it.
 */
export function ToolsPage({ connected }: ToolsPageProps) {
  const [rawHex, setRawHex] = useState("55 00 53 00 00 FF 00");
  const [rawResult, setRawResult] = useState<RawResponse | null>(null);
  const [rawErr, setRawErr] = useState<string | null>(null);
  const [rawBusy, setRawBusy] = useState(false);
  const [refusal, setRefusal] = useState<BuildRefusal | null>(null);
  const [capability, setCapability] = useState<ConsoleCapability | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let live = true;
    // The backend is the authority on which mode it is in, so the console shows
    // a limit only when the running binary has one.
    invoke<ConsoleCapability>("console_capability")
      .then((answer) => {
        if (live) setCapability(capabilityFrom(answer));
      })
      .catch(() => {
        // The capability could not be read. Nothing is claimed here: the
        // console still cannot send what the backend refuses, so the refusal
        // path below is the fallback rather than a guess at the mode.
      });
    return () => {
      live = false;
    };
  }, []);

  const sendRaw = async () => {
    setRawBusy(true);
    setRawErr(null);
    setRawResult(null);
    setRefusal(null);
    try {
      const r = await invoke<RawResponse | null>("raw_send", { hex: rawHex });
      if (!r) setRawErr("No reply within 1.5 s. Some frames (beep, LED) never reply.");
      else setRawResult(r);
    } catch (e) {
      // Two different pieces of news: the build refused the command, or the
      // frame or the Reader failed. Only the first is shown as the build's.
      //
      // Both are reported through the seam, because both are the result of an
      // operation the user pressed: a frame this build will not send is
      // *attention* with the build's name on it, and a Reader that did not answer
      // is its own outcome with its own remedy. A reply that arrived is the
      // readout below and nothing else — the reply is evidence, not a verdict,
      // and inventing a success kind for it would say more than a raw frame can.
      const refused = buildRefusalFrom(e);
      if (refused) {
        setRefusal(refused);
        report(outcomes.refusedByBuild(refused));
      } else {
        setRawErr(String(e));
        report(outcomes.readerFailure(e));
      }
    } finally {
      setRawBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <Section
        title="Raw console"
        hint="Frame: 55 · cmd(2) · len(2) · payload · checksum. Zero-padded to 64 bytes."
      >
        {/* Said before the console is used, not after a frame is refused. */}
        {capability?.readOnly && (
          <div className="mb-3 rounded-lg border border-warn/50 bg-warn/10 px-3 py-2">
            <p className="text-xs font-medium text-warn">{READ_ONLY_TITLE}</p>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">{READ_ONLY_BODY}</p>
            <p className="mt-1 font-mono text-[11px] leading-relaxed text-text-muted">
              {permittedSentence(capability.commands)}
            </p>
          </div>
        )}

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

        {/* Presets are actions, not choices: each one types its frame into the
            box above and sends nothing. They are ghost buttons because that is
            what they are — an operation with no primary weight to it — and
            because the row no longer resembles the switch that chooses a mode. */}
        <div className="mt-3 flex flex-wrap gap-2">
          {PRESETS.map(([label, hex]) => (
            <Button
              key={label}
              variant="ghost"
              className="whitespace-nowrap font-mono text-[11px]"
              onClick={() => setRawHex(hex)}
            >
              {label}
            </Button>
          ))}
        </div>

        {/* A frame this build will not send: about the build, not the Tag. */}
        {refusal && (
          <div className="mt-3 rounded-lg border border-warn/50 bg-warn/10 px-3 py-2">
            <p className="text-xs font-medium text-warn">{BUILD_REFUSAL_LABEL}</p>
            <p className="mt-1 text-xs leading-relaxed text-text">{refusal.message}</p>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">{BUILD_REFUSAL_DETAIL}</p>
          </div>
        )}

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
