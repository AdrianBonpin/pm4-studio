import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "../components/ui/Button";
import { Notice } from "../components/ui/Notice";
import { Segmented, type SegmentedOption } from "../components/ui/Segmented";
import { ClearSavedData } from "../components/ClearSavedData";
import { ReaderLimits } from "../components/ReaderLimits";
import { Field, Section } from "../components/Section";
import { useToastCorner } from "../hooks/useToastCorner";
import { APP_VERSION, CREDITS, CREDITS_NOTE, LICENCE, REPOSITORY_URL } from "../lib/appInfo";
import { LIBRARY_PLAINTEXT_NOTICE } from "../lib/library";
import {
  describeExport,
  describeImportApplied,
  describeImportPreview,
  nothingToAdd,
  suggestedExportName,
  type ImportPreview,
} from "../lib/libraryFiles";
import { outcomes, report } from "../lib/outcome";
import {
  QUIET_LEVELS,
  QUIET_LEVEL_LABEL,
  QUIET_LEVEL_NOTE,
  audibleAt,
  type QuietLevel,
} from "../lib/quietLevel";
import { formatFirmwareRevision } from "../lib/readerIdentity";
import { PAGE_RULE } from "../lib/uiConstants";
import { TOAST_CORNER_LABEL, type ToastCorner } from "../lib/toastCorner";
import type { LibraryState } from "../hooks/useLibrary";
import type { DeviceInfo } from "../types";

/**
 * Settings: the preferences, the facts about this build, and this Reader's
 * limits — the three things that used to be scattered across the sidebar footer,
 * every page's footer, and every tag.
 *
 * One group at a time, chosen from a row of buttons, so each group is one click
 * away rather than three screens down. Feedback opens first, and Data sits
 * between it and About: the library's file, its export and import, and the one
 * action that clears everything saved.
 *
 * The page is a leaf and owns none of the shell's state. The quiet level and the
 * Reader's identity arrive as props, because they belong to the shell: a second
 * `useBeep` here would be a second signal subscriber, and every outcome would
 * sound twice (ADR 0008).
 */

/** One of Settings' groups. */
export type SettingsGroup = "feedback" | "data" | "about" | "diagnostics";

/**
 * The groups, in the order they are shown. Data holds the library's own file and
 * everything that acts on it, so the browsing page is for finding things.
 */
const GROUPS: readonly { readonly id: SettingsGroup; readonly label: string }[] = [
  { id: "feedback", label: "Feedback" },
  { id: "data", label: "Data" },
  { id: "about", label: "About" },
  { id: "diagnostics", label: "Diagnostics" },
];

/**
 * The corner control's buttons, laid out the way the screen is: the top row of
 * buttons sets the top corners. `TOAST_CORNERS` is ordered default-first, which
 * is the order nothing else needs; this is the order a picture needs.
 */
const CORNER_ROW: readonly ToastCorner[] = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

const CORNER_OPTIONS: readonly SegmentedOption<ToastCorner>[] = CORNER_ROW.map((corner) => ({
  value: corner,
  label: TOAST_CORNER_LABEL[corner],
}));

/**
 * The quiet level's three buttons, in the spec's order: silence first, then the
 * errors-and-warnings setting, then everything. A row that reads as a scale is
 * easier to choose from than three unrelated names.
 */
const QUIET_LEVEL_OPTIONS: readonly SegmentedOption<QuietLevel>[] = QUIET_LEVELS.map(
  (level) => ({ value: level, label: QUIET_LEVEL_LABEL[level] }),
);

/** What the About group says about the Reader when there is not one. */
const NO_READER = "no reader";

export interface ReaderSummary {
  readonly connected: boolean;
  readonly info: DeviceInfo | null;
  readonly firmware: string | null;
}

interface SettingsPageProps {
  readonly reader: ReaderSummary;
  /** The three-way audible preference, owned by the shell and stored locally. */
  readonly quietLevel: QuietLevel;
  readonly onQuietLevelChange: (level: QuietLevel) => void;
  /**
   * The library, passed in because the store is the shell's: the Data group shows
   * the file's path, exports and imports it, and reloads it after a clear. A
   * second `useLibrary` here would be a second reader of the same file.
   */
  readonly library: LibraryState;
}

export function SettingsPage({
  reader,
  quietLevel,
  onQuietLevelChange,
  library,
}: SettingsPageProps) {
  const [group, setGroup] = useState<SettingsGroup>("feedback");

  return (
    <div className="flex flex-col gap-8">
      <Segmented
        label="Settings group"
        value={group}
        options={GROUPS.map((entry) => ({ value: entry.id, label: entry.label }))}
        onChange={setGroup}
      />

      {group === "feedback" && (
        <FeedbackGroup
          connected={reader.connected}
          quietLevel={quietLevel}
          onQuietLevelChange={onQuietLevelChange}
        />
      )}
      {group === "data" && <DataGroup library={library} />}
      {group === "about" && <AboutGroup reader={reader} />}
      {group === "diagnostics" && (
        <DiagnosticsGroup connected={reader.connected} quietLevel={quietLevel} />
      )}
    </div>
  );
}

/**
 * One press of the beeper test, from either surface that offers one.
 *
 * Three states, and each says only what is true. Connected and audible sends the
 * signal a completed operation makes. Connected but silenced by the quiet level
 * says so, rather than claiming a chirp that the preference had just declined to
 * play. No Reader says nothing was sent. In every case the app states what it
 * sent, never what was heard — the firmware never acknowledges the frame.
 */
function reportBeepTest(connected: boolean, quietLevel: QuietLevel): void {
  if (!connected) {
    report(outcomes.beepTestNoReader());
    return;
  }
  if (!audibleAt(quietLevel, "done")) {
    report(outcomes.beepTestMuted(quietLevel));
    return;
  }
  report(outcomes.beepTest());
}

/**
 * The sound, and the corner messages appear in.
 *
 * The quiet level replaces an on/off switch, because "silent except failures" is
 * a real daily setting and a switch forces a choice between hearing everything
 * and hearing nothing. It is stored on this machine, so it is changeable with no
 * Reader attached — the control is never disabled by hardware that is absent.
 *
 * The beep test is reported as an outcome rather than sent as a bare frame,
 * because the audible channel is reached only through the seam (ADR 0008) and
 * because what a user is testing here is the whole path — the preference
 * included. The frame-level probe lives in Diagnostics, where it names its frames.
 */
function FeedbackGroup({
  connected,
  quietLevel,
  onQuietLevelChange,
}: {
  connected: boolean;
  quietLevel: QuietLevel;
  onQuietLevelChange: (level: QuietLevel) => void;
}) {
  const { corner, setCorner } = useToastCorner();

  return (
    <div className={`flex flex-col gap-6 border-t border-border pt-6 ${PAGE_RULE}`}>
      <div className="flex flex-col gap-2">
        <p className="text-sm text-text">Quiet level</p>
        <Segmented
          label="Quiet level"
          value={quietLevel}
          options={QUIET_LEVEL_OPTIONS}
          onChange={onQuietLevelChange}
        />
        <p className="max-w-prose text-xs leading-relaxed text-text-muted">
          {QUIET_LEVEL_NOTE[quietLevel]}
        </p>
        <p className="max-w-prose text-xs leading-relaxed text-text-muted">
          Remembered between sessions, and settable with nothing plugged in.
        </p>
      </div>

      <div className="flex flex-col items-start gap-2">
        <Button variant="secondary" onClick={() => reportBeepTest(connected, quietLevel)}>
          Beep test
        </Button>
        {/* Said before it is pressed, because the firmware never answers the frame. */}
        <p className="max-w-prose text-xs leading-relaxed text-text-muted">
          The firmware never confirms that the buzzer sounded, so a sent frame is not proof
          that it was heard.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm text-text">Messages appear in</p>
        <Segmented
          label="Messages appear in"
          value={corner}
          options={CORNER_OPTIONS}
          onChange={setCorner}
          columns={2}
        />
        <p className="max-w-prose text-xs leading-relaxed text-text-muted">
          Remembered between sessions, so a corner that suits you stays chosen.
        </p>
      </div>
    </div>
  );
}

/**
 * Data: the library's own file, its export and import, and clearing everything.
 *
 * These controls used to sit on the Library page, under the Snapshots they act on.
 * They act on the whole library rather than on what is being browsed, so they
 * belong with the other facts and actions about this machine's storage; the
 * browsing page keeps finding things. The behaviour is the one that was there:
 * an export re-imports identically, and an import adds what is missing and leaves
 * every entry already here untouched.
 */
function DataGroup({ library }: { library: LibraryState }) {
  const path = library.view?.path ?? null;
  const problem = library.view?.problem ?? null;

  const [revealNote, setRevealNote] = useState<string | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [fileNote, setFileNote] = useState<{ text: string; path?: string } | null>(null);
  const [importPath, setImportPath] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);

  const reveal = async () => {
    setRevealNote(null);
    try {
      await invoke<string>("library_reveal");
    } catch (e) {
      setRevealNote(e instanceof Error ? e.message : String(e));
    }
  };

  const resetImport = () => {
    setImportPath(null);
    setImportPreview(null);
  };

  const exportLibrary = async () => {
    setFileNote(null);
    resetImport();
    setFileBusy(true);
    try {
      const chosen = await library.pickPath("save", suggestedExportName(new Date()));
      // Cancelled: nothing was written, so there is nothing to report.
      if (!chosen) return;
      const result = await library.exportTo(chosen);
      if (result) setFileNote({ text: describeExport(result), path: result.path });
    } finally {
      setFileBusy(false);
    }
  };

  const chooseImport = async () => {
    setFileNote(null);
    resetImport();
    setFileBusy(true);
    try {
      const chosen = await library.pickPath("open");
      // Cancelled: the library has not been read or written.
      if (!chosen) return;
      const preview = await library.previewImport(chosen);
      if (preview) {
        setImportPath(chosen);
        setImportPreview(preview);
      }
    } finally {
      setFileBusy(false);
    }
  };

  const confirmImport = async () => {
    if (!importPath) return;
    setFileBusy(true);
    try {
      const result = await library.applyImport(importPath);
      if (result) {
        // The merge keeps every entry already here, so this says what was added.
        setFileNote({ text: describeImportApplied(result.preview) });
        resetImport();
      }
    } finally {
      setFileBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <Section
        title="Library file"
        hint={LIBRARY_PLAINTEXT_NOTICE}
        actions={
          <Button variant="secondary" onClick={() => void reveal()}>
            Reveal in file manager
          </Button>
        }
      >
        <div className="flex flex-col gap-2">
          {/* The path is machine data, so it is mono and selectable in full. */}
          <code className="block select-text break-all rounded-lg border border-border bg-canvas px-3 py-2 font-mono text-xs leading-relaxed text-text-muted">
            {path ?? "the app data directory"}
          </code>
          {revealNote && <p className="text-xs leading-relaxed text-err">{revealNote}</p>}
          {!path && (
            <p className="max-w-prose text-xs leading-relaxed text-text-muted">
              The library file is created the first time something is saved, in this directory.
            </p>
          )}
        </div>
      </Section>

      <Section
        title="Export and import"
        hint="The whole library in one file: back it up, or move it to another machine. An import adds what is missing and leaves every entry already here exactly as it is."
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={problem !== null || fileBusy}
              onClick={() => void exportLibrary()}
            >
              Export library…
            </Button>
            <Button
              variant="secondary"
              disabled={problem !== null || fileBusy}
              onClick={() => void chooseImport()}
            >
              Import library…
            </Button>
          </div>

          {problem && (
            <p className="max-w-prose text-xs leading-relaxed text-text-muted">
              The library file cannot be read, so exporting and importing are unavailable until it
              is dealt with. Clearing saved data is still possible, below.
            </p>
          )}

          {importPreview && importPath && (
            <Notice tone="pending" label="Pending">
              <p className="text-sm leading-relaxed text-text">
                {describeImportPreview(importPreview)}
              </p>
              <code className="select-text break-all font-mono text-[11px] text-text-muted">
                {importPath}
              </code>
              <p className="max-w-prose text-xs leading-relaxed text-text-muted">
                Nothing has been written yet. Add to library applies the import; Cancel leaves the
                library exactly as it is.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  disabled={fileBusy || nothingToAdd(importPreview)}
                  onClick={() => void confirmImport()}
                >
                  {fileBusy ? "Adding…" : "Add to library"}
                </Button>
                <Button variant="ghost" disabled={fileBusy} onClick={resetImport}>
                  Cancel
                </Button>
              </div>
            </Notice>
          )}

          {fileNote && (
            <div>
              <p className="text-xs leading-relaxed text-ok">{fileNote.text}</p>
              {fileNote.path && (
                <code className="mt-1 block select-text break-all font-mono text-[11px] text-text-muted">
                  {fileNote.path}
                </code>
              )}
            </div>
          )}
        </div>
      </Section>

      {/* Reloads the library after a clear, so the app is in its first-run state
          without a restart rather than showing a file that is no longer there. */}
      <ClearSavedData onCleared={() => library.reload()} />
    </div>
  );
}

/** The version, where the code lives, the licence, and what it stands on. */
function AboutGroup({ reader }: { reader: ReaderSummary }) {
  const product = reader.info?.product ?? NO_READER;
  const manufacturer = reader.info?.manufacturer ?? NO_READER;
  const serial = reader.info?.serial ?? NO_READER;
  const firmware = reader.connected
    ? formatFirmwareRevision(reader.firmware)
    : "not connected";

  return (
    <div className="flex flex-col gap-8">
      <Section
        title="This build"
        hint="The version to quote when something goes wrong."
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Version" value={APP_VERSION} />
            <Field label="Licence" value={LICENCE} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.12em] text-text-muted">
              Repository
            </span>
            <a
              href={REPOSITORY_URL}
              target="_blank"
              rel="noreferrer"
              className="w-fit select-text break-all font-mono text-sm text-accent-muted hover:underline"
            >
              {REPOSITORY_URL}
            </a>
          </div>
        </div>
      </Section>

      <Section
        title="Reader"
        hint="Reported by the Reader itself. Its status and firmware stay in the sidebar while you work."
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Product" value={product} />
          <Field label="Manufacturer" value={manufacturer} />
          <Field label="Serial" value={serial} />
          <Field label="Firmware" value={firmware} />
        </div>
      </Section>

      <Section title="Credits">
        <p className="max-w-prose text-xs leading-relaxed text-text-muted">{CREDITS_NOTE}</p>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {CREDITS.map((credit) => (
            <li key={credit.url}>
              <a
                href={credit.url}
                target="_blank"
                rel="noreferrer"
                className="select-text text-xs text-accent-muted hover:underline"
              >
                {credit.name}
              </a>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

/**
 * Diagnostics: what this Reader can be made to do, and what it never will.
 *
 * The indicator test drives the two actuators the firmware exposes, and both
 * report through the seam: a component that reaches the hardware and puts the
 * result in its own state is the defect ADR 0008 exists to prevent, whether or not
 * the result makes a sound. The beep reports what actually happened, including
 * when the quiet level declined to play it. The LED-off frame is not a beep, so
 * its outcome is silent by kind (`led-off`), and it says which frame was sent
 * rather than claiming what was seen.
 *
 * The capability limits are rendered here and nowhere else — `ReaderLimits` — so a
 * limitation is stated once instead of against every Tag that trips over it.
 */
function DiagnosticsGroup({
  connected,
  quietLevel,
}: {
  connected: boolean;
  quietLevel: QuietLevel;
}) {
  const ledOff = async () => {
    try {
      await invoke("led_off");
      // Through the seam like the beep test beside it: one outcome, so a sent
      // frame and a failed one are two different results rather than two strings
      // in local state. It is silent because `0x0055` is not a beep.
      report(outcomes.ledOff());
    } catch (e) {
      // The frame did not go. That is the Reader's failure, with its own remedy —
      // never an "LED off sent" that was not sent.
      report(outcomes.readerFailure(e));
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <Section
        title="Indicator test"
        hint={
          connected
            ? "Both frames are fire-and-forget: they act, then send nothing back."
            : "Plug in the Reader to run the indicator test."
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            disabled={!connected}
            onClick={() => reportBeepTest(connected, quietLevel)}
          >
            Beep <span className="font-mono text-[11px] opacity-70">0x53</span>
          </Button>
          <Button variant="secondary" disabled={!connected} onClick={() => void ledOff()}>
            LED off <span className="font-mono text-[11px] opacity-70">0x55</span>
          </Button>
        </div>
        <p className="mt-3 max-w-prose text-xs leading-relaxed text-text-muted">
          No LED-on-only command has been identified — 0x0053 is the only thing seen to
          light it, and it always chirps first.
        </p>
      </Section>

      <ReaderLimits />
    </div>
  );
}
