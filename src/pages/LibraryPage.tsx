import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, Copy } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Segmented } from "../components/ui/Segmented";
import { Section } from "../components/Section";
import { LibraryProblemBanner } from "../components/LibraryProblemBanner";
import { MigrationWarning } from "../components/MigrationWarning";
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
import { DraftsPage } from "./DraftsPage";
import type { LibraryState } from "../hooks/useLibrary";
import type { ImportPreview } from "../lib/libraryFiles";
import type { Snapshot, SnapshotDraft, SnapshotOrder } from "../lib/library";
import type { WriteResult } from "../types";

interface LibraryPageProps {
  connected: boolean;
  library: LibraryState;
  onChirp: () => void;
}

/** Library's two kinds of saved thing, in the order the switch shows them. */
type Collection = "snapshots" | "drafts";

/**
 * The library, with no Reader required. Snapshots are read from a file in the
 * app data directory, so they are here whether or not the Reader is plugged in;
 * writing one back to a Tag is the only part that needs hardware.
 *
 * Library holds both Collections. Drafts is not a destination any more — the
 * sidebar is five destinations and Drafts is not one of them — so the second
 * Collection lives here, and this one switch is what keeps every saved Draft
 * reachable. Ticket 10 gives both Collections the list-beside-detail shape; this
 * slice gives it to Snapshots.
 *
 * Snapshots is master-detail: the list is the left column, the open Snapshot is
 * the right one, and nothing that changes a Snapshot lives in the list. Choosing
 * another Snapshot swaps the pane and leaves the list exactly where it was, so
 * the page no longer reflows under the pointer and the list no longer carries a
 * row's editor inside it.
 */
export function LibraryPage({ connected, library, onChirp }: LibraryPageProps) {
  const [collection, setCollection] = useState<Collection>("snapshots");
  const { view, error, loading, edit, remove, pickPath, exportTo, previewImport, applyImport, reload } =
    library;

  /**
   * Which Snapshot the pane is showing.
   *
   * `undefined` is "nobody has chosen": the first Snapshot in the list opens on
   * arrival, because a pane beside the list that starts empty spends half the
   * window saying nothing and leaves every action in it one click further away.
   * `null` is "the choice was closed again" — choosing the open Snapshot a second
   * time shuts it, which is the same toggle the Collection switch above uses.
   */
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<SnapshotOrder>("name");

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

  // The open Snapshot is looked up in the whole library, not in the filtered
  // list: typing in the search narrows what can be chosen, and hiding the pane's
  // subject mid-sentence because a keystroke did not match it would throw away
  // the note being written.
  const selectedId = picked === undefined ? (snapshots[0]?.id ?? null) : picked;
  const selected = selectedId === null ? null : (all.find((s) => s.id === selectedId) ?? null);

  const choose = (id: string) => {
    setPicked(id === selectedId ? null : id);
  };

  const deleteSnapshot = (id: string) => {
    void remove(id);
    // The Snapshot that was open is gone, so the pane goes back to opening the
    // first one rather than pointing at something that no longer exists.
    setPicked(undefined);
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

  // Drafts, as it stands, inside the Collection it now belongs to. Ticket 10
  // gives both Collections the list-beside-detail shape; until then this is the
  // same editor it always was, reached from Library instead of from the sidebar.
  if (collection === "drafts") {
    return (
      <div className="flex flex-col gap-8">
        <CollectionSwitch value={collection} onChange={setCollection} />
        <DraftsPage connected={connected} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <CollectionSwitch value={collection} onChange={setCollection} />

      <Section
        title="Snapshots"
        hint={
          all.length === 0
            ? "Every read you keep, whether or not the Reader is attached."
            : `${all.length} ${all.length === 1 ? "Snapshot" : "Snapshots"} — kept whether or not the Reader is attached.`
        }
      >
        {migrationWarning && <MigrationWarning detail={migrationWarning} />}

        {problem && <LibraryProblemBanner problem={problem} />}

        {error && (
          <p className="mb-4 border-l-2 border-err bg-err/5 px-3 py-2 text-xs leading-relaxed text-err">
            {error}
          </p>
        )}

        {loading && <p className="text-sm text-text-muted">Reading the library…</p>}

        {!loading && !view && !error && (
          <p className="text-sm text-text-muted">The library could not be read.</p>
        )}

        {/* Empty library: nothing to list, nothing to select, so the page says
            what a Snapshot is instead of framing an empty pane. */}
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
          <div data-layout="list-detail" className="flex flex-col gap-6 md:flex-row md:items-start">
            {/* The list column scrolls on its own, so five hundred Snapshots
                never stretch the page and never move the pane out of reach. */}
            <ul
              role="list"
              className="flex max-h-[55vh] min-w-0 flex-col gap-0.5 overflow-y-auto overscroll-contain pr-1 md:w-56 md:shrink-0"
            >
              {snapshots.map((snapshot) => {
                const isOpen = snapshot.id === selectedId;
                const name = snapshotTitle(snapshot);
                return (
                  <li key={snapshot.id}>
                    <button
                      type="button"
                      aria-label={`${name} — ${snapshot.id}`}
                      aria-pressed={isOpen}
                      onClick={() => choose(snapshot.id)}
                      className={`flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors ${
                        isOpen ? "bg-surface-raised" : "hover:bg-surface/60"
                      }`}
                    >
                      <span className="w-full max-w-full truncate text-sm text-text">{name}</span>
                      <span className="w-full max-w-full truncate font-mono text-[11px] text-accent-muted">
                        {snapshot.id}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {selected ? (
              <SnapshotDetail
                // Keyed by the Snapshot: opening another one starts from a fresh
                // draft and a fresh write report, never the last one's.
                key={selected.id}
                snapshot={selected}
                connected={connected}
                locked={Boolean(problem)}
                onEdit={(draft) => void edit(selected.id, draft)}
                onDelete={() => deleteSnapshot(selected.id)}
                onChirp={onChirp}
                reload={reload}
              />
            ) : (
              <section
                role="region"
                aria-label="Snapshot detail"
                className="min-w-0 flex-1 md:border-l md:border-border md:pl-6"
              >
                <p className="text-sm text-text">Nothing selected</p>
                <p className="mt-1 max-w-prose text-xs leading-relaxed text-text-muted">
                  Choose a Snapshot from the list to rename it, add a note, or write it back to a
                  tag.
                </p>
              </section>
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

interface SnapshotDetailProps {
  /** The Snapshot the pane is showing. Changing it remounts the pane. */
  snapshot: Snapshot;
  connected: boolean;
  /** The library file cannot be written, so nothing that writes to it may run. */
  locked: boolean;
  /** Save this draft of the name and note. The caller owns the store. */
  onEdit: (draft: SnapshotDraft) => void;
  onDelete: () => void;
  onChirp: () => void;
  reload: () => Promise<void>;
}

/**
 * The Snapshot the list has open, and everything that changes it.
 *
 * The pane is one Snapshot at a time and is remounted when the id changes, so a
 * half-typed note or a write report can never carry over onto the next Snapshot.
 * Its text is a draft: the stored Snapshot is written from `onEdit` and from
 * nowhere else, which is what keeps "cancel" meaning something.
 */
function SnapshotDetail({
  snapshot,
  connected,
  locked,
  onEdit,
  onDelete,
  onChirp,
  reload,
}: SnapshotDetailProps) {
  const [draft, setDraft] = useState<SnapshotDraft>(() => draftOf(snapshot));
  // The store is the truth: after a save, or a reload that changed the file, the
  // draft follows what is stored rather than arguing with it.
  useEffect(() => {
    setDraft(draftOf(snapshot));
  }, [snapshot.id, snapshot.name, snapshot.note]);

  // Deleting is permanent, so it takes a second, deliberate click.
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [writeBusy, setWriteBusy] = useState(false);
  const [writeResult, setWriteResult] = useState<WriteResult | null>(null);
  const [writeErr, setWriteErr] = useState<string | null>(null);

  const name = snapshotTitle(snapshot);
  const dirty = draftIsDirty(snapshot, draft);
  const notice = writeResult ? writeNotice(writeResult) : null;
  const lockedHint = locked ? "The library file cannot be written to" : undefined;

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(snapshot.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard can be unavailable; the id is visible and selectable anyway.
    }
  };

  const writeSaved = async () => {
    if (!snapshot.identity) return;
    setWriteBusy(true);
    setWriteErr(null);
    setWriteResult(null);
    try {
      const res = await invoke<WriteResult>("lf_write", {
        customer: snapshot.identity.customer,
        data32: snapshot.identity.data32,
      });
      setWriteResult(res);
      // Only a confirmed copy changes the count, so only then is the list stale.
      if (res.verified) onChirp();
      if (res.confirmedCopies !== null) void reload();
    } catch (e) {
      setWriteErr(describeDeviceFailure(e));
    } finally {
      setWriteBusy(false);
    }
  };

  return (
    <section
      role="region"
      aria-label="Snapshot detail"
      className="flex min-w-0 flex-1 flex-col gap-4 md:border-l md:border-border md:pl-6"
    >
      <div className="flex flex-col gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 truncate select-text font-mono text-sm text-accent-muted">
            {snapshot.id}
          </span>
          <button
            type="button"
            aria-label={`Copy ${snapshot.id}`}
            onClick={() => void copyId()}
            className="shrink-0 cursor-pointer rounded-md p-1 text-text-muted transition-colors hover:bg-surface-raised hover:text-text"
          >
            {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
          </button>
        </div>
        <p className="text-xs leading-relaxed text-text-muted">{snapshotDetail(snapshot)}</p>
        {snapshot.identity && (
          <p className="text-xs text-text-muted" title={CONFIRMED_COPIES_HINT}>
            <span className="border-b border-dotted border-text-muted/40">
              {confirmedCopiesLabel(snapshot.writeCount)}
            </span>
          </p>
        )}
        {/* Records are a 13.56 MHz message's, so a 125 kHz Snapshot has no such
            area. A 13.56 MHz one has it and states its absence: nothing is still
            arriving from a library file that has already been read. Ticket 09
            fills it when saving a read keeps the Records. */}
        {snapshot.kind === "HF" && (
          <div className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.12em] text-text-muted">Records</span>
            <span className="text-sm text-text">none</span>
          </div>
        )}
      </div>

      {confirming ? (
        <div className="border-t border-border pt-4">
          <RowDeleteConfirmation
            name={name}
            onConfirm={() => {
              setConfirming(false);
              onDelete();
            }}
            onDismiss={() => setConfirming(false)}
          >
            The Snapshot is removed from the library file and no copy is kept. The Tag itself is
            not touched.
          </RowDeleteConfirmation>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-[0.12em] text-text-muted">Name</span>
              <Input
                value={draft.name}
                onChange={(value) => setDraft({ ...draft, name: value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (dirty && !locked) onEdit(draft);
                  }
                  if (e.key === "Escape") setDraft(draftOf(snapshot));
                }}
                placeholder={snapshot.id}
                aria-label={`Name for ${name}`}
                disabled={locked}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-[0.12em] text-text-muted">Note</span>
              <textarea
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setDraft(draftOf(snapshot));
                }}
                rows={3}
                placeholder="Note — what this Tag opens, or which site it is for"
                aria-label={`Note for ${name}`}
                disabled={locked}
                className="w-full resize-y rounded-lg border border-border bg-surface px-4 py-2 text-sm leading-relaxed text-text placeholder-text-muted/60 outline-none transition-colors focus:border-accent disabled:opacity-50"
              />
            </label>
            <div className="flex items-center gap-2">
              <Button variant="primary" disabled={locked || !dirty} onClick={() => onEdit(draft)}>
                Save
              </Button>
              <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(draftOf(snapshot))}>
                Revert
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-4">
            {snapshot.identity ? (
              <>
                <p className="text-xs leading-relaxed text-text-muted">
                  Put a <strong className="text-text">blank</strong> Tag on the reader — not the
                  original. The write is permanent.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="primary"
                    disabled={!connected || writeBusy}
                    onClick={() => void writeSaved()}
                  >
                    {writeBusy ? "Writing…" : "Write to tag"}
                  </Button>
                  <Button
                    variant="danger"
                    aria-label={`Delete ${name}`}
                    title={lockedHint}
                    disabled={locked}
                    onClick={() => setConfirming(true)}
                  >
                    Delete
                  </Button>
                </div>
              </>
            ) : (
              <>
                {/* Not hidden, stated: the app does not write a 13.56 MHz
                    Snapshot back to a Tag yet, and says so rather than leaving a
                    reader to wonder where the control went. */}
                <p className="text-xs leading-relaxed text-text-muted">
                  Writing a 13.56 MHz Snapshot back to a Tag is not supported by this build.
                </p>
                <div>
                  <Button
                    variant="danger"
                    aria-label={`Delete ${name}`}
                    title={lockedHint}
                    disabled={locked}
                    onClick={() => setConfirming(true)}
                  >
                    Delete
                  </Button>
                </div>
              </>
            )}
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
        </>
      )}
    </section>
  );
}

/**
 * The one control that keeps both Collections reachable.
 *
 * It sits above the panel rather than inside either one, so switching does not
 * feel like navigating: it is the same page, showing the other Collection.
 */
function CollectionSwitch({
  value,
  onChange,
}: {
  value: Collection;
  onChange: (next: Collection) => void;
}) {
  return (
    <Segmented
      label="Collection"
      value={value}
      options={[
        { value: "snapshots", label: "Snapshots" },
        { value: "drafts", label: "Drafts" },
      ]}
      onChange={onChange}
    />
  );
}
