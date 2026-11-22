import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "./ui/Button";
import { Notice } from "./ui/Notice";
import { Field, Section } from "./Section";
import {
  describeDump,
  exportedDumpNote,
  formatOffset,
  pageRange,
  type MemoryDump,
} from "../lib/memoryDump";
import type { TagRecordsRead } from "../lib/tagRecords";

interface MemoryDumpPanelProps {
  connected: boolean;
  /**
   * The last completed read on this page, or null. Owned by the page rather than
   * by this panel because the Read mode uses what the read settled about NDEF
   * formatting — one read, one set of facts, two views, and the Memory mode
   * shows the bytes of the reading Read took.
   */
  read: TagRecordsRead | null;
  /**
   * A completed read, or `null` when a read failed. `null` deliberately throws
   * the previous read away: a stale dump under this tag's heading, and a stale
   * NDEF status on the Read mode's reading, would both be claims about a tag
   * nobody just read.
   */
  onRead: (read: TagRecordsRead | null) => void;
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
 *
 * The command it sends is `ntag_records_read`, which returns the same dump plus
 * what the Tag's Type 2 structure turned out to be. One exchange therefore
 * answers two questions — "what are these bytes" and "is this Tag NDEF
 * formatted" — and the Read mode can show the second without a second read.
 */
export function MemoryDumpPanel({ connected, read, onRead }: MemoryDumpPanelProps) {
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const dump: MemoryDump | null = read?.dump ?? null;

  const readMemory = async () => {
    setBusy(true);
    setError(null);
    setSavedTo(null);
    try {
      onRead(
        await invoke<TagRecordsRead>("ntag_records_read", {
          capturedAt: new Date().toISOString(),
        }),
      );
    } catch (e) {
      // No dump is better than the last tag's dump under this tag's heading.
      onRead(null);
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
            onClick={() => void readMemory()}
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
        <Notice tone="err" label="Memory not read">
          <p className="max-w-prose text-xs leading-relaxed text-text-muted">{error}</p>
        </Notice>
      )}

      {dump === null ? (
        error === null && (
          <p className="max-w-prose text-sm leading-relaxed text-text-muted">
            {connected
              ? "No memory read yet. Put a 13.56 MHz tag on the Reader and read its memory: the offsets and bytes are the record for a tag this build cannot decode."
              : "Connect the Reader to read a tag's memory."}
          </p>
        )
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <Field label="Tag type" value={String(dump.tag.tagType)} />
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
