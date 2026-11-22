import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, Copy } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Notice } from "../components/ui/Notice";
import { Segmented } from "../components/ui/Segmented";
import { Section } from "../components/Section";
import { HfSnapshotReview } from "../components/HfSnapshotReview";
import { WriteDraftToTag } from "../components/WriteDraftToTag";
import { LibraryProblemBanner } from "../components/LibraryProblemBanner";
import { MigrationWarning } from "../components/MigrationWarning";
import { RowDeleteConfirmation } from "../components/RowDeleteConfirmation";
import { claimPendingDraft, pendingDraft } from "../lib/draftHandoff";
import { snapshotRecords } from "../lib/hfSnapshot";
import { describeDeviceFailure } from "../lib/readerIdentity";
import { outcomes, report } from "../lib/outcome";
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
  confirmedCopiesLabel,
  writeNotice,
} from "../lib/writeOutcome";
import { NOTICE_TONE_CLASS } from "../lib/noticeTone";
import { DraftsCollection } from "./DraftsCollection";
import type { LibraryState } from "../hooks/useLibrary";
import type { Snapshot, SnapshotDraft, SnapshotOrder } from "../lib/library";
import type { WriteResult } from "../types";

interface LibraryPageProps {
  connected: boolean;
  library: LibraryState;
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
 * reachable. Both Collections have the same list-beside-detail shape: the page
 * has one shape, and a Collection is its contents rather than its layout.
 *
 * Snapshots is master-detail: the list is the left column, the open Snapshot is
 * the right one, and nothing that changes a Snapshot lives in the list. Choosing
 * another Snapshot swaps the pane and leaves the list exactly where it was, so
 * the page no longer reflows under the pointer and the list no longer carries a
 * row's editor inside it. Drafts is the same shape in `DraftsCollection`.
 *
 * The page also arrives with a Draft when a reading produced one: *Edit as Draft*
 * on a 13.56 MHz readout creates the Draft and asks the shell for this
 * destination, and the shell hands the id over through `lib/draftHandoff`. An
 * arrival like that opens on the Drafts collection and on that Draft — the one
 * place in this app where one page's action decides another page's first frame.
 */
export function LibraryPage({ connected, library }: LibraryPageProps) {
  /**
   * The Draft a reading just produced, if this page is being opened for one.
   *
   * Read once, at arrival, because that is when it means something: the press
   * created the Draft and changed destination, so this mount is the arrival. The
   * intent is peeked while rendering and claimed by the effect, because React's
   * development double invocation would otherwise spend it before the page could
   * use it (`lib/draftHandoff`). Claiming it is also what keeps a later visit
   * opening on Snapshots, as every visit did before.
   */
  const [openDraftId] = useState<string | null>(() => pendingDraft());
  const [collection, setCollection] = useState<Collection>(
    openDraftId === null ? "snapshots" : "drafts",
  );
  useEffect(() => {
    claimPendingDraft();
  }, []);
  // The library's own file, its export and import, and the action that clears
  // everything saved are Settings → Data: this page browses what is in the
  // library, and `reload` is here only because watching a Snapshot's copy count
  // can change the file underneath the list.
  const { view, error, loading, edit, remove, reload } = library;

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

  // Drafts, the other Collection of this page. It owns its own list and its own
  // selection, because a Draft's list is not a Snapshot's list and the two are
  // never one collection of things.
  if (collection === "drafts") {
    return (
      <div className="flex flex-col gap-8">
        <CollectionSwitch value={collection} onChange={setCollection} />
        <DraftsCollection connected={connected} openDraftId={openDraftId} />
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
          <Notice tone="err" label="Failed" className="mb-4">
            <p className="text-xs leading-relaxed text-text-muted">{error}</p>
          </Notice>
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
          <p className="max-w-prose text-sm text-text-muted">
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

      {/* The whole library's file, its export and import, and clearing saved
          data are Settings → Data: they act on the library rather than on what is
          being browsed. This page is for finding things. */}
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
      // One write, one outcome: the same factory the two write paths use, in the
      // write vocabulary's own words, whatever it came to. A verified write is
      // heard as done, an unconfirmed one as needs-you, a refusal as attention —
      // none of that is decided here.
      report(outcomes.write("write", res));
      // Only a confirmed copy changes the count, so only then is the list stale.
      if (res.confirmedCopies !== null) void reload();
    } catch (e) {
      setWriteErr(describeDeviceFailure(e));
      report(outcomes.readerFailure(e));
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
        {/* A confirmed copy is a copy whichever band it landed on: a 13.56 MHz
            Snapshot's Records written to another Tag raise the same count. */}
        <p className="text-xs text-text-muted" title={CONFIRMED_COPIES_HINT}>
          <span className="border-b border-dotted border-text-muted/40">
            {confirmedCopiesLabel(snapshot.writeCount)}
          </span>
        </p>
        {/* Everything a 13.56 MHz read kept, reviewable here with no Reader.
            A 125 kHz Snapshot has no such area, and this component renders
            nothing for one. */}
        <HfSnapshotReview snapshot={snapshot} />
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
            <label className="flex max-w-2xl flex-col gap-1">
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
            <label className="flex max-w-2xl flex-col gap-1">
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
                <p className="max-w-prose text-xs leading-relaxed text-text-muted">
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
                {/* Writing a Snapshot's Records is the same operation writing a
                    Draft is — one NDEF message, one confirmation naming what it
                    replaces, one read-back — so it is the same control. What
                    differs is provenance: a verified write counts a confirmed
                    copy on this Snapshot, and a write that is not verified counts
                    nothing. */}
                {(snapshotRecords(snapshot)?.length ?? 0) > 0 ? (
                  <WriteDraftToTag
                    records={snapshotRecords(snapshot) ?? []}
                    connected={connected}
                    snapshotId={snapshot.id}
                    subject="Snapshot"
                    onCountChanged={() => void reload()}
                  />
                ) : (
                  <p className="max-w-prose text-xs leading-relaxed text-text-muted">
                    {snapshotRecords(snapshot) === null
                      ? "This Snapshot records no list of Records, so there is no message to write back. It is not an empty message: nothing was read."
                      : "This Snapshot's Tag carried no Records, so there is no message to write back."}
                  </p>
                )}
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
