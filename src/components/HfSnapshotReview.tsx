/**
 * What a saved 13.56 MHz Snapshot holds, in the pane that reviews it.
 *
 * The whole point of ticket 09 is this pane with no Reader attached: everything
 * a read produced is here, and nothing here was invented to fill a gap.
 *
 * **Absent is shown as absent.** A Snapshot written before schema 3 — or one a
 * hand-edited file carries in the older shape — never held an ATQA, a capacity,
 * an NDEF status or a list of Records. Those fields render as *not recorded*
 * with a muted tone, never as a zero, an empty list or a plausible card family,
 * because "this file does not say" and "this Tag was empty" are different facts
 * and a review depends on telling them apart.
 *
 * The Records are the Tag's own order, read back exactly as it held them. A
 * Record this build cannot encode again says so in place, since writing the
 * Snapshot back to a Tag is offered from the same pane and would refuse there.
 */

import { recordProblem } from "../lib/ndef";
import { recordKindLabel, recordSummary } from "../lib/drafts";
import { shortenSummary } from "../lib/hfRead";
import { savedRecordsLabel } from "../lib/hfSnapshot";
import { Field } from "./Section";
import type { DraftRecord } from "../lib/drafts";
import type { Snapshot } from "../lib/library";

/** How a value nobody recorded is written. Not a dash, and not a guess. */
const NOT_RECORDED = "not recorded";

export function HfSnapshotReview({ snapshot }: { snapshot: Snapshot }) {
  const hf = snapshot.hf;
  // A 125 kHz Snapshot has no such thing, and a raw-only 13.56 MHz read has no
  // Tag to describe: both are the absence of an area rather than an empty one.
  if (snapshot.kind !== "HF" || !hf) return null;

  const records = hf.records ?? null;
  const ndef =
    hf.ndefFormatted === null || hf.ndefFormatted === undefined
      ? null
      : hf.ndefFormatted
        ? "yes"
        : "no";

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        <Field
          label="Card type"
          value={hf.cardType ?? NOT_RECORDED}
          tone={hf.cardType ? "default" : "muted"}
        />
        <Field
          label="Capacity"
          value={
            hf.capacityBytes === null || hf.capacityBytes === undefined
              ? NOT_RECORDED
              : `${hf.capacityBytes} bytes`
          }
          tone={hf.capacityBytes === null || hf.capacityBytes === undefined ? "muted" : "default"}
        />
        <Field
          label="NDEF formatted"
          value={ndef ?? NOT_RECORDED}
          tone={ndef === null ? "muted" : "default"}
        />
        <Field label="ATQA" value={hf.atqa ?? NOT_RECORDED} tone={hf.atqa ? "default" : "muted"} />
        <Field label="SAK" value={hf.sak ?? NOT_RECORDED} tone={hf.sak ? "default" : "muted"} />
      </div>

      {(hf.ndefFormatted === null || hf.ndefFormatted === undefined) && (
        <p className="max-w-prose text-xs leading-relaxed text-text-muted">
          This Snapshot was written before a 13.56 MHz read kept its NDEF status, so whether the
          Tag was formatted was never recorded. It is not shown as “no”: nothing read page 3.
        </p>
      )}

      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[11px] uppercase tracking-[0.12em] text-text-muted">Records</span>
          <span className="font-mono text-[11px] text-text-muted">
            {savedRecordsLabel(records)}
          </span>
        </div>
        {records === null ? (
          <p className="max-w-prose text-xs leading-relaxed text-text-muted">
            This Snapshot records no list of Records, because the message was not read when it was
            taken. That is not the same as an empty message, and it is not shown as one.
          </p>
        ) : records.length === 0 ? (
          <p className="max-w-prose text-xs leading-relaxed text-text-muted">
            The Tag carried no message this build could list: the read settled it, and the answer
            was nothing.
          </p>
        ) : (
          <RecordsList records={records} />
        )}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.12em] text-text-muted">
          Raw reply
        </span>
        <code className="block select-text break-all rounded-lg border border-border bg-canvas px-3 py-2 font-mono text-xs leading-relaxed text-accent-muted">
          {hf.raw === "" ? "(empty payload)" : hf.raw}
        </code>
      </div>
    </div>
  );
}

/**
 * The Records in the Tag's order: position, kind, value and whether this build
 * can encode the same Record again.
 *
 * One line each, because a saved Record holding a paragraph is still a row here
 * — the summary is flattened and cut at the same length the readout uses.
 */
function RecordsList({ records }: { records: readonly DraftRecord[] }) {
  // Deliberately not a `list`: the Library's own list is the one `list` in this
  // page, and a second one inside the pane would make "the list beside the pane"
  // ambiguous to a reader — and to `getByRole("list")`.
  return (
    <div
      data-records="snapshot"
      className="flex flex-col divide-y divide-border/60 rounded-lg border border-border"
    >
      {records.map((record, at) => {
        const problem = recordProblem(record);
        const summary = shortenSummary(recordSummary(record));
        return (
          <div key={at} data-record={at + 1} className="flex flex-col gap-1 px-3 py-2">
            <div className="flex items-baseline justify-between gap-3 text-[11px] leading-relaxed">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="font-mono text-text-muted">{at + 1}</span>
                <span className="whitespace-nowrap text-text">{recordKindLabel(record)}</span>
              </span>
              <span
                className={`shrink-0 ${problem === null ? "text-text-muted" : "text-warn"}`}
                title={problem ?? "This build can encode this Record again"}
              >
                {problem === null ? "encodable" : "not encodable"}
              </span>
            </div>
            <span className="max-w-full truncate font-mono text-[11px] text-accent-muted">
              {summary === "" ? "—" : summary}
            </span>
            {problem !== null && (
              <span className="max-w-prose text-[11px] leading-relaxed text-warn">{problem}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
