import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Check, Copy, Pencil, Trash2 } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Section } from "../components/Section";
import { RowDeleteConfirmation } from "../components/RowDeleteConfirmation";
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
import {
  CONFIRMED_COPIES_HINT,
  NOTICE_TONE_CLASS,
  confirmedCopiesLabel,
  writeNotice,
} from "../lib/writeOutcome";
import {
  describeExport,
  describeImportApplied,
  describeImportPreview,
  nothingToAdd,
  suggestedExportName,
} from "../lib/libraryFiles";
import type { LibraryState } from "../hooks/useLibrary";
import type { ImportPreview } from "../lib/libraryFiles";
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
  const { view, error, loading, edit, remove, pickPath, exportTo, previewImport, applyImport } =
    library;

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

  // Export and import. The chosen path is held only until the import is applied
  // or cancelled; nothing is written before that.
  const [fileBusy, setFileBusy] = useState(false);
  const [fileNote, setFileNote] = useState<{ text: string; path?: string } | null>(null);
  const [importPath, setImportPath] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);

  const all = view?.snapshots ?? [];
  // One pass over the Snapshots already in the view per keystroke, reusing their
  // objects. Nothing is reloaded or rebuilt here, so several hundred entries
  // stay responsive; the file is only read again when the library changes.
  const snapshots = useMemo(
    () => sortSnapshots(filterSnapshots(all, query), order),
    [all, query, order],
  );
  const problem = view?.problem ?? null;
  const migrationWarning = view?.migrationWarning ?? null;
  const searching = query.trim().length > 0;
  const notice = writeResult ? writeNotice(writeResult) : null;

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

  const resetImport = () => {
    setImportPath(null);
    setImportPreview(null);
  };

  const exportLibrary = async () => {
    setFileNote(null);
    resetImport();
    setFileBusy(true);
    try {
      const path = await pickPath("save", suggestedExportName(new Date()));
      // Cancelled: nothing was written, so there is nothing to report.
      if (!path) return;
      const result = await exportTo(path);
      if (result) setFileNote({ text: describeExport(result), path: result.path });
    } finally {
      setFileBusy(false);
    }
  };

  const chooseImport = async () => {
    setFileNote(null);
    resetImport();
    setFileBusy(true);
    try {
      const path = await pickPath("open");
      // Cancelled: the library has not been read or written.
      if (!path) return;
      const preview = await previewImport(path);
      if (preview) {
        setImportPath(path);
        setImportPreview(preview);
      }
    } finally {
      setFileBusy(false);
    }
  };

  const confirmImport = async () => {
    if (!importPath) return;
    setFileBusy(true);
    try {
      const result = await applyImport(importPath);
      if (result) {
        // The merge keeps every Snapshot already here, so an import never
        // renames or overwrites one: the applied note says what was added.
        setFileNote({ text: describeImportApplied(result.preview) });
        resetImport();
      }
    } finally {
      setFileBusy(false);
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
      // Only a confirmed copy changes the count, so only then is the list stale.
      if (res.verified) onChirp();
      if (res.confirmedCopies !== null) void library.reload();
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
        {migrationWarning && (
          <div className="mb-4 flex items-start gap-3 border-l-2 border-warn bg-warn/5 px-3 py-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />
            <div className="min-w-0">
              <p className="text-sm text-warn">
                This library was upgraded from an older version
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
                {migrationWarning} Saving is still on: a save writes the upgraded library and
                corrects the version the file claims.
              </p>
            </div>
          </div>
        )}

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
                      <RowDeleteConfirmation
                        name={name}
                        onConfirm={() => deleteSnapshot(snapshot)}
                        onDismiss={() => setConfirmingId(null)}
                      >
                        The Snapshot is removed from the library file and no copy is kept. The Tag
                        itself is not touched.
                      </RowDeleteConfirmation>
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
                    {snapshot.identity && (
                      <p
                        className="mt-0.5 text-[11px] text-text-muted"
                        title={CONFIRMED_COPIES_HINT}
                      >
                        <span className="border-b border-dotted border-text-muted/40">
                          {confirmedCopiesLabel(snapshot.writeCount)}
                        </span>
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
            {notice && (
              <p className={`text-xs leading-relaxed ${NOTICE_TONE_CLASS[notice.tone]}`}>
                {notice.text}
              </p>
            )}
            {writeResult?.countProblem && (
              <p className="text-xs leading-relaxed text-err">
                The confirmed-copy count could not be saved: {writeResult.countProblem}
              </p>
            )}
          </div>
        )}
      </Section>

      <Section
        title="Export and import"
        hint="The whole library in one file: back it up, or move it to another machine. An import adds what is missing and leaves every entry already here exactly as it is."
      >
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={problem !== null || fileBusy}
            onClick={() => void exportLibrary()}
          >
            Export library…
          </Button>
          <Button
            variant="secondary"
            disabled={problem !== null || fileBusy}
            onClick={() => void chooseImport()}
          >
            Import library…
          </Button>
        </div>

        {importPreview && importPath && (
          <div className="mt-4 flex flex-col gap-3 border-l-2 border-accent bg-accent/5 px-3 py-3">
            <p className="text-sm leading-relaxed text-text">
              {describeImportPreview(importPreview)}
            </p>
            <code className="select-text break-all font-mono text-[11px] text-text-muted">
              {importPath}
            </code>
            <p className="text-xs leading-relaxed text-text-muted">
              Nothing has been written yet. Add to library applies the import; Cancel leaves the
              library exactly as it is.
            </p>
            <div className="flex gap-2">
              <Button
                variant="primary"
                disabled={fileBusy || nothingToAdd(importPreview)}
                onClick={() => void confirmImport()}
              >
                {fileBusy ? "Adding…" : "Add to library"}
              </Button>
              <Button variant="ghost" disabled={fileBusy} onClick={resetImport}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {fileNote && (
          <div className="mt-3">
            <p className="text-xs leading-relaxed text-ok">{fileNote.text}</p>
            {fileNote.path && (
              <code className="mt-1 block select-text break-all font-mono text-[11px] text-text-muted">
                {fileNote.path}
              </code>
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
