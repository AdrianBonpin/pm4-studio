import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BookmarkPlus, Check, Copy, Pencil, Trash2, X } from "lucide-react";
import { Button } from "../components/ui/Button";
import { CloneWizard } from "../components/CloneWizard";
import { Field, Readout, Section } from "../components/Section";
import { useLfPoller } from "../hooks/useReader";
import { describeDeviceFailure } from "../lib/readerIdentity";
import {
  formatSavedAt,
  hex,
  loadSavedTags,
  nextDefaultName,
  persistSavedTags,
} from "../lib/storage";
import type { SavedTag } from "../lib/storage";
import type { LfCard, WriteResult } from "../types";

interface LfPageProps {
  connected: boolean;
  onChirp: () => void;
  /** Surfaces a dead or wedged Reader in the shell's notice strip. */
  onDeviceError?: (message: string) => void;
}

export function LfPage({ connected, onChirp, onDeviceError }: LfPageProps) {
  const [reading, setReading] = useState(false);
  const [current, setCurrent] = useState<LfCard | null>(null);
  const [saved, setSaved] = useState<SavedTag[]>(() => loadSavedTags());

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [target, setTarget] = useState<SavedTag | null>(null);
  const [writeBusy, setWriteBusy] = useState(false);
  const [writeResult, setWriteResult] = useState<WriteResult | null>(null);
  const [writeErr, setWriteErr] = useState<string | null>(null);

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

  const commit = (next: SavedTag[]) => {
    setSaved(next);
    persistSavedTags(next);
  };

  const save = useCallback(
    (card: LfCard) => {
      if (saved.some((t) => t.id === card.id)) return;
      commit([
        {
          id: card.id,
          customer: card.customer,
          data32: card.data32,
          name: nextDefaultName(saved),
          savedAt: new Date().toISOString(),
        },
        ...saved,
      ]);
    },
    [saved],
  );

  const rename = (id: string, name: string) => {
    commit(saved.map((t) => (t.id === id ? { ...t, name: name.trim() } : t)));
    setEditingId(null);
  };

  const remove = (id: string) => {
    commit(saved.filter((t) => t.id !== id));
    if (target?.id === id) setTarget(null);
  };

  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1200);
    } catch {
      // Clipboard can be unavailable; the id is visible anyway.
    }
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
      // A wedged firmware is reported with its remedy, not as a bare timeout.
      setWriteErr(describeDeviceFailure(e));
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
        <CloneWizard
          connected={connected}
          onChirp={onChirp}
          onSaved={save}
          onDeviceError={onDeviceError}
        />
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
        hint={
          saved.length === 0
            ? "Saved reads you can write to blanks later."
            : `${saved.length} saved ${saved.length === 1 ? "badge" : "badges"} — click a name to rename.`
        }
      >
        {saved.length === 0 ? (
          <div className="flex flex-col items-start gap-3 border border-dashed border-border px-4 py-6">
            <p className="text-sm text-text-muted">
              Nothing saved yet. Read a badge, then choose <span className="text-text">Save to library</span>.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {saved.map((t) => {
              const editing = editingId === t.id;
              const selected = target?.id === t.id;
              return (
                <li
                  key={t.id}
                  className={`flex items-start justify-between gap-4 py-3 first:pt-0 ${
                    selected ? "bg-surface/40" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    {editing ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          autoFocus
                          value={draftName}
                          onChange={(e) => setDraftName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") rename(t.id, draftName);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          onBlur={() => rename(t.id, draftName)}
                          placeholder={t.id}
                          className="w-full max-w-64 rounded-md border border-accent bg-canvas px-2 py-1 text-sm text-text outline-none"
                        />
                        <button
                          aria-label="Save name"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => rename(t.id, draftName)}
                          className="cursor-pointer text-ok"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          aria-label="Cancel rename"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => setEditingId(null)}
                          className="cursor-pointer text-text-muted hover:text-text"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setEditingId(t.id);
                          setDraftName(t.name);
                        }}
                        aria-label={`Rename ${t.name || t.id}`}
                        title="Rename"
                        className="-mx-1 flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-surface-raised"
                      >
                        <span className="truncate text-sm text-text">{t.name || t.id}</span>
                        <Pencil size={11} className="shrink-0 text-text-muted" />
                      </button>
                    )}

                    <p className="mt-1 font-mono text-xs text-accent-muted">{t.id}</p>
                    <p className="mt-0.5 text-[11px] text-text-muted">
                      facility {(t.data32 >> 16) & 0xff} · card {t.data32 & 0xffff} ·{" "}
                      {formatSavedAt(t.savedAt)}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      aria-label={`Copy ${t.id}`}
                      title="Copy id"
                      onClick={() => void copyId(t.id)}
                      className="cursor-pointer rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-raised hover:text-text"
                    >
                      {copiedId === t.id ? <Check size={13} className="text-ok" /> : <Copy size={13} />}
                    </button>
                    <button
                      aria-label={`Delete ${t.name || t.id}`}
                      title="Delete"
                      onClick={() => remove(t.id)}
                      className="cursor-pointer rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-raised hover:text-err"
                    >
                      <Trash2 size={13} />
                    </button>
                    <Button
                      variant={selected ? "primary" : "secondary"}
                      onClick={() => {
                        setTarget(selected ? null : t);
                        setWriteResult(null);
                        setWriteErr(null);
                      }}
                    >
                      {selected ? "Selected" : "Write"}
                    </Button>
                  </div>
                </li>
              );
            })}
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
              <Button
                variant="primary"
                disabled={!connected || writeBusy}
                onClick={() => void writeSaved()}
              >
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
