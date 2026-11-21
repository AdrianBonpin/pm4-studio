import { useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Section } from "../components/Section";
import { LoadTagIntoDraft } from "../components/LoadTagIntoDraft";
import { WriteDraftToTag } from "../components/WriteDraftToTag";
import { useDrafts } from "../hooks/useDrafts";
import {
  DRAFT_NOT_A_TAG_NOTICE,
  EMPTY_DRAFT_DETAIL,
  EMPTY_DRAFT_TITLE,
  EMPTY_DRAFTS_DETAIL,
  EMPTY_DRAFTS_TITLE,
  RECORD_KINDS,
  RECORD_KIND_LABELS,
  capacityNote,
  draftDetail,
  draftTitle,
  newRecord,
  recordKindLabel,
  recordSummary,
} from "../lib/drafts";
import { recordProblem, recordSizeBytes, recordsByteLength } from "../lib/ndef";
import { INPUT_ROUNDING } from "../lib/uiConstants";
import type { Draft, DraftRecord, RecordKind, WifiAuth, WifiEncryption } from "../lib/drafts";

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
export function DraftsPage({ connected }: { connected: boolean }) {
  const drafts = useDrafts();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [newKind, setNewKind] = useState<RecordKind>("text");
  // A Draft was authored here and never lived on a Tag, so nothing can read it
  // back: deleting one is permanent, and it takes a second, deliberate click.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const list = drafts.drafts;
  const selected = list.find((draft) => draft.id === selectedId) ?? null;
  const locked = drafts.problem !== null;
  const total = selected ? draftSize(selected) : null;

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

  const deleteDraft = (draft: Draft) => {
    setConfirmingId(null);
    if (selectedId === draft.id) setSelectedId(null);
    void drafts.remove(draft.id);
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
              const confirming = confirmingId === draft.id;
              const active = selected?.id === draft.id;
              const name = draftTitle(draft);
              return (
                <li
                  key={draft.id}
                  className={`flex items-start justify-between gap-4 py-3 first:pt-0 ${
                    active ? "bg-surface/40" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    {confirming ? (
                      <div className="flex flex-col gap-2">
                        <p className="text-sm text-text">
                          Delete <span className="text-text">{name}</span> permanently?
                        </p>
                        <p className="max-w-prose text-xs leading-relaxed text-text-muted">
                          A Draft was written here and never lived on a Tag, so there is no copy
                          to read back. This removes it from the library file and no copy is
                          kept.
                        </p>
                        <div className="flex items-center gap-2">
                          <Button autoFocus variant="danger" onClick={() => deleteDraft(draft)}>
                            Delete permanently
                          </Button>
                          <Button variant="ghost" onClick={() => setConfirmingId(null)}>
                            Keep
                          </Button>
                        </div>
                      </div>
                    ) : renaming ? (
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
                          setConfirmingId(null);
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

                  {!confirming && (
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
                        aria-label={`Delete ${name}`}
                        title={locked ? "The library file cannot be written to" : "Delete"}
                        disabled={locked}
                        onClick={() => {
                          setRenamingId(null);
                          setConfirmingId(draft.id);
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

        {!selected && list.length > 0 && (
          <p className="mt-4 text-xs leading-relaxed text-text-muted">
            Choose Edit to open a Draft and add Records to it.
          </p>
        )}
      </Section>

      <LoadTagIntoDraft
        connected={connected}
        locked={locked}
        createWith={drafts.createWith}
        onLoaded={setSelectedId}
      />

      {selected && (
        <Section title="Records" hint={`${DRAFT_NOT_A_TAG_NOTICE} Changes are saved as you edit.`}>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm text-text">{draftTitle(selected)}</p>
            <p className="font-mono text-[11px] text-text-muted">
              {selected.records.length} {selected.records.length === 1 ? "Record" : "Records"} ·{" "}
              {total === null ? "total unavailable" : `${total} ${total === 1 ? "byte" : "bytes"}`}
            </p>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
            {total === null
              ? "The total is unavailable until the Record with a problem is fixed."
              : capacityNote(total, null)}
          </p>

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
            <Choice
              label="Record type to add"
              value={newKind}
              options={RECORD_KINDS.map((kind) => ({
                value: kind,
                label: RECORD_KIND_LABELS[kind],
              }))}
              onChange={(value) => setNewKind(value as RecordKind)}
              disabled={locked}
              className="max-w-44"
            />
            <Button
              variant="secondary"
              disabled={locked}
              onClick={() =>
                drafts.setRecords(selected.id, [...selected.records, newRecord(newKind)])
              }
            >
              <Plus size={14} />
              Add Record
            </Button>
            <p className="text-[11px] leading-relaxed text-text-muted">
              Records are written as one message, in this order. There is no appending in place.
            </p>
          </div>
        </Section>
      )}

      {selected && <WriteDraftToTag draft={selected} connected={connected} />}
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
  const problem = recordProblem(record);
  return (
    <li className="flex items-start justify-between gap-4 py-3 first:pt-0">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] uppercase tracking-[0.12em] text-text-muted">
            {recordKindLabel(record)}
          </span>
          <span className="font-mono text-[11px] text-text-muted">
            {size === null ? "size unavailable" : `${size} ${size === 1 ? "byte" : "bytes"}`}
          </span>
          <span className="truncate font-mono text-[11px] text-accent-muted">
            {recordSummary(record) || "empty"}
          </span>
        </div>

        <RecordFields record={record} disabled={disabled} onChange={onChange} />

        {problem && <p className="text-xs leading-relaxed text-err">{problem}</p>}
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

interface RecordFieldsProps {
  record: DraftRecord;
  disabled: boolean;
  onChange: (record: DraftRecord) => void;
}

/** The form for one Record kind. A field is edited in place as it is typed. */
function RecordFields({ record, disabled, onChange }: RecordFieldsProps) {
  switch (record.kind) {
    case "text":
      return (
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
      );
    case "url":
      return (
        <Input
          value={record.fields.url}
          onChange={(url) => onChange({ kind: "url", fields: { url } })}
          placeholder="https://example.com"
          aria-label="URL"
          disabled={disabled}
        />
      );
    case "phone":
      return (
        <Input
          value={record.fields.number}
          onChange={(number) => onChange({ kind: "phone", fields: { number } })}
          placeholder="+15550100"
          aria-label="Phone number"
          disabled={disabled}
        />
      );
    case "email":
      return (
        <Input
          value={record.fields.address}
          onChange={(address) => onChange({ kind: "email", fields: { address } })}
          placeholder="name@example.com"
          aria-label="Email address"
          disabled={disabled}
        />
      );
    case "contact":
      return (
        <div className="flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <Input
              value={record.fields.name}
              onChange={(name) => onChange({ kind: "contact", fields: { ...record.fields, name } })}
              placeholder="Name"
              aria-label="Contact name"
              disabled={disabled}
            />
            <Input
              value={record.fields.organization}
              onChange={(organization) =>
                onChange({ kind: "contact", fields: { ...record.fields, organization } })
              }
              placeholder="Organisation"
              aria-label="Contact organisation"
              disabled={disabled}
            />
          </div>
          <div className="flex items-start gap-2">
            <Input
              value={record.fields.phone}
              onChange={(phone) => onChange({ kind: "contact", fields: { ...record.fields, phone } })}
              placeholder="Telephone, optional"
              aria-label="Contact telephone"
              disabled={disabled}
            />
            <Input
              value={record.fields.email}
              onChange={(email) => onChange({ kind: "contact", fields: { ...record.fields, email } })}
              placeholder="Email, optional"
              aria-label="Contact email"
              disabled={disabled}
            />
          </div>
        </div>
      );
    case "sms":
      return (
        <div className="flex items-start gap-2">
          <Input
            value={record.fields.number}
            onChange={(number) => onChange({ kind: "sms", fields: { ...record.fields, number } })}
            placeholder="+15550100"
            aria-label="SMS number"
            disabled={disabled}
            className="max-w-44"
          />
          <Input
            value={record.fields.message}
            onChange={(message) => onChange({ kind: "sms", fields: { ...record.fields, message } })}
            placeholder="Message, optional"
            aria-label="SMS message"
            disabled={disabled}
          />
        </div>
      );
    case "location":
      return (
        <div className="flex items-start gap-2">
          <Input
            value={record.fields.latitude}
            onChange={(latitude) =>
              onChange({ kind: "location", fields: { ...record.fields, latitude } })
            }
            placeholder="Latitude, for example 51.5074"
            aria-label="Latitude"
            disabled={disabled}
          />
          <Input
            value={record.fields.longitude}
            onChange={(longitude) =>
              onChange({ kind: "location", fields: { ...record.fields, longitude } })
            }
            placeholder="Longitude, for example -0.1278"
            aria-label="Longitude"
            disabled={disabled}
          />
        </div>
      );
    case "wifi":
      return (
        <div className="flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <Input
              value={record.fields.ssid}
              onChange={(ssid) => onChange({ kind: "wifi", fields: { ...record.fields, ssid } })}
              placeholder="Network name (SSID)"
              aria-label="Wi-Fi SSID"
              disabled={disabled}
            />
            <Input
              value={record.fields.networkKey}
              onChange={(networkKey) =>
                onChange({ kind: "wifi", fields: { ...record.fields, networkKey } })
              }
              placeholder="Network key"
              aria-label="Wi-Fi network key"
              disabled={disabled}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Choice
              label="Wi-Fi authentication"
              value={record.fields.auth}
              options={WIFI_AUTH_CHOICES}
              onChange={(auth) =>
                onChange({ kind: "wifi", fields: { ...record.fields, auth: auth as WifiAuth } })
              }
              disabled={disabled}
            />
            <Choice
              label="Wi-Fi encryption"
              value={record.fields.encryption}
              options={WIFI_ENCRYPTION_CHOICES}
              onChange={(encryption) =>
                onChange({
                  kind: "wifi",
                  fields: { ...record.fields, encryption: encryption as WifiEncryption },
                })
              }
              disabled={disabled}
            />
          </div>
        </div>
      );
    case "bluetooth":
      return (
        <Input
          value={record.fields.address}
          onChange={(address) => onChange({ kind: "bluetooth", fields: { address } })}
          placeholder="AA:BB:CC:DD:EE:FF"
          aria-label="Bluetooth device address"
          disabled={disabled}
        />
      );
    case "mime":
      return (
        <div className="flex flex-col gap-2">
          <Input
            value={record.fields.type}
            onChange={(type) => onChange({ kind: "mime", fields: { ...record.fields, type } })}
            placeholder="text/plain"
            aria-label="MIME type"
            disabled={disabled}
          />
          <Input
            value={record.fields.payloadHex}
            onChange={(payloadHex) =>
              onChange({ kind: "mime", fields: { ...record.fields, payloadHex } })
            }
            placeholder="Payload bytes as hex, for example 48656C6C6F"
            aria-label="MIME payload as hex"
            disabled={disabled}
            className="font-mono"
          />
        </div>
      );
    case "external":
      return (
        <div className="flex flex-col gap-2">
          <Input
            value={record.fields.type}
            onChange={(type) => onChange({ kind: "external", fields: { ...record.fields, type } })}
            placeholder="example.com:door"
            aria-label="External type"
            disabled={disabled}
          />
          <Input
            value={record.fields.payloadHex}
            onChange={(payloadHex) =>
              onChange({ kind: "external", fields: { ...record.fields, payloadHex } })
            }
            placeholder="Payload bytes as hex"
            aria-label="External payload as hex"
            disabled={disabled}
            className="font-mono"
          />
        </div>
      );
    default:
      return (
        <p className="text-xs leading-relaxed text-err">
          This build cannot edit this Record, so it is kept exactly as it is.
        </p>
      );
  }
}

const WIFI_AUTH_CHOICES = [
  { value: "wpa2-personal", label: "WPA2-Personal" },
  { value: "wpa-personal", label: "WPA-Personal" },
  { value: "open", label: "Open" },
];

const WIFI_ENCRYPTION_CHOICES = [
  { value: "aes", label: "AES" },
  { value: "tkip", label: "TKIP" },
  { value: "none", label: "None" },
];

interface ChoiceProps {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

/** A native select, kept local because the Drafts page is its only user. */
function Choice({ label, value, options, onChange, disabled, className = "" }: ChoiceProps) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={`${INPUT_ROUNDING} cursor-pointer border border-border bg-surface px-3 py-2 text-sm text-text transition-colors focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
