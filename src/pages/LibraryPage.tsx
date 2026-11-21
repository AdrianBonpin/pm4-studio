import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, Copy, Pencil, Trash2 } from "lucide-react";
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
import { DraftsPage } from "./DraftsPage";
import type { LibraryState } from "../hooks/useLibrary";
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
 * slice only re-homes the Drafts page as it stands.
 */
export function LibraryPage({ connected, library, onChirp }: LibraryPageProps) {
  const [collection, setCollection] = useState<Collection>("snapshots");
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
            : `${all.length} ${all.length === 1 ? "Snapshot" : "Snapshots"} — click a name to rename it or add a note.`
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

      {/* The whole library's file, its export and import, and clearing saved
          data are Settings → Data: they act on the library rather than on what is
          being browsed. This page is for finding things. */}

    </div>
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
