import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "./ui/Button";
import { Section } from "./Section";
import { beginDeviceOperation } from "../lib/deviceLock";
import { recordLine } from "../lib/tagRecords";
import {
  LOAD_MAKES_A_DRAFT_NOTE,
  LOAD_READ_ONLY_NOTE,
  draftNameForTag,
  loadTagRecords,
  rawRowCells,
  rawRows,
  type TagLoad,
  type TagRecordsRead,
} from "../lib/tagRecords";
import type { Draft, DraftRecord } from "../lib/drafts";

interface LoadTagIntoDraftProps {
  connected: boolean;
  /** True when the library file cannot be written to, so no Draft may be made. */
  locked: boolean;
  createWith: (name: string, records: DraftRecord[]) => Promise<Draft | null>;
  onLoaded: (draftId: string) => void;
}

/**
 * Read the 13.56 MHz Tag on the Reader into a new Draft.
 *
 * This is the read half of the read-edit-rewrite loop: a Tag that already holds
 * Records yields a Draft holding the same Records in the same order, which the
 * Draft editor below opens so it can be edited and written back whole. There is
 * no in-place append anywhere in this app, so this is the only way existing
 * content changes.
 *
 * Two rules shape the whole component:
 *
 *   - Nothing here writes to a Tag. The read sends the info and memory-read
 *     commands only, so a Tag is never changed by being loaded.
 *   - A message this build cannot decode produces **no Draft at all**. A Draft
 *     holding the Records that happened to decode would look complete and would
 *     delete the rest when written back, so a failure shows the Tag's raw bytes
 *     instead. That is the failure mode this component exists to avoid.
 */
export function LoadTagIntoDraft({
  connected,
  locked,
  createWith,
  onLoaded,
}: LoadTagIntoDraftProps) {
  const [busy, setBusy] = useState(false);
  const [read, setRead] = useState<TagRecordsRead | null>(null);
  const [load, setLoad] = useState<TagLoad | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedName, setLoadedName] = useState<string | null>(null);

  const readTag = async () => {
    setBusy(true);
    setError(null);
    setLoadedName(null);
    // The previous tag's bytes must not sit under this tag's heading.
    setRead(null);
    setLoad(null);
    // Hold the Reader for the read so no poll reply can be mistaken for its
    // frames; the read itself is two commands and changes nothing.
    const release = beginDeviceOperation();
    try {
      const result = await invoke<TagRecordsRead>("ntag_records_read", {
        capturedAt: new Date().toISOString(),
      });
      const outcome = loadTagRecords(result);
      setRead(result);
      if (outcome.kind === "records") {
        const draft = await createWith(draftNameForTag(result.dump), outcome.records);
        if (draft === null) {
          setError(
            "The tag was read, but the Draft could not be saved to the library, so nothing was " +
              "loaded."
          );
          return;
        }
        setLoad(outcome);
        setLoadedName(draft.name.trim().length > 0 ? draft.name : draft.id);
        onLoaded(draft.id);
      } else {
        setLoad(outcome);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      release();
      setBusy(false);
    }
  };

  const canRead = connected && !busy && !locked;
  const rows = load?.raw && read ? rawRows(read.dump) : [];

  return (
    <Section
      title="From a tag"
      hint="Read a tag's Records into a new Draft, edit them, then write the whole message back. 13.56 MHz only."
      actions={
        <Button
          variant="secondary"
          disabled={!canRead}
          onClick={() => void readTag()}
        >
          {busy ? "Reading tag…" : "Read tag into a Draft"}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {!connected && (
          <p className="max-w-prose text-xs leading-relaxed text-text-muted">
            Connect the Reader to read a tag. A Draft needs no Reader once it is loaded, which
            is why it can be edited with the tag back in a pocket.
          </p>
        )}

        {locked && connected && (
          <p className="max-w-prose text-xs leading-relaxed text-text-muted">
            The library file cannot be written to, so a loaded Draft could not be saved and
            nothing is read.
          </p>
        )}

        {error && (
          <div className="border-l-2 border-err bg-err/5 px-3 py-2">
            <p className="text-sm text-err">Tag not loaded</p>
            <p className="mt-0.5 max-w-prose text-xs leading-relaxed text-text-muted">{error}</p>
          </div>
        )}

        {load && load.kind === "records" && (
          <div className="border-l-2 border-ok bg-ok/5 px-3 py-2">
            <p className="text-sm text-ok">Loaded into a Draft</p>
            <p className="mt-0.5 max-w-prose text-xs leading-relaxed text-text-muted">
              {load.detail}
              {loadedName ? ` The Draft is named ${loadedName} and is open below.` : ""}
            </p>
            <ol className="mt-2 flex flex-col gap-0.5">
              {load.records.map((record, at) => (
                <li key={at} className="font-mono text-[11px] leading-relaxed text-accent-muted">
                  {at + 1}. {recordLine(record)}
                </li>
              ))}
            </ol>
            <p className="mt-2 max-w-prose text-[11px] leading-relaxed text-text-muted">
              The Records are in the tag's order. Edit them below, then write the whole message
              back: writing replaces what the tag holds rather than appending to it.
            </p>
          </div>
        )}

        {load && load.kind !== "records" && (
          <div
            className={`border-l-2 px-3 py-2 ${
              load.kind === "emptyMessage" || load.kind === "noNdefTlv"
                ? "border-border bg-surface/40"
                : "border-warn bg-warn/5"
            }`}
          >
            <p
              className={`text-sm ${
                load.kind === "emptyMessage" || load.kind === "noNdefTlv"
                  ? "text-text"
                  : "text-warn"
              }`}
            >
              {outcomeTitle(load)}
            </p>
            <p className="mt-0.5 max-w-prose text-xs leading-relaxed text-text-muted">
              {load.detail}
            </p>
            {load.kind !== "emptyMessage" && load.kind !== "noNdefTlv" && (
              <p className="mt-1 max-w-prose text-xs leading-relaxed text-text-muted">
                No Draft was made: a Draft built from part of this tag would look complete and
                would replace the rest of it when written back.
              </p>
            )}
          </div>
        )}

        {load?.raw && read && (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] uppercase tracking-[0.12em] text-text-muted">
              The tag as read
            </p>
            {rows.length === 0 ? (
              <p className="max-w-prose text-xs leading-relaxed text-text-muted">
                The Reader reported no readable page for this tag, so there are no bytes to
                show.
              </p>
            ) : (
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
                    {rows.map((row) => {
                      const cells = rawRowCells(row);
                      return (
                        <tr key={row.firstPage} className="border-t border-border/60">
                          <td className="whitespace-nowrap px-3 py-1 text-text-muted">
                            {cells.pages}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1 text-text-muted">
                            {cells.offset}
                          </td>
                          <td className="whitespace-pre px-2 py-1 text-accent-muted">
                            {cells.hex}
                          </td>
                          <td className="whitespace-pre px-2 py-1 text-text">{cells.ascii}</td>
                          <td
                            className={`whitespace-nowrap px-3 py-1 ${
                              row.readable ? "text-text-muted" : "text-warn"
                            }`}
                          >
                            {cells.state}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="max-w-prose text-[11px] leading-relaxed text-text-muted">
              These are the tag's bytes, not a decode. The whole 256-page read, states
              included, is in the memory dump on the 13.56 MHz page.
            </p>
          </div>
        )}

        {!load && !error && connected && (
          <p className="max-w-prose text-xs leading-relaxed text-text-muted">
            Put a 13.56 MHz tag on the Reader and read it. A tag that already holds Records
            loads them into a Draft, in order, ready to edit.
          </p>
        )}

        <div className="flex flex-col gap-1 border-t border-border pt-3">
          <p className="max-w-prose text-[11px] leading-relaxed text-text-muted">
            {LOAD_READ_ONLY_NOTE}
          </p>
          <p className="max-w-prose text-[11px] leading-relaxed text-text-muted">
            {LOAD_MAKES_A_DRAFT_NOTE}
          </p>
        </div>
      </div>
    </Section>
  );
}

/** The heading for an outcome that produced no Draft, said in its own terms. */
function outcomeTitle(load: TagLoad): string {
  switch (load.kind) {
    case "emptyMessage":
      return "The tag holds an empty message";
    case "noNdefTlv":
      return "The tag holds no NDEF message";
    case "zeroRecords":
      return "The tag's message holds no Records";
    case "notFormatted":
      return "The tag is not NDEF formatted";
    case "unreadable":
      return "The tag's message could not be read";
    case "undecodable":
      return "The tag's Records could not be decoded";
    default:
      return "Nothing to load";
  }
}
