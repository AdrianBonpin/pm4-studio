import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "../components/ui/Button";
import { Segmented, type SegmentedOption } from "../components/ui/Segmented";
import { Toggle } from "../components/ui/Toggle";
import { ReaderLimits } from "../components/ReaderLimits";
import { Field, Section } from "../components/Section";
import { useToastCorner } from "../hooks/useToastCorner";
import { APP_VERSION, CREDITS, CREDITS_NOTE, LICENCE, REPOSITORY_URL } from "../lib/appInfo";
import { outcomes, report } from "../lib/outcome";
import { formatFirmwareRevision } from "../lib/readerIdentity";
import { TOAST_CORNER_LABEL, type ToastCorner } from "../lib/toastCorner";
import type { DeviceInfo } from "../types";

/**
 * Settings: the preferences, the facts about this build, and this Reader's
 * limits — the three things that used to be scattered across the sidebar footer,
 * every page's footer, and every tag.
 *
 * One group at a time, chosen from a row of buttons, so each group is one click
 * away rather than three screens down. Feedback opens first. A fourth group
 * (`Data`, the library path and clear-all) slots into that row as one entry: the
 * switcher is a single row of pills, the panels are siblings, and nothing about
 * the layout assumes three.
 *
 * The page is a leaf and owns none of the shell's state. The beep preference and
 * the Reader's identity arrive as props, because they belong to the shell: a
 * second `useBeep` here would be a second signal subscriber, and every outcome
 * would sound twice (ADR 0008).
 */

/** One of Settings' groups. */
export type SettingsGroup = "feedback" | "about" | "diagnostics";

/**
 * The groups, in the order they are shown. `Data` arrives with ticket 05 as one
 * more entry between Feedback and About; nothing else moves.
 */
const GROUPS: readonly { readonly id: SettingsGroup; readonly label: string }[] = [
  { id: "feedback", label: "Feedback" },
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

/** What the About group says about the Reader when there is not one. */
const NO_READER = "no reader";

export interface ReaderSummary {
  readonly connected: boolean;
  readonly info: DeviceInfo | null;
  readonly firmware: string | null;
}

interface SettingsPageProps {
  readonly reader: ReaderSummary;
  readonly beepOn: boolean;
  readonly onBeepOnChange: (on: boolean) => void;
}

export function SettingsPage({ reader, beepOn, onBeepOnChange }: SettingsPageProps) {
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
          beepOn={beepOn}
          onBeepOnChange={onBeepOnChange}
        />
      )}
      {group === "about" && <AboutGroup reader={reader} />}
      {group === "diagnostics" && <DiagnosticsGroup connected={reader.connected} />}
    </div>
  );
}

/**
 * The one sound the app makes on request, with no operation behind it.
 *
 * It is reported as an outcome rather than sent as a bare frame, because the
 * audible channel is reached only through the seam (ADR 0008) and because what a
 * user is testing here is the whole path — the preference included — not the
 * wire. The frame-level probe lives in Diagnostics, where it names its frames.
 */
function FeedbackGroup({
  beepOn,
  onBeepOnChange,
}: {
  beepOn: boolean;
  onBeepOnChange: (on: boolean) => void;
}) {
  const { corner, setCorner } = useToastCorner();

  return (
    <div className="flex flex-col gap-6 border-t border-border pt-6">
      {/* The quiet level (ticket 04) replaces this row with a three-way control;
          the group is a column of rows, so it changes one row and moves nothing. */}
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="text-sm text-text">Beep</p>
          <p className="mt-0.5 max-w-prose text-xs leading-relaxed text-text-muted">
            The beeper sounds when an operation reports. With it off every report is on
            screen only — nothing is lost but the sound.
          </p>
        </div>
        <div className="shrink-0 pt-0.5">
          <Toggle checked={beepOn} onChange={onBeepOnChange} label="Beep" />
        </div>
      </div>

      <div className="flex flex-col items-start gap-2">
        <Button variant="secondary" onClick={() => report(outcomes.beepTest())}>
          Beep test
        </Button>
        {/* Said before it is pressed, because the firmware never answers the frame. */}
        <p className="max-w-prose text-xs leading-relaxed text-text-muted">
          The firmware never confirms that the buzzer sounded, so this proves the frame was
          sent, not heard.
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
 * The indicator test drives the two actuators the firmware exposes. The beep goes
 * through the seam like every other sound, because a component that reaches the
 * beeper directly is the defect ADR 0008 exists to prevent; the LED-off frame is
 * not a beeper call, so it is sent directly and the page says which frame it sent
 * rather than claiming what was seen.
 *
 * The capability limits are rendered here and nowhere else — `ReaderLimits` — so a
 * limitation is stated once instead of against every Tag that trips over it.
 */
function DiagnosticsGroup({ connected }: { connected: boolean }) {
  const [note, setNote] = useState<string | null>(null);

  const ledOff = async () => {
    setNote(null);
    try {
      await invoke("led_off");
      setNote("LED off sent. 0x0055 is the LED-off frame, not a beep.");
    } catch (e) {
      setNote(String(e));
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
            onClick={() => report(outcomes.beepTest())}
          >
            Beep <span className="font-mono text-[11px] opacity-70">0x53</span>
          </Button>
          <Button variant="secondary" disabled={!connected} onClick={() => void ledOff()}>
            LED off <span className="font-mono text-[11px] opacity-70">0x55</span>
          </Button>
        </div>
        {note && <p className="mt-3 text-xs leading-relaxed text-text-muted">{note}</p>}
        <p className="mt-3 max-w-prose text-xs leading-relaxed text-text-muted">
          No LED-on-only command has been identified — 0x0053 is the only thing seen to
          light it, and it always chirps first.
        </p>
      </Section>

      <ReaderLimits />
    </div>
  );
}
