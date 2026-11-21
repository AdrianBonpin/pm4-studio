import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BookmarkPlus, Trash2 } from "lucide-react";
import { Button } from "../components/ui/Button";
import { CloneWizard } from "../components/CloneWizard";
import { Field, Readout, Section } from "../components/Section";
import { useLfPoller } from "../hooks/useReader";
import { hex, loadSavedTags, persistSavedTags } from "../lib/storage";
import type { SavedTag } from "../lib/storage";
import type { LfCard, WriteResult } from "../types";

interface LfPageProps {
  connected: boolean;
  onChirp: () => void;
}

export function LfPage({ connected, onChirp }: LfPageProps) {
  const [reading, setReading] = useState(false);
  const [current, setCurrent] = useState<LfCard | null>(null);
  const [saved, setSaved] = useState<SavedTag[]>(() => loadSavedTags());

  const [target, setTarget] = useState<SavedTag | null>(null);
  const [writeBusy, setWriteBusy] = useState(false);
  const [writeResult, setWriteResult] = useState<WriteResult | null>(null);
  const [writeErr, setWriteErr] = useState<string | null>(null);

  useLfPoller(reading, connected, (card) => {
    setCurrent(card);
    setReading(false);
    onChirp();
  });

  const save = useCallback(
    (card: LfCard) => {
      if (saved.some((t) => t.id === card.id)) return;
      const next: SavedTag[] = [
        {
          id: card.id,
          customer: card.customer,
          data32: card.data32,
          note: `facility ${card.facility} · card ${card.card}`,
          savedAt: new Date().toISOString(),
        },
        ...saved,
      ];
      setSaved(next);
      persistSavedTags(next);
    },
    [saved],
  );

  const remove = (id: string) => {
    const next = saved.filter((t) => t.id !== id);
    setSaved(next);
    persistSavedTags(next);
    if (target?.id === id) setTarget(null);
  };

  const writeSaved = async () => {
    if (!target) return;
    setWriteBusy(true);
    setWriteErr(null);
    setWriteResult(null);
    try {
      const res = await invoke<WriteResult>("lf_write", {
        customer: target.customer,
        data32: target.data32,
      });
      setWriteResult(res);
      if (res.verified) onChirp();
      else setWriteErr("Write sent, but the tag did not read back the expected id.");
    } catch (e) {
      setWriteErr(String(e));
    } finally {
      setWriteBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <Section
        title="Clone a badge"
        hint="Guided copy from an original badge onto a blank tag, with a verified read-back."
      >
        <CloneWizard connected={connected} onChirp={onChirp} onSaved={save} />
      </Section>

      <Section
        title="Read a badge"
        hint="Inspect whatever 125 kHz tag is on the reader."
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
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => save(current)}>
                <BookmarkPlus size={13} /> Save to library
              </Button>
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
        hint="Saved reads you can write to blanks later."
        actions={<span className="font-mono text-xs text-text-muted">{saved.length}</span>}
      >
        {saved.length === 0 ? (
          <p className="text-sm text-text-muted">Nothing saved yet. Read a badge and save it.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {saved.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-4 py-3 first:pt-0">
                <div className="min-w-0">
                  <p className="font-mono text-sm text-text">{t.id}</p>
                  <p className="text-[11px] text-text-muted">{t.note}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant={target?.id === t.id ? "primary" : "secondary"}
                    onClick={() => {
                      setTarget(target?.id === t.id ? null : t);
                      setWriteResult(null);
                      setWriteErr(null);
                    }}
                  >
                    {target?.id === t.id ? "Selected" : "Write"}
                  </Button>
                  <button
                    aria-label={`Delete ${t.id}`}
                    onClick={() => remove(t.id)}
                    className="cursor-pointer text-text-muted transition-colors hover:text-err"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {target && (
          <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
            <p className="text-xs leading-relaxed text-text-muted">
              Writing <span className="font-mono text-text">{target.id}</span>. Put a{" "}
              <strong className="text-text">blank</strong> tag on the reader — not the original.
              The write is permanent.
            </p>
            <div className="flex gap-2">
              <Button variant="primary" disabled={!connected || writeBusy} onClick={() => void writeSaved()}>
                {writeBusy ? "Writing…" : "Write to tag"}
              </Button>
              <Button variant="ghost" disabled={writeBusy} onClick={() => setTarget(null)}>
                Cancel
              </Button>
            </div>
            {writeErr && <p className="text-xs text-err">{writeErr}</p>}
            {writeResult?.verified && (
              <p className="text-xs text-ok">
                Verified — the tag now reads {writeResult.readback?.id}.
              </p>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
