import { useState } from "react";
import { Button } from "../components/ui/Button";
import { Field, Readout, Section } from "../components/Section";
import type { HfCard } from "../types";

interface HfPageProps {
  connected: boolean;
  onPoll: () => Promise<HfCard | null>;
  onChirp: () => void;
}

export function HfPage({ connected, onPoll, onChirp }: HfPageProps) {
  const [busy, setBusy] = useState(false);
  const [card, setCard] = useState<HfCard | null>(null);
  const [empty, setEmpty] = useState(false);

  const poll = async () => {
    setBusy(true);
    setEmpty(false);
    const c = await onPoll();
    setCard(c);
    setEmpty(!c);
    if (c) onChirp();
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
        {card ? (
          <div className="flex flex-col gap-4">
            <Readout value={card.uid} />
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              <Field label="UID" value={card.uid} />
              <Field label="Frequency" value="13.56 MHz" tone="muted" />
              <Field label="Standard" value="ISO14443-A" tone="muted" />
              <Field label="Kind" value="Type A" tone="muted" />
            </div>
            <details>
              <summary className="cursor-pointer text-[11px] uppercase tracking-[0.12em] text-text-muted hover:text-text">
                Raw payload
              </summary>
              <code className="mt-2 block select-text break-all rounded-lg border border-border bg-canvas px-3 py-2 font-mono text-xs leading-relaxed text-accent-muted">
                {card.raw}
              </code>
            </details>
          </div>
        ) : (
          <Readout placeholder={empty ? "No tag in the field." : "No tag polled yet."} />
        )}
      </Section>

      <Section title="Not decoded yet" hint="ATQA, SAK and card type need real capture data.">
        <p className="text-sm leading-relaxed text-text-muted">
          The poll reply carries ATQA and SAK, which identify the card family — MIFARE Classic,
          Ultralight, NTAG, DESFire. Their byte offsets have not been confirmed against a real
          13.56 MHz card yet, so this app reports the UID only rather than guess and show wrong
          values.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-text-muted">
          Poll a card, then open <span className="text-text">Tools → Raw console</span> and send{" "}
          <span className="font-mono text-accent-muted">0x0069</span> to see the full payload.
        </p>
      </Section>
    </div>
  );
}
