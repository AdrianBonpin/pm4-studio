import { useState } from "react";
import { EraseNdef } from "../components/EraseNdef";
import { MemoryDumpPanel } from "../components/MemoryDumpPanel";
import { PasswordProtection } from "../components/PasswordProtection";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Field, Readout, Section } from "../components/Section";
import { variantsNote } from "../lib/cardType";
import {
  decodeHfPayload,
  hexBytes,
  capacityForReading,
  ndefField,
  ndefStatusFor,
  uidMatchesMemory,
  type HfRawOnlyReason,
  type HfReading,
} from "../lib/hfDecoder";
import type { TagRecordsRead } from "../lib/tagRecords";
import type { HfCard } from "../types";

interface HfPageProps {
  connected: boolean;
  onPoll: () => Promise<HfCard | null>;
  onChirp: () => void;
}

/** Short label per fallback reason. The sentence under it says what happened. */
const REASON_LABEL: Record<HfRawOnlyReason, string> = {
  "invalid-bytes": "unreadable reply",
  "unexpected-length": "unexpected length",
  "not-latched": "nothing latched",
  "empty-uid": "no UID in reply",
  "unsupported-uid-width": "unexpected UID length",
  "unknown-card-type": "unknown card type",
};

/**
 * The raw payload. Shown for every reading — decoded, raw-only or empty — because
 * the bytes are the record of what the Reader actually said.
 */
function RawPayload({ raw }: { raw: string }) {
  const bytes = raw === "" ? 0 : raw.split(" ").length;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] uppercase tracking-[0.12em] text-text-muted">
          Raw payload
        </span>
        <span className="font-mono text-[11px] text-text-muted">
          {bytes} {bytes === 1 ? "byte" : "bytes"}
        </span>
      </div>
      <code className="block select-text break-all rounded-lg border border-border bg-canvas px-3 py-2 font-mono text-xs leading-relaxed text-accent-muted">
        {raw === "" ? "(empty payload)" : raw}
      </code>
    </div>
  );
}

/** One resolved reading: the card type its ATQA/SAK pair identifies. */
function DecodedReadout({
  reading,
  memory,
}: {
  reading: Extract<HfReading, { state: "decoded" }>;
  /** The last memory read on this page, when it describes this Tag. */
  memory: TagRecordsRead | null;
}) {
  const { cardType } = reading;
  // The published table gives capacity for a fixed-size family; the families it
  // withholds it for get it from the Capability Container of the memory read
  // above, which is the same read that settles NDEF. "not determined" is only
  // shown when neither has produced a number.
  const capacityBytes = capacityForReading(cardType, memory);
  const capacity = capacityBytes === null ? "not determined" : `${capacityBytes} bytes`;
  // The poll cannot say whether the Tag is NDEF formatted; a memory read of the
  // same Tag can. Without one the row is omitted rather than greyed out.
  const ndef = ndefStatusFor(memory?.ndef.outcome ?? null);
  const ndefRow = ndefField(ndef);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Readout value={reading.uid} />
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Field label="Card type" value={cardType.family} />
        <Field
          label="Capacity"
          value={capacity}
          tone={capacityBytes === null ? "muted" : "default"}
        />
        <Field label="ATQA" value={hexBytes(reading.atqa)} />
        <Field label="SAK" value={hexBytes([reading.sak])} />
        <div className="col-span-2 sm:col-span-4">
          <Field label="Technologies" value={cardType.technologies.join("  ·  ")} />
        </div>
        <Field
          label="NFC Forum type"
          value={cardType.nfcForumTagType === null ? "none" : `Type ${cardType.nfcForumTagType}`}
          tone={cardType.nfcForumTagType === null ? "muted" : "default"}
        />
        {ndefRow && <Field label={ndefRow.label} value={ndefRow.value} />}
      </div>

      {cardType.variants.length > 1 && (
        <p className="text-xs leading-relaxed text-text-muted">
          {variantsNote(cardType.variants)}
        </p>
      )}

      <p className="text-xs leading-relaxed text-text-muted">{ndef.note}</p>

      <RawPayload raw={reading.raw} />
    </div>
  );
}

/** A reply that could not be decoded: the bytes and the reason, no fields. */
function RawOnlyReadout({ reading }: { reading: Extract<HfReading, { state: "raw" }> }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-text-muted">Not decoded</span>
        <Badge label={REASON_LABEL[reading.reason]} tone="warn" />
      </div>
      <p className="max-w-prose text-sm leading-relaxed text-text-muted">{reading.detail}</p>
      <RawPayload raw={reading.raw} />
    </div>
  );
}

export function HfPage({ connected, onPoll, onChirp }: HfPageProps) {
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState<HfReading | null>(null);
  const [polled, setPolled] = useState(false);
  /** The last memory read on this page. Owned here because the reading above
   *  uses it: a memory read of the same Tag is what settles its NDEF status. */
  const [memory, setMemory] = useState<TagRecordsRead | null>(null);

  const poll = async () => {
    setBusy(true);
    const card = await onPoll();
    setPolled(true);
    // A null card means the Reader latched nothing, which is not a decode
    // result; anything else is decoded, including replies of the wrong shape.
    setReading(card ? decodeHfPayload(card.payload) : null);
    if (card) onChirp();
    setBusy(false);
  };

  // A memory read describes one Tag. Applying it to a reading of a different Tag
  // would put one tag's formatting on another tag's row, so it is matched by UID
  // and dropped when it does not describe the reading above it.
  const readingUid = reading?.state === "decoded" ? reading.uid : "";
  const memoryForReading =
    memory && uidMatchesMemory(readingUid, memory.dump.tag.uid) ? memory : null;

  return (
    <div className="flex flex-col gap-8">
      <Section
        title="Read a tag"
        hint="13.56 MHz ISO14443-A. Single poll of the field."
        actions={
          <Button variant="primary" disabled={!connected || busy} onClick={() => void poll()}>
            {busy ? "Polling…" : "Poll tag"}
          </Button>
        }
      >
        {reading === null ? (
          <Readout placeholder={polled ? "No tag in the field." : "No tag polled yet."} />
        ) : reading.state === "decoded" ? (
          <DecodedReadout reading={reading} memory={memoryForReading} />
        ) : (
          <RawOnlyReadout reading={reading} />
        )}
      </Section>

      <MemoryDumpPanel connected={connected} read={memory} onRead={setMemory} />

      <PasswordProtection connected={connected} />

      <EraseNdef connected={connected} />
    </div>
  );
}
