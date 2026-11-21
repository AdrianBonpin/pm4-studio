import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Check, Pencil, Trash2, X } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Section } from "../components/Section";
import { describeDeviceFailure } from "../lib/readerIdentity";
import {
  EMPTY_LIBRARY_DETAIL,
  EMPTY_LIBRARY_TITLE,
  LIBRARY_PLAINTEXT_NOTICE,
  snapshotDetail,
  snapshotTitle,
} from "../lib/library";
import {
  describeExport,
  describeImportApplied,
  describeImportPreview,
  nothingToAdd,
  suggestedExportName,
} from "../lib/libraryFiles";
import type { LibraryState } from "../hooks/useLibrary";
import type { ImportPreview } from "../lib/libraryFiles";
import type { Snapshot } from "../lib/library";
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
  const { view, error, loading, rename, remove, pickPath, exportTo, previewImport, applyImport } =
    library;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [target, setTarget] = useState<Snapshot | null>(null);
  const [writeBusy, setWriteBusy] = useState(false);
  const [writeResult, setWriteResult] = useState<WriteResult | null>(null);
  const [writeErr, setWriteErr] = useState<string | null>(null);

  // Export and import. The chosen path is held only until the import is
  // applied or cancelled; nothing is written before that.
  const [fileBusy, setFileBusy] = useState(false);
  const [fileNote, setFileNote] = useState<{ text: string; path?: string } | null>(null);
  const [importPath, setImportPath] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);

  const snapshots = view?.snapshots ?? [];
  const problem = view?.problem ?? null;

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
        setFileNote({ text: describeImportApplied(result.preview) });
        resetImport();
      }
    } finally {
      setFileBusy(false);
    }
  };

  const commitRename = (snapshot: Snapshot, name: string) => {
    setEditingId(null);
    if (name.trim() === snapshot.name.trim()) return;
    void rename(snapshot.id, name);
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
          snapshots.length === 0
            ? "Every read you keep, whether or not the Reader is attached."
            : `${snapshots.length} ${snapshots.length === 1 ? "Snapshot" : "Snapshots"} — click a name to rename it.`
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

        {!loading && view && !problem && snapshots.length === 0 && (
          <div className="flex flex-col items-start gap-2 border border-dashed border-border px-4 py-6">
            <p className="font-heading text-sm text-text">{EMPTY_LIBRARY_TITLE}</p>
            <p className="max-w-prose text-sm leading-relaxed text-text-muted">
              {EMPTY_LIBRARY_DETAIL}
            </p>
          </div>
        )}

        {snapshots.length > 0 && (
          <ul className="flex flex-col divide-y divide-border">
            {snapshots.map((snapshot) => {
              const editing = editingId === snapshot.id;
              const selected = target?.id === snapshot.id;
              return (
                <li
                  key={snapshot.id}
                  className={`flex items-start justify-between gap-4 py-3 first:pt-0 ${
                    selected ? "bg-surface/40" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    {editing ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          autoFocus
                          value={draftName}
                          onChange={(e) => setDraftName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename(snapshot, draftName);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          onBlur={() => commitRename(snapshot, draftName)}
                          placeholder={snapshot.id}
                          disabled={Boolean(problem)}
                          className="w-full max-w-64 rounded-md border border-accent bg-canvas px-2 py-1 text-sm text-text outline-none disabled:opacity-50"
                        />
                        <button
                          aria-label="Save name"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => commitRename(snapshot, draftName)}
                          className="cursor-pointer text-ok"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          aria-label="Cancel rename"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => setEditingId(null)}
                          className="cursor-pointer text-text-muted hover:text-text"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          if (problem) return;
                          setEditingId(snapshot.id);
                          setDraftName(snapshot.name);
                        }}
                        aria-label={`Rename ${snapshotTitle(snapshot)}`}
                        title={problem ? "The library file cannot be written to" : "Rename"}
                        className="-mx-1 flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-surface-raised"
                      >
                        <span className="truncate text-sm text-text">
                          {snapshotTitle(snapshot)}
                        </span>
                        {!problem && <Pencil size={11} className="shrink-0 text-text-muted" />}
                      </button>
                    )}

                    <p className="mt-1 font-mono text-xs text-accent-muted">{snapshot.id}</p>
                    <p className="mt-0.5 text-[11px] text-text-muted">
                      {snapshotDetail(snapshot)}
                    </p>
                  </div>

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
                      aria-label={`Delete ${snapshotTitle(snapshot)}`}
                      title={problem ? "The library file cannot be written to" : "Delete"}
                      disabled={Boolean(problem)}
                      onClick={() => {
                        if (target?.id === snapshot.id) setTarget(null);
                        void remove(snapshot.id);
                      }}
                      className="cursor-pointer rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-raised hover:text-err disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
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

      <Section
        title="Export and import"
        hint="The whole library in one file: back it up, or move it to another machine. An import adds what is missing and leaves every Snapshot already here exactly as it is."
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
