import { useState } from "react";
import { MemoryDumpPanel } from "../components/MemoryDumpPanel";
import { PasswordProtection } from "../components/PasswordProtection";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Field, Readout, Section } from "../components/Section";
import {
  HF_POLL_LAYOUT,
  decodeHfPayload,
  hexBytes,
  type HfRawOnlyReason,
  type HfReading,
} from "../lib/hfDecoder";
import type { HfCard } from "../types";

interface HfPageProps {
  connected: boolean;
  onPoll: () => Promise<HfCard | null>;
  onChirp: () => void;
}

/** Amber is the "not confirmed" tone, the same one the shell uses for a Reader
 *  that answered but did not behave. */
const PROVISIONAL_COLOR = "#FBBF24";

/** Short label per fallback reason. The sentence under it says what happened. */
const REASON_LABEL: Record<HfRawOnlyReason, string> = {
  "invalid-bytes": "unreadable reply",
  "unexpected-length": "unexpected length",
  "not-latched": "nothing latched",
  "empty-uid": "no UID in reply",
  "unsupported-uid-width": "UID too wide",
  "unknown-card-type": "unknown card type",
};

/** Half-open byte range as it reads in prose: `[2, 6]` → "2–5". */
function span(range: readonly [number, number]): string {
  return `${range[0]}–${range[1] - 1}`;
}

/**
 * The raw payload. Shown for every reading — decoded, raw-only or empty — because
 * the decode is provisional and the bytes are the only certain record of what the
 * Reader said.
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

/** One resolved reading: provisional, and labelled as such. */
function DecodedReadout({ reading }: { reading: Extract<HfReading, { state: "decoded" }> }) {
  const { cardType, ndef } = reading;
  const capacity =
    cardType.capacityBytes === null ? "not determined" : `${cardType.capacityBytes} bytes`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Readout value={reading.uid} />
        {reading.provisional && (
          <Badge label="provisional" color={PROVISIONAL_COLOR} />
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Field label="Card type" value={cardType.family} />
        <Field
          label="Capacity"
          value={capacity}
          tone={cardType.capacityBytes === null ? "muted" : "default"}
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
        <Field label="NDEF formatted" value="not determinable" tone="muted" />
      </div>

      {cardType.variants.length > 1 && (
        <p className="text-xs leading-relaxed text-text-muted">
          This pair covers several chips: {cardType.variants.join(", ")}.
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
        <Badge label={REASON_LABEL[reading.reason]} color={PROVISIONAL_COLOR} />
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
          <DecodedReadout reading={reading} />
        ) : (
          <RawOnlyReadout reading={reading} />
        )}
      </Section>

      <MemoryDumpPanel connected={connected} />

      <PasswordProtection connected={connected} />

      <Section
        title="Why the decode is provisional"
        hint="The reply layout has no capture behind it yet."
      >
        <div className="flex flex-col gap-3">
          <div className="border-l-2 border-warn bg-warn/5 px-3 py-2">
            <p className="text-sm text-warn">Offsets unconfirmed</p>
            <p className="mt-0.5 max-w-prose text-xs leading-relaxed text-text-muted">
              The poll reply layout — validity at byte {HF_POLL_LAYOUT.validity}, UID at bytes{" "}
              {span(HF_POLL_LAYOUT.uid)}, ATQA at bytes {span(HF_POLL_LAYOUT.atqa)}, SAK at byte{" "}
              {HF_POLL_LAYOUT.sak} — comes from third-party client source. It has never been
              checked against a capture from this Reader. Card type, capacity and technologies
              are therefore labelled provisional, and the raw bytes are the only certain part of
              a reading.
            </p>
          </div>
          <p className="max-w-prose text-sm leading-relaxed text-text-muted">
            Nothing is filled in to make a reading look complete. A reply of the wrong length, an
            ATQA/SAK pair that no published table assigns, or a UID field that cannot hold the
            announced UID all fall back to raw bytes with the reason shown — no family, no
            capacity, no UID split.
          </p>
          <p className="max-w-prose text-sm leading-relaxed text-text-muted">
            To verify by hand, poll a tag and send{" "}
            <span className="font-mono text-accent-muted">0x0069</span> from{" "}
            <span className="text-text">Tools</span>: the payload there is what this page decodes.
          </p>
        </div>
      </Section>
    </div>
  );
}
