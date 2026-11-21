import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "./ui/Button";
import { Field, Section } from "./Section";
import {
  describeDump,
  exportedDumpNote,
  formatOffset,
  pageRange,
  type MemoryDump,
} from "../lib/memoryDump";

interface MemoryDumpPanelProps {
  connected: boolean;
}

/**
 * Read a tag's memory and export it.
 *
 * This is the diagnostic floor: for a tag the decoder does not recognise, the
 * bytes and their offsets are the reading. Nothing in the table is interpreted,
 * which is why it is safe to show for any tag — and why the tag's UID and read
 * time head it, so two exports can be told apart.
 *
 * Read-only: the Reader is asked for info and memory only. A tag that does not
 * answer leaves an error in place of a dump and the buttons usable again.
 */
export function MemoryDumpPanel({ connected }: MemoryDumpPanelProps) {
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [dump, setDump] = useState<MemoryDump | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedTo, setSavedTo] = useState<string | null>(null);

  const read = async () => {
    setBusy(true);
    setError(null);
    setSavedTo(null);
    try {
      const readDump = await invoke<MemoryDump>("ntag_memory_read", {
        capturedAt: new Date().toISOString(),
      });
      setDump(readDump);
    } catch (e) {
      // No dump is better than the last tag's dump under this tag's heading.
      setDump(null);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const exportDump = async () => {
    if (dump === null) return;
    setExporting(true);
    setError(null);
    setSavedTo(null);
    try {
      const path = await invoke<string | null>("memory_dump_export", { dump });
      if (path !== null) setSavedTo(path);
    } catch (e) {
      setError(String(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Section
      title="Memory dump"
      hint="Read-only. Offsets, hex and an ASCII view, straight off the tag."
      actions={
        <>
          <Button
            variant="secondary"
            disabled={!connected || busy}
            onClick={() => void read()}
          >
            {busy ? "Reading…" : "Read memory"}
          </Button>
          <Button
            variant="ghost"
            disabled={dump === null || exporting}
            onClick={() => void exportDump()}
          >
            {exporting ? "Exporting…" : "Export…"}
          </Button>
        </>
      }
    >
      {error !== null && (
        <div className="border-l-2 border-err bg-err/5 px-3 py-2">
          <p className="text-sm text-err">Memory not read</p>
          <p className="mt-0.5 max-w-prose text-xs leading-relaxed text-text-muted">{error}</p>
        </div>
      )}

      {dump === null ? (
        error === null && (
          <p className="max-w-prose text-sm leading-relaxed text-text-muted">
            {connected
              ? "No memory read yet. Put a 13.56 MHz tag on the Reader and read it: this is the record for a tag the decoder above does not recognise."
              : "Connect the Reader to read a tag's memory."}
          </p>
        )
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <Field label="Tag" value={dump.tag.tagLabel} />
            <Field label="UID" value={dump.tag.uid} />
            <Field label="Read at" value={dump.tag.capturedAt} />
            <Field label="Pages" value={describeDump(dump)} />
          </div>

          <div className="overflow-x-auto rounded-lg border border-border bg-canvas">
            <table className="min-w-full font-mono text-[11px] leading-relaxed">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.12em] text-text-muted">
                  <th className="px-3 py-2 text-left font-normal">page</th>
                  <th className="px-2 py-2 text-left font-normal">offset</th>
                  <th className="px-2 py-2 text-left font-normal">hex</th>
                  <th className="px-2 py-2 text-left font-normal">ascii</th>
                  <th className="px-3 py-2 text-left font-normal">state</th>
                </tr>
              </thead>
              <tbody>
                {dump.rows.map((row) => (
                  <tr key={row.firstPage} className="border-t border-border/60">
                    <td className="whitespace-nowrap px-3 py-1 text-text-muted">
                      {pageRange(row)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 text-text-muted">
                      {formatOffset(row.offset)}
                    </td>
                    <td className="whitespace-pre px-2 py-1 text-accent-muted">{row.hex}</td>
                    <td className="whitespace-pre px-2 py-1 text-text">{row.ascii}</td>
                    <td
                      className={`whitespace-nowrap px-3 py-1 ${
                        row.readable ? "text-text-muted" : "text-warn"
                      }`}
                    >
                      {row.stateLabel}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="max-w-prose text-xs leading-relaxed text-text-muted">
            A dump is evidence, not a decode: nothing in it is interpreted. Page state 1 means
            the Reader read the page, and state 3 means the page is outside the tag's memory.
            The ASCII view shows printable bytes and a dot for everything else.
          </p>

          {savedTo !== null && (
            <p className="break-all text-xs text-ok">{exportedDumpNote(savedTo)}</p>
          )}
        </div>
      )}
    </Section>
  );
}
