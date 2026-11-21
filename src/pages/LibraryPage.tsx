import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Check, Copy, Pencil, Trash2 } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Section } from "../components/Section";
import { describeDeviceFailure } from "../lib/readerIdentity";
import {
  EMPTY_LIBRARY_DETAIL,
  EMPTY_LIBRARY_TITLE,
  LIBRARY_PLAINTEXT_NOTICE,
  draftIsDirty,
  draftOf,
  filterSnapshots,
  snapshotDetail,
  snapshotTitle,
  sortSnapshots,
} from "../lib/library";
import type { LibraryState } from "../hooks/useLibrary";
import type { Snapshot, SnapshotDraft, SnapshotOrder } from "../lib/library";
import type { WriteResult } from "../types";

interface LibraryPageProps {
  connected: boolean;
  library: LibraryState;
  onChirp: () => void;
}

/**
 * The library, with no Reader required. Snapshots are read from a file in the
 * app data directory, so they are here whether or not the Reader is plugged in;
 * writing one back to a Tag is the only part that needs hardware.
 */
export function LibraryPage({ connected, library, onChirp }: LibraryPageProps) {
  const { view, error, loading, edit, remove } = library;

  // Which Snapshot is open for editing, and what the user has typed so far. The
  // draft is a copy: the stored Snapshot is only touched when they confirm it.
  const [editing, setEditing] = useState<{ id: string; draft: SnapshotDraft } | null>(null);
  // Deleting is permanent, so it takes a second, deliberate click.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<SnapshotOrder>("name");
  const [target, setTarget] = useState<Snapshot | null>(null);
  const [writeBusy, setWriteBusy] = useState(false);
  const [writeResult, setWriteResult] = useState<WriteResult | null>(null);
  const [writeErr, setWriteErr] = useState<string | null>(null);

  const all = view?.snapshots ?? [];
  // One pass over the Snapshots already in the view per keystroke, reusing their
  // objects. Nothing is reloaded or rebuilt here, so several hundred entries
  // stay responsive; the file is only read again when the library changes.
  const snapshots = useMemo(
    () => sortSnapshots(filterSnapshots(all, query), order),
    [all, query, order],
  );
  const problem = view?.problem ?? null;
  const searching = query.trim().length > 0;

  const commitEdit = (snapshot: Snapshot) => {
    if (!editing) return;
    const { draft } = editing;
    setEditing(null);
    // Cancelling, or confirming without having typed anything, writes nothing.
    if (!draftIsDirty(snapshot, draft)) return;
    void edit(snapshot.id, draft);
  };

  const deleteSnapshot = (snapshot: Snapshot) => {
    setConfirmingId(null);
    if (target?.id === snapshot.id) setTarget(null);
    void remove(snapshot.id);
  };

  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1200);
    } catch {
      // Clipboard can be unavailable; the id is visible anyway.
    }
  };

  const writeSaved = async () => {
    if (!target?.identity) return;
    setWriteBusy(true);
    setWriteErr(null);
    setWriteResult(null);
    try {
      const res = await invoke<WriteResult>("lf_write", {
        customer: target.identity.customer,
        data32: target.identity.data32,
      });
      setWriteResult(res);
      if (res.verified) onChirp();
      else setWriteErr("Write sent, but the tag did not read back the expected id.");
    } catch (e) {
      setWriteErr(describeDeviceFailure(e));
    } finally {
      setWriteBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <Section
        title="Snapshots"
        hint={
          all.length === 0
            ? "Every read you keep, whether or not the Reader is attached."
            : `${all.length} ${all.length === 1 ? "Snapshot" : "Snapshots"} — click a name to rename it or add a note.`
        }
      >
        {problem && (
          <div className="mb-4 flex items-start gap-3 border-l-2 border-err bg-err/5 px-3 py-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-err" />
            <div className="min-w-0">
              <p className="text-sm text-err">
                {problem.kind === "newerVersion"
                  ? "This library was written by a newer version of PM4 Studio"
                  : problem.kind === "olderVersion"
                    ? "This library is from an older version of PM4 Studio"
                    : "The library file could not be read"}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
                {problem.message} Saving is turned off until it is dealt with, so the file on
                disk is never replaced by an empty one.
              </p>
              {problem.detail && (
                <p className="mt-1 select-text break-all font-mono text-[11px] text-text-muted">
                  {problem.detail}
                </p>
              )}
            </div>
          </div>
        )}

        {error && (
          <p className="mb-4 border-l-2 border-err bg-err/5 px-3 py-2 text-xs leading-relaxed text-err">
            {error}
          </p>
        )}

        {loading && <p className="text-sm text-text-muted">Reading the library…</p>}

        {!loading && !view && !error && (
          <p className="text-sm text-text-muted">The library could not be read.</p>
        )}

        {!loading && view && !problem && all.length === 0 && (
          <div className="flex flex-col items-start gap-2 border border-dashed border-border px-4 py-6">
            <p className="font-heading text-sm text-text">{EMPTY_LIBRARY_TITLE}</p>
            <p className="max-w-prose text-sm leading-relaxed text-text-muted">
              {EMPTY_LIBRARY_DETAIL}
            </p>
          </div>
        )}

        {all.length > 1 && (
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              value={query}
              onChange={setQuery}
              placeholder="Search name, Identity or UID"
              aria-label="Search Snapshots"
              className="sm:max-w-72"
            />
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-[0.12em] text-text-muted">
                Sort
              </span>
              <Button
                variant={order === "name" ? "primary" : "secondary"}
                onClick={() => setOrder("name")}
              >
                Name
              </Button>
              <Button
                variant={order === "captured" ? "primary" : "secondary"}
                onClick={() => setOrder("captured")}
              >
                Newest first
              </Button>
            </div>
            {searching && (
              <span className="text-[11px] text-text-muted">
                {snapshots.length} of {all.length}
              </span>
            )}
          </div>
        )}

        {all.length > 0 && snapshots.length === 0 && (
          <p className="text-sm text-text-muted">
            No Snapshot matches “{query.trim()}”. Names, Identities and UIDs are all searched.
          </p>
        )}

        {snapshots.length > 0 && (
          <ul className="flex flex-col divide-y divide-border">
            {snapshots.map((snapshot) => {
              const rowEditing = editing?.id === snapshot.id;
              const confirming = confirmingId === snapshot.id;
              const selected = target?.id === snapshot.id;
              const name = snapshotTitle(snapshot);
              return (
                <li
                  key={snapshot.id}
                  className={`flex items-start justify-between gap-4 py-3 first:pt-0 ${
                    selected ? "bg-surface/40" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    {confirming ? (
                      <div className="flex flex-col gap-2">
                        <p className="text-sm text-text">
                          Delete <span className="text-text">{name}</span> permanently?
                        </p>
                        <p className="max-w-prose text-xs leading-relaxed text-text-muted">
                          The Snapshot is removed from the library file and no copy is kept. The
                          Tag itself is not touched.
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            autoFocus
                            onClick={() => deleteSnapshot(snapshot)}
                            className="cursor-pointer rounded-full border border-err/50 bg-err/10 px-3 py-1.5 text-sm font-medium text-err transition-colors hover:bg-err/20"
                          >
                            Delete permanently
                          </button>
                          <Button variant="ghost" onClick={() => setConfirmingId(null)}>
                            Keep
                          </Button>
                        </div>
                      </div>
                    ) : rowEditing && editing ? (
                      <div className="flex flex-col gap-2">
                        <input
                          autoFocus
                          value={editing.draft.name}
                          onChange={(e) =>
                            setEditing({
                              id: snapshot.id,
                              draft: { ...editing.draft, name: e.target.value },
                            })
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitEdit(snapshot);
                            }
                            if (e.key === "Escape") setEditing(null);
                          }}
                          placeholder={snapshot.id}
                          aria-label={`Name for ${name}`}
                          disabled={Boolean(problem)}
                          className="w-full max-w-64 rounded-md border border-accent bg-canvas px-2 py-1 text-sm text-text outline-none disabled:opacity-50"
                        />
                        <textarea
                          value={editing.draft.note}
                          onChange={(e) =>
                            setEditing({
                              id: snapshot.id,
                              draft: { ...editing.draft, note: e.target.value },
                            })
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Escape") setEditing(null);
                          }}
                          rows={2}
                          placeholder="Note — what this Tag opens, or which site it is for"
                          aria-label={`Note for ${name}`}
                          disabled={Boolean(problem)}
                          className="w-full resize-y rounded-md border border-border bg-canvas px-2 py-1 text-xs leading-relaxed text-text placeholder-text-muted/60 outline-none focus:border-accent disabled:opacity-50"
                        />
                        <div className="flex items-center gap-2">
                          <Button variant="primary" onClick={() => commitEdit(snapshot)}>
                            Save
                          </Button>
                          <Button variant="ghost" onClick={() => setEditing(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          if (problem) return;
                          setConfirmingId(null);
                          setEditing({ id: snapshot.id, draft: draftOf(snapshot) });
                        }}
                        aria-label={`Rename ${name} or add a note`}
                        title={
                          problem
                            ? "The library file cannot be written to"
                            : "Rename, or add a note"
                        }
                        className="-mx-1 flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-surface-raised"
                      >
                        <span className="truncate text-sm text-text">{name}</span>
                        {!problem && <Pencil size={11} className="shrink-0 text-text-muted" />}
                      </button>
                    )}

                    <div className="mt-1 flex items-center gap-1">
                      <span className="select-text font-mono text-xs text-accent-muted">
                        {snapshot.id}
                      </span>
                      <button
                        aria-label={`Copy ${snapshot.id}`}
                        onClick={() => void copyId(snapshot.id)}
                        className="cursor-pointer rounded-md p-1 text-text-muted transition-colors hover:bg-surface-raised hover:text-text"
                      >
                        {copiedId === snapshot.id ? (
                          <Check size={11} className="text-ok" />
                        ) : (
                          <Copy size={11} />
                        )}
                      </button>
                    </div>
                    <p className="mt-0.5 text-[11px] text-text-muted">
                      {snapshotDetail(snapshot)}
                    </p>
                    {snapshot.note.trim().length > 0 && (
                      <p className="mt-1 max-w-prose whitespace-pre-wrap border-l border-border pl-2 text-[11px] leading-relaxed text-text-muted">
                        {snapshot.note}
                      </p>
                    )}
                  </div>

                  {!confirming && (
                    <div className="flex shrink-0 items-center gap-1">
                      {snapshot.identity && (
                        <Button
                          variant={selected ? "primary" : "secondary"}
                          onClick={() => {
                            setTarget(selected ? null : snapshot);
                            setWriteResult(null);
                            setWriteErr(null);
                          }}
                        >
                          {selected ? "Selected" : "Write"}
                        </Button>
                      )}
                      <button
                        aria-label={`Delete ${name}`}
                        title={problem ? "The library file cannot be written to" : "Delete"}
                        disabled={Boolean(problem)}
                        onClick={() => {
                          setEditing(null);
                          setConfirmingId(snapshot.id);
                        }}
                        className="cursor-pointer rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-raised hover:text-err disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {target?.identity && (
          <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
            <p className="text-xs leading-relaxed text-text-muted">
              Writing <span className="font-mono text-text">{target.id}</span>. Put a{" "}
              <strong className="text-text">blank</strong> tag on the reader — not the original.
              The write is permanent.
            </p>
            <div className="flex gap-2">
              <Button
                variant="primary"
                disabled={!connected || writeBusy}
                onClick={() => void writeSaved()}
              >
                {writeBusy ? "Writing…" : "Write to tag"}
              </Button>
              <Button variant="ghost" disabled={writeBusy} onClick={() => setTarget(null)}>
                Cancel
              </Button>
            </div>
            {writeErr && <p className="text-xs text-err">{writeErr}</p>}
            {writeResult?.verified && (
              <p className="text-xs text-ok">
                Verified — the tag now reads {writeResult.readback?.id}.
              </p>
            )}
          </div>
        )}
      </Section>

      <Section title="Where this is kept" hint={LIBRARY_PLAINTEXT_NOTICE}>
        <code className="block select-text break-all rounded-lg border border-border bg-canvas px-3 py-2 font-mono text-xs leading-relaxed text-text-muted">
          {view?.path ?? "the app data directory"}
        </code>
      </Section>
    </div>
  );
}
