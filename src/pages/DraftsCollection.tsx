import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Section } from "../components/Section";
import { LibraryProblemBanner } from "../components/LibraryProblemBanner";
import { MigrationWarning } from "../components/MigrationWarning";
import { RowDeleteConfirmation } from "../components/RowDeleteConfirmation";
import { WriteDraftToTag } from "../components/WriteDraftToTag";
import { useDraftsState } from "../components/DraftsProvider";
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
import type { Draft, DraftRecord, RecordKind, WifiAuth, WifiEncryption } from "../lib/drafts";

/** The label above a field, in the design system's voice. */
const LABEL = "text-[11px] uppercase tracking-[0.12em] text-text-muted";

/** The pane's frame: the right column, separated by a hairline rather than a box. */
const PANE = "flex min-w-0 flex-1 flex-col gap-4 md:border-l md:border-border md:pl-6";

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

/** How many Records a Draft holds, said the way the list row says it. */
function recordsCount(count: number): string {
  return `${count} ${count === 1 ? "Record" : "Records"}`;
}

/**
 * Drafts, as Library's second Collection.
 *
 * A Draft is an NDEF message under construction: a list of Records, in order,
 * belonging to no Tag. It is edited constantly, and a Snapshot is a record of a
 * read and is never edited, so the two Collections share a page and a layout
 * rather than a list.
 *
 * The layout is the one Snapshots uses, because sharing the page without sharing
 * the shape is how a user has to learn the page twice: the Draft list is the
 * left column, the open Draft's editor is the right one, and everything that
 * changes a Draft lives in the editor. That is the whole point of this slice —
 * editing a Draft used to put the Records editor below the list and below the
 * read-a-tag panel, so the thing the user came to edit was the third block down
 * the page. Nothing that changes a Draft is in the list any more.
 *
 * The panel that read a Tag's Records into a Draft used to live on this page.
 * Reading a 13.56 MHz Tag produces its message inline now, and turning that
 * message into a Draft is that readout's action (ticket 16), so the panel is
 * gone rather than moved: it existed to give Drafts a reading surface, and
 * Drafts has no business owning one.
 *
 * The queue and the close guard are not here. They belong to `DraftsProvider`,
 * above the navigation, because an edit made on this page is still pending when
 * the user has gone somewhere else and only the app's own close listener can
 * write it then.
 */
export function DraftsCollection({
  connected,
  openDraftId = null,
}: {
  connected: boolean;
  /**
   * The Draft a reading handed over, i.e. the one the pane opens on rather than
   * the first in the list. It is the Collection's arrival value, not a
   * selection: absent when the user reached this Collection with the switch,
   * where nothing has been chosen yet.
   */
  openDraftId?: string | null;
}) {
  const drafts = useDraftsState();
  // Leaving the Collection writes what is queued, exactly as leaving the old
  // Drafts page did: both are an unmount, and neither can wait for the reply.
  useEffect(() => () => void drafts.settle(), [drafts.settle]);
  // And a Draft written by another part of the app — an import adds them — is
  // picked up when the Collection is opened, rather than only at launch.
  useEffect(() => {
    void drafts.reload();
  }, [drafts.reload]);

  /**
   * Which Draft the pane is showing.
   *
   * `undefined` is "nobody has chosen": the first Draft opens on arrival, for the
   * same reason the first Snapshot does — a pane that starts empty spends half
   * the window saying nothing. `null` is "the choice was closed again", which is
   * what clicking the open Draft a second time does. A handoff from a reading is
   * the one arrival that starts on a named Draft instead of the first.
   */
  const [picked, setPicked] = useState<string | null | undefined>(openDraftId ?? undefined);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<RecordKind>("text");

  const list = drafts.drafts;
  const locked = drafts.problem !== null;
  const selectedId = picked === undefined ? (list[0]?.id ?? null) : picked;
  const selected = selectedId === null ? null : (list.find((draft) => draft.id === selectedId) ?? null);

  const choose = (id: string) => {
    setPicked(id === selectedId ? null : id);
  };

  const create = async () => {
    const draft = await drafts.create(newName);
    setNewName("");
    // The Draft just made is the one to work on, so it opens rather than being
    // appended to a list the user then has to find it in.
    if (draft) setPicked(draft.id);
  };

  const remove = (id: string) => {
    // The Draft that was open is gone, so the pane goes back to opening the
    // first one rather than pointing at something that no longer exists.
    setPicked(undefined);
    void drafts.remove(id);
  };

  return (
    <Section title="Drafts" hint={`${DRAFT_NOT_A_TAG_NOTICE} Changes are saved as you edit.`}>
      {drafts.migrationWarning && <MigrationWarning detail={drafts.migrationWarning} />}

      {drafts.problem && <LibraryProblemBanner problem={drafts.problem} />}

      {drafts.error && (
        <p className="mb-4 border-l-2 border-err bg-err/5 px-3 py-2 text-xs leading-relaxed text-err">
          {drafts.error}
        </p>
      )}

      {/* Naming a new Draft: one field and its button, in one row that fits the
          minimum window rather than a full-width input with a control wrapped
          under it. */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={newName}
          onChange={setNewName}
          onKeyDown={(e) => {
            if (e.key === "Enter") void create();
          }}
          placeholder="Name a new Draft, for example Front door"
          aria-label="Name of the new Draft"
          disabled={locked}
          className="sm:max-w-72"
        />
        <Button variant="secondary" onClick={() => void create()} disabled={locked}>
          <Plus size={14} />
          New Draft
        </Button>
      </div>

      {drafts.loading && <p className="text-sm text-text-muted">Reading Drafts…</p>}

      {!drafts.loading && list.length === 0 && !drafts.problem && (
        <div className="flex flex-col items-start gap-2 border border-dashed border-border px-4 py-6">
          <p className="font-heading text-sm text-text">{EMPTY_DRAFTS_TITLE}</p>
          <p className="max-w-prose text-sm leading-relaxed text-text-muted">{EMPTY_DRAFTS_DETAIL}</p>
        </div>
      )}

      {list.length > 0 && (
        <div data-layout="list-detail" className="flex flex-col gap-6 md:flex-row md:items-start">
          {/* The list scrolls on its own, so a long collection never stretches the
              page and never moves the editor out of reach. */}
          <ul
            role="list"
            aria-label="Drafts"
            className="flex max-h-[55vh] min-w-0 flex-col gap-0.5 overflow-y-auto overscroll-contain pr-1 md:w-56 md:shrink-0"
          >
            {list.map((draft) => {
              const isOpen = draft.id === selectedId;
              const name = draftTitle(draft);
              return (
                <li key={draft.id}>
                  <button
                    type="button"
                    aria-label={`${name} — ${recordsCount(draft.records.length)}`}
                    aria-pressed={isOpen}
                    onClick={() => choose(draft.id)}
                    className={`flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors ${
                      isOpen ? "bg-surface-raised" : "hover:bg-surface/60"
                    }`}
                  >
                    <span className="w-full max-w-full truncate text-sm text-text">{name}</span>
                    <span className="w-full max-w-full truncate text-[11px] text-text-muted">
                      {draftDetail(draft)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {selected ? (
            <DraftDetail
              // Keyed by the Draft: opening another one starts from a fresh
              // confirmation and a fresh write report, never the last one's.
              key={selected.id}
              draft={selected}
              connected={connected}
              locked={locked}
              newKind={newKind}
              onNewKind={setNewKind}
              onRename={(name) => drafts.rename(selected.id, name)}
              onRecords={(records) => drafts.setRecords(selected.id, records)}
              onDelete={() => remove(selected.id)}
            />
          ) : (
            <section role="region" aria-label="Draft detail" className={PANE}>
              <p className="text-sm text-text">Nothing selected</p>
              <p className="mt-1 max-w-prose text-xs leading-relaxed text-text-muted">
                Choose a Draft from the list to edit its Records, or to write it to a tag.
              </p>
            </section>
          )}
        </div>
      )}
    </Section>
  );
}

interface DraftDetailProps {
  /** The Draft the pane is showing. Changing it remounts the pane. */
  draft: Draft;
  connected: boolean;
  /** The library file cannot be written, so nothing that writes to it may run. */
  locked: boolean;
  /** The Record kind the add control will insert next. */
  newKind: RecordKind;
  onNewKind: (kind: RecordKind) => void;
  onRename: (name: string) => void;
  onRecords: (records: DraftRecord[]) => void;
  onDelete: () => void;
}

/**
 * The Draft the list has open, and everything that changes it.
 *
 * The pane is one Draft at a time and is remounted when the id changes, so a
 * pending delete confirmation or a write report can never carry over onto the
 * next Draft. Its fields are the stored Draft itself: a Draft is saved as it is
 * edited, which is why there is no Save button here (and why the page says so).
 */
function DraftDetail({
  draft,
  connected,
  locked,
  newKind,
  onNewKind,
  onRename,
  onRecords,
  onDelete,
}: DraftDetailProps) {
  // Deleting is permanent, so it takes a second, deliberate click. A Draft was
  // authored here and never lived on a Tag, so nothing can read it back.
  const [confirming, setConfirming] = useState(false);

  const name = draftTitle(draft);
  const total = draftSize(draft);

  if (confirming) {
    return (
      <section role="region" aria-label="Draft detail" className={PANE}>
        <RowDeleteConfirmation
          name={name}
          onConfirm={() => {
            setConfirming(false);
            onDelete();
          }}
          onDismiss={() => setConfirming(false)}
        >
          A Draft was written here and never lived on a Tag, so there is no copy to read back. This
          removes it from the library file and no copy is kept.
        </RowDeleteConfirmation>
      </section>
    );
  }

  return (
    <section role="region" aria-label="Draft detail" className={PANE}>
      <div className="flex items-end justify-between gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={LABEL}>Name</span>
          <Input
            value={draft.name}
            onChange={onRename}
            placeholder={draft.id}
            aria-label={`Name for ${name}`}
            disabled={locked}
          />
        </label>
        <Button
          variant="danger"
          aria-label={`Delete ${name}`}
          title={locked ? "The library file cannot be written to" : "Delete"}
          disabled={locked}
          onClick={() => setConfirming(true)}
        >
          Delete
        </Button>
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className={LABEL}>Records</span>
            <span className="font-mono text-[11px] text-text-muted">
              {recordsCount(draft.records.length)} ·{" "}
              {total === null
                ? "total unavailable"
                : `${total} ${total === 1 ? "byte" : "bytes"}`}
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-text-muted">
            {total === null
              ? "The total is unavailable until the Record with a problem is fixed."
              : capacityNote(total, null)}
          </p>
        </div>

        {draft.records.length === 0 && (
          <div className="flex flex-col gap-1">
            <p className="font-heading text-sm text-text">{EMPTY_DRAFT_TITLE}</p>
            <p className="max-w-prose text-xs leading-relaxed text-text-muted">
              {EMPTY_DRAFT_DETAIL}
            </p>
          </div>
        )}

        {draft.records.length > 0 && (
          <ul aria-label="Records in this Draft" className="flex flex-col divide-y divide-border">
            {draft.records.map((record, index) => (
              <RecordRow
                key={index}
                record={record}
                position={index}
                total={draft.records.length}
                disabled={locked}
                onChange={(next) => {
                  const records = draft.records.slice();
                  records[index] = next;
                  onRecords(records);
                }}
                onMove={(to) => {
                  if (to < 0 || to >= draft.records.length) return;
                  const records = draft.records.slice();
                  const [moved] = records.splice(index, 1);
                  if (!moved) return;
                  records.splice(to, 0, moved);
                  onRecords(records);
                }}
                onDelete={() => {
                  onRecords(draft.records.filter((_, at) => at !== index));
                }}
              />
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Select
            label="Record type to add"
            value={newKind}
            options={RECORD_KINDS.map((kind) => ({
              value: kind,
              label: RECORD_KIND_LABELS[kind],
            }))}
            onChange={(value) => onNewKind(value as RecordKind)}
            disabled={locked}
            className="max-w-44"
          />
          <Button
            variant="secondary"
            disabled={locked}
            onClick={() => onRecords([...draft.records, newRecord(newKind)])}
          >
            <Plus size={14} />
            Add Record
          </Button>
        </div>
      </div>

      {/* The one way out: the whole message, written to a 13.56 MHz Tag, with its
          own confirmation and read-back. Unchanged by this slice — it moved into
          this pane and nothing else about it did. */}
      <WriteDraftToTag records={draft.records} connected={connected} />
    </section>
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

/**
 * One Record in the queue, edited in place.
 *
 * A Record that cannot be encoded says so here, in its own words, and stays
 * where it is: an invalid Record is a condition of this Draft, not an event that
 * just happened, so it is never a toast and never removes the field the user is
 * typing in.
 */
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
          <span className={LABEL}>{recordKindLabel(record)}</span>
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
          type="button"
          aria-label="Move up"
          title="Move up"
          disabled={position === 0 || disabled}
          onClick={() => onMove(position - 1)}
          className="cursor-pointer rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-raised hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronUp size={13} />
        </button>
        <button
          type="button"
          aria-label="Move down"
          title="Move down"
          disabled={position === total - 1 || disabled}
          onClick={() => onMove(position + 1)}
          className="cursor-pointer rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-raised hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronDown size={13} />
        </button>
        <button
          type="button"
          aria-label="Delete Record"
          title="Delete Record"
          disabled={disabled}
          onClick={onDelete}
          className="cursor-pointer rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-raised hover:text-err disabled:cursor-not-allowed disabled:opacity-40"
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
            <Select
              label="Wi-Fi authentication"
              value={record.fields.auth}
              options={WIFI_AUTH_CHOICES}
              onChange={(auth) =>
                onChange({ kind: "wifi", fields: { ...record.fields, auth: auth as WifiAuth } })
              }
              disabled={disabled}
            />
            <Select
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
