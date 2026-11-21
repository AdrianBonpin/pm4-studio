import { useCallback, useState } from "react";
import { BookmarkPlus, Check } from "lucide-react";
import { Button } from "../components/ui/Button";
import { BlankTag } from "../components/BlankTag";
import { CloneWizard } from "../components/CloneWizard";
import { Field, Readout, Section } from "../components/Section";
import { useLfPoller } from "../hooks/useReader";
import { hex } from "../lib/library";
import type { LibraryState } from "../hooks/useLibrary";
import type { LfCard } from "../types";

interface LfPageProps {
  connected: boolean;
  onChirp: () => void;
  /** Snapshots live in a file, so saving is a call into the Rust store. */
  library: LibraryState;
  /** Surfaces a dead or wedged Reader in the shell's notice strip. */
  onDeviceError?: (message: string) => void;
}

export function LfPage({ connected, onChirp, library, onDeviceError }: LfPageProps) {
  const [reading, setReading] = useState(false);
  const [current, setCurrent] = useState<LfCard | null>(null);
  /** What the last save said, so a repeat read does not look like silence. */
  const [saveNote, setSaveNote] = useState<SaveNote | null>(null);

  useLfPoller(
    reading,
    connected,
    (card) => {
      setCurrent(card);
      setReading(false);
      onChirp();
    },
    onDeviceError,
  );

  const save = useCallback(
    async (card: LfCard) => {
      const result = await library.saveLf(card);
      if (!result) {
        setSaveNote({
          tone: "err",
          text: library.error ?? "The read could not be saved to the library.",
        });
        return;
      }
      const name = result.snapshot ? result.snapshot.name : card.id;
      if (result.outcome === "duplicate") {
        setSaveNote({ tone: "muted", text: `Already in the library as ${name}.` });
      } else if (result.outcome === "refused") {
        setSaveNote({
          tone: "err",
          text: result.library.problem?.message ?? "The library could not be saved.",
        });
      } else {
        setSaveNote({ tone: "ok", text: `Saved to the library as ${name}.` });
      }
    },
    [library],
  );

  return (
    <div className="flex flex-col gap-8">
      <Section
        title="Clone a tag"
        hint="Guided copy from an original tag onto a Blank, with a verified read-back."
      >
        <CloneWizard
          connected={connected}
          onChirp={onChirp}
          onSaved={save}
          onDeviceError={onDeviceError}
        />
        <SaveNoteLine note={saveNote} />
      </Section>

      <Section
        title="Read a tag"
        hint="Inspect whatever 125 kHz Tag is on the Reader."
        actions={
          <Button
            variant={reading ? "secondary" : "primary"}
            disabled={!connected}
            onClick={() => setReading((v) => !v)}
          >
            {reading ? "Stop" : "Read tag"}
          </Button>
        }
      >
        {current ? (
          <div className="flex flex-col gap-4">
            <Readout value={current.id} />
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              <Field label="Facility / card" value={`${current.facility} / ${current.card}`} />
              <Field label="data32" value={`0x${hex(current.data32, 8)}`} />
              <Field label="Customer" value={`0x${hex(current.customer, 2)}`} />
              <Field label="Kind" value="EM4100" tone="muted" />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" onClick={() => void save(current)}>
                <BookmarkPlus size={13} /> Save to library
              </Button>
              <SaveNoteLine note={saveNote} />
            </div>
            <details>
              <summary className="cursor-pointer text-[11px] uppercase tracking-[0.12em] text-text-muted hover:text-text">
                Raw payload
              </summary>
              <code className="mt-2 block select-text break-all rounded-lg border border-border bg-canvas px-3 py-2 font-mono text-xs leading-relaxed text-accent-muted">
                {current.raw}
              </code>
            </details>
          </div>
        ) : (
          <Readout placeholder={reading ? "Listening for a tag…" : "No tag read yet."} />
        )}
      </Section>

      <Section
        title="Library"
        hint="Every saved read is a Snapshot: kept in a file, browsable with no Reader attached."
      >
        <p className="text-sm leading-relaxed text-text-muted">
          Open <span className="text-text">Library</span> in the sidebar to rename, delete, or
          write a Snapshot back to a Blank.
        </p>
      </Section>

      <BlankTag connected={connected} onChirp={onChirp} onDeviceError={onDeviceError} />
    </div>
  );
}

type SaveNote = { tone: "ok" | "muted" | "err"; text: string };

const NOTE_TONE = {
  ok: "text-ok",
  muted: "text-text-muted",
  err: "text-err",
} as const;

/** What a save did. A refusal is a fault; a duplicate is merely a repeat. */
function SaveNoteLine({ note }: { note: SaveNote | null }) {
  if (!note) return null;
  return (
    <p className={`mt-3 flex items-center gap-1 text-xs ${NOTE_TONE[note.tone]}`}>
      {note.tone === "ok" && <Check size={12} />}
      {note.text}
    </p>
  );
}
