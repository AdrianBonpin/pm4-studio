import { useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Section } from "../components/Section";
import { useDrafts } from "../hooks/useDrafts";
import {
  DRAFT_NOT_A_TAG_NOTICE,
  EMPTY_DRAFT_DETAIL,
  EMPTY_DRAFT_TITLE,
  EMPTY_DRAFTS_DETAIL,
  EMPTY_DRAFTS_TITLE,
  draftDetail,
  draftTitle,
  newTextRecord,
  newUrlRecord,
  recordKindLabel,
  recordSummary,
} from "../lib/drafts";
import { recordSizeBytes, recordsByteLength } from "../lib/ndef";
import type { Draft, DraftRecord } from "../lib/drafts";

/** The encoded size of one Record, or null when this build cannot encode it. */
function sizeOf(record: DraftRecord): number | null {
  try {
    return recordSizeBytes(record);
  } catch {
    return null;
  }
}

/** The encoded size of a whole Draft, or null when one Record is unencodable. */
function draftSize(draft: Draft): number | null {
  try {
    return recordsByteLength(draft.records);
  } catch {
    return null;
  }
}

/**
 * Drafts: NDEF messages under construction, with no Tag attached.
 *
 * This is deliberately its own section rather than a tab of the Library. A
 * Snapshot is a record of a read and is never edited; a Draft is edited
 * constantly and belongs to no Tag. Showing them in one list would make "my
 * tags" mean two different things.
 */
export function DraftsPage() {
  const drafts = useDrafts();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");

  const list = drafts.drafts;
  const selected = list.find((draft) => draft.id === selectedId) ?? null;
  const locked = drafts.problem !== null;

  const create = async () => {
    const draft = await drafts.create(newName);
    setNewName("");
    if (draft) setSelectedId(draft.id);
  };

  const commitRename = (draft: Draft, name: string) => {
    setRenamingId(null);
    if (name.trim() === draft.name.trim()) return;
    drafts.rename(draft.id, name);
  };

  return (
    <div className="flex flex-col gap-8">
      <Section
        title="Drafts"
        hint="A Draft is a message you compose before a Tag is in hand. It holds Records in order and is not attached to any Tag."
      >
        {drafts.problem && (
          <div className="mb-4 border-l-2 border-err bg-err/5 px-3 py-2">
            <p className="text-sm text-err">
              {drafts.problem.kind === "newerVersion"
                ? "This library was written by a newer version of PM4 Studio"
                : drafts.problem.kind === "olderVersion"
                  ? "This library is from an older version of PM4 Studio"
                  : "The library file could not be read"}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
              {drafts.problem.message} Saving is turned off until it is dealt with, so the file on
              disk is never replaced by an empty one.
            </p>
          </div>
        )}

        {drafts.error && (
          <p className="mb-4 border-l-2 border-err bg-err/5 px-3 py-2 text-xs leading-relaxed text-err">
            {drafts.error}
          </p>
        )}

        <div className="flex items-start gap-2">
          <Input
            value={newName}
            onChange={setNewName}
            onKeyDown={(e) => {
              if (e.key === "Enter") void create();
            }}
            placeholder="Name a new Draft, for example Front door"
            aria-label="Name of the new Draft"
            disabled={locked}
          />
          <Button variant="secondary" onClick={() => void create()} disabled={locked}>
            <Plus size={14} />
            New Draft
          </Button>
        </div>

        {drafts.loading && <p className="mt-4 text-sm text-text-muted">Reading Drafts…</p>}

        {!drafts.loading && list.length === 0 && !drafts.problem && (
          <div className="mt-4 flex flex-col items-start gap-2 border border-dashed border-border px-4 py-6">
            <p className="font-heading text-sm text-text">{EMPTY_DRAFTS_TITLE}</p>
            <p className="max-w-prose text-sm leading-relaxed text-text-muted">
              {EMPTY_DRAFTS_DETAIL}
            </p>
          </div>
        )}

        {list.length > 0 && (
          <ul className="mt-4 flex flex-col divide-y divide-border">
            {list.map((draft) => {
              const renaming = renamingId === draft.id;
              const active = selected?.id === draft.id;
              return (
                <li
                  key={draft.id}
                  className={`flex items-start justify-between gap-4 py-3 first:pt-0 ${
                    active ? "bg-surface/40" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    {renaming ? (
                      <input
                        autoFocus
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename(draft, nameDraft);
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        onBlur={() => commitRename(draft, nameDraft)}
                        placeholder={draftTitle(draft)}
                        aria-label={`Rename ${draftTitle(draft)}`}
                        disabled={locked}
                        className="w-full max-w-64 rounded-md border border-accent bg-canvas px-2 py-1 text-sm text-text outline-none disabled:opacity-50"
                      />
                    ) : (
                      <button
                        onClick={() => {
                          if (locked) return;
                          setRenamingId(draft.id);
                          setNameDraft(draft.name);
                        }}
                        aria-label={`Rename ${draftTitle(draft)}`}
                        title={locked ? "The library file cannot be written to" : "Rename"}
                        className="-mx-1 cursor-pointer rounded-md px-1 py-0.5 text-left transition-colors hover:bg-surface-raised"
                      >
                        <span className="truncate text-sm text-text">{draftTitle(draft)}</span>
                      </button>
                    )}
                    <p className="mt-0.5 text-[11px] text-text-muted">{draftDetail(draft)}</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant={active ? "primary" : "secondary"}
                      onClick={() => {
                        setRenamingId(null);
                        setSelectedId(active ? null : draft.id);
                      }}
                    >
                      {active ? "Editing" : "Edit"}
                    </Button>
                    <button
                      aria-label={`Delete ${draftTitle(draft)}`}
                      title={locked ? "The library file cannot be written to" : "Delete"}
                      disabled={locked}
                      onClick={() => {
                        if (active) setSelectedId(null);
                        void drafts.remove(draft.id);
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

        {!selected && list.length > 0 && (
          <p className="mt-4 text-xs leading-relaxed text-text-muted">
            Choose Edit to open a Draft and add Records to it.
          </p>
        )}
      </Section>

      {selected && (
        <Section title="Records" hint={`${DRAFT_NOT_A_TAG_NOTICE} Changes are saved as you edit.`}>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm text-text">{draftTitle(selected)}</p>
            <p className="font-mono text-[11px] text-text-muted">
              {selected.records.length} {selected.records.length === 1 ? "Record" : "Records"} ·{" "}
              {draftSize(selected) ?? "size unavailable"} bytes
            </p>
          </div>

          {selected.records.length === 0 && (
            <div className="mt-4 flex flex-col items-start gap-2 border border-dashed border-border px-4 py-6">
              <p className="font-heading text-sm text-text">{EMPTY_DRAFT_TITLE}</p>
              <p className="max-w-prose text-sm leading-relaxed text-text-muted">
                {EMPTY_DRAFT_DETAIL}
              </p>
            </div>
          )}

          {selected.records.length > 0 && (
            <ul className="mt-4 flex flex-col divide-y divide-border">
              {selected.records.map((record, index) => (
                <RecordRow
                  key={index}
                  record={record}
                  position={index}
                  total={selected.records.length}
                  disabled={locked}
                  onChange={(next) => {
                    const records = selected.records.slice();
                    records[index] = next;
                    drafts.setRecords(selected.id, records);
                  }}
                  onMove={(to) => {
                    if (to < 0 || to >= selected.records.length) return;
                    const records = selected.records.slice();
                    const [moved] = records.splice(index, 1);
                    if (!moved) return;
                    records.splice(to, 0, moved);
                    drafts.setRecords(selected.id, records);
                  }}
                  onDelete={() => {
                    drafts.setRecords(
                      selected.id,
                      selected.records.filter((_, at) => at !== index),
                    );
                  }}
                />
              ))}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <Button
              variant="secondary"
              disabled={locked}
              onClick={() =>
                drafts.setRecords(selected.id, [...selected.records, newTextRecord()])
              }
            >
              <Plus size={14} />
              Add Text
            </Button>
            <Button
              variant="secondary"
              disabled={locked}
              onClick={() => drafts.setRecords(selected.id, [...selected.records, newUrlRecord()])}
            >
              <Plus size={14} />
              Add URL
            </Button>
            <p className="text-[11px] leading-relaxed text-text-muted">
              Records are written as one message, in this order. There is no appending in place.
            </p>
          </div>
        </Section>
      )}
    </div>
  );
}

interface RecordRowProps {
  record: DraftRecord;
  position: number;
  total: number;
  disabled: boolean;
  onChange: (record: DraftRecord) => void;
  onMove: (to: number) => void;
  onDelete: () => void;
}

/** One Record in the queue, edited in place. */
function RecordRow({
  record,
  position,
  total,
  disabled,
  onChange,
  onMove,
  onDelete,
}: RecordRowProps) {
  const size = sizeOf(record);
  return (
    <li className="flex items-start justify-between gap-4 py-3 first:pt-0">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] uppercase tracking-[0.12em] text-text-muted">
            {recordKindLabel(record)}
          </span>
          <span className="font-mono text-[11px] text-text-muted">
            {size === null ? "?" : size} {size === 1 ? "byte" : "bytes"}
          </span>
          <span className="truncate font-mono text-[11px] text-accent-muted">
            {recordSummary(record) || "empty"}
          </span>
        </div>

        {record.kind === "text" && (
          <div className="flex items-start gap-2">
            <Input
              value={record.fields.language}
              onChange={(language) => onChange({ kind: "text", fields: { ...record.fields, language } })}
              placeholder="en"
              aria-label="Language code"
              disabled={disabled}
              className="max-w-20"
            />
            <Input
              value={record.fields.text}
              onChange={(text) => onChange({ kind: "text", fields: { ...record.fields, text } })}
              placeholder="The text a phone will show"
              aria-label="Text"
              disabled={disabled}
            />
          </div>
        )}

        {record.kind === "url" && (
          <Input
            value={record.fields.url}
            onChange={(url) => onChange({ kind: "url", fields: { url } })}
            placeholder="https://example.com"
            aria-label="URL"
            disabled={disabled}
          />
        )}

        {record.kind !== "text" && record.kind !== "url" && (
          <p className="text-xs leading-relaxed text-err">
            This build cannot edit this Record, so it is kept exactly as it is.
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <button
          aria-label="Move up"
          title="Move up"
          disabled={position === 0}
          onClick={() => onMove(position - 1)}
          className="cursor-pointer rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-raised hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronUp size={13} />
        </button>
        <button
          aria-label="Move down"
          title="Move down"
          disabled={position === total - 1}
          onClick={() => onMove(position + 1)}
          className="cursor-pointer rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-raised hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronDown size={13} />
        </button>
        <button
          aria-label="Delete Record"
          title="Delete Record"
          onClick={onDelete}
          className="cursor-pointer rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-raised hover:text-err"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </li>
  );
}
