import { useCallback, useState } from "react";
import { ScanLine } from "lucide-react";
import { Button } from "./ui/Button";
import { Section } from "./Section";
import { BatchClone } from "./BatchClone";
import { useLfPoller } from "../hooks/useReader";
import { outcomes, report } from "../lib/outcome";
import type { LfCard } from "../types";

interface BatchModeProps {
  connected: boolean;
  /** Surfaces a dead or wedged Reader in the shell's notice strip. */
  onDeviceError?: (message: string) => void;
}

/**
 * Batch: one Identity, many Blanks.
 *
 * Batch is its own operation on the page rather than a corner of the Clone
 * wizard, because it is something a user sets out to do — make a fob for each of
 * five people — rather than something discovered halfway through one clone. It
 * still begins with the same thing every write path begins with: a read of the
 * original, taken once, before anything is written. That read is the operation
 * the user started, so it reports itself: one reading, one outcome, one signal.
 * The polling underneath it reports nothing.
 *
 * From that reading on this is `BatchClone` and nothing else. Keeping the split
 * here rather than inside the wizard means the wizard's own flow, its callbacks
 * and the run's attempt-by-attempt reporting are untouched by the page's new
 * shape — the mode only supplies what to write.
 */
export function BatchMode({ connected, onDeviceError }: BatchModeProps) {
  /** The original, read once. Everything until a new run is started from this. */
  const [source, setSource] = useState<LfCard | null>(null);
  /** True while waiting for the original to be tapped. */
  const [awaiting, setAwaiting] = useState(false);

  useLfPoller(
    awaiting,
    connected,
    (card) => {
      setSource(card);
      setAwaiting(false);
      report(outcomes.cloneSourceRead(card.id));
    },
    onDeviceError,
  );

  // Back to the start of the mode, which is also where the run's finish button
  // lands: a batch ends by asking for a different original, not by staying on the
  // last one.
  const startOver = useCallback(() => {
    setSource(null);
    setAwaiting(false);
  }, []);

  return (
    <Section
      title="Batch clone"
      hint="Read the original once, then write that Identity to one Blank per attempt."
    >
      {source ? (
        <BatchClone
          source={source}
          connected={connected}
          onExit={startOver}
        />
      ) : awaiting ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-muted">
            Tap the tag you want to copy on the reader, flat and centred.
          </p>
          <div>
            <Button variant="ghost" onClick={startOver}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="max-w-prose text-sm leading-relaxed text-text-muted">
            The original is read once and held. Every attempt after that writes the Identity it
            carried, so it never has to be tapped again — one Blank on the reader per recipient,
            with each attempt reported on its own.
          </p>
          <div>
            <Button variant="primary" disabled={!connected} onClick={() => setAwaiting(true)}>
              <ScanLine size={13} /> Read the tag to copy
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}
