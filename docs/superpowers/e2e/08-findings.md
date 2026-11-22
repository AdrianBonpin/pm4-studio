# 08 — Every finding this ticket produced

Three defects, three observations that are not defects, and two limits of the
verification itself. The defects have follow-up tickets under
`docs/tickets/studio-redesign-followups/`; nothing was quietly fixed here, and no
existing ticket was edited.

## Defects — with follow-up tickets

### F1 — The capability limits contradict the app that shows them

**Severity: high.** Settings → Diagnostics → Capability limits tells the user two
things the same build demonstrably does:

> **NDEF messages** — "Not readable or writable today. The NTAG commands that carry
> NDEF have never answered on this Reader, so a 13.56 MHz Tag reports its UID and
> its raw payload only."

> **7- and 10-byte UIDs** — "Not decoded. Only 4-byte UIDs are split out; a longer
> UID is shown as raw bytes."

In the same session: 13.56 MHz Read fetched a two-Record NDEF message and rendered
it as a table; Copy and Erase built their confirmations from that message; and the
readout named a **7-byte** UID (`04 43 8A 01 22 09 03`) without a raw fallback.

Source: `src/lib/readerIdentity.ts`, `READER_CAPABILITY_LIMITS`, entries `ndef` and
`uid-width`. Both predate the slices that made them false (06, 08, 15) and neither
was revised by 19's sweep, which is source-pattern based and cannot see a
sentence that has become untrue.

Evidence: `screenshots/settings-diagnostics-limits-980.png` beside
`screenshots/hf-read-decoded-980.png`.

Why it matters more than a stale string: the spec's honesty constraint makes
Diagnostics *the* place a limitation is stated once. A false limitation there
teaches a user that a working feature is broken, which is the failure mode the
whole redesign was commissioned to remove.

Ticket: `docs/tickets/studio-redesign-followups/the-capability-limits-contradict-the-app.md`

### F2 — Copy refuses a destination that holds no message

**Severity: high.** Copying onto a tag that is NDEF formatted with an empty NDEF
TLV — or not formatted at all — is refused as *"Not copied: the destination's
message could not be read, so nothing is replaced"*, with the tag's own
"it holds a message of zero bytes" sentence quoted underneath as though it were a
read failure.

An empty tag is the ordinary destination for Copy: the flow exists so a message
can be duplicated onto another tag, and the second tag usually has nothing on it.
As built, Copy requires the destination to *already* hold an NDEF message.

Cause: `src/lib/hfCopy.ts`, `copyDestination` sets `message` only when the read
came back as `state === "records"`, so "read fine, holds nothing" and "could not be
read" collapse into one value, and `destinationDecision` refuses both as
`destination-unreadable`. The existing tests cover the unreadable case and a
destination that already holds the message, but not a destination that is readable
and empty.

Evidence: reproduced live in the browser against a formatted, empty NTAG fixture
(refusal message and severity in the corner); the Copy confirmation screenshots use
a destination that already holds a message, which is the only kind Copy accepts.

Ticket: `docs/tickets/studio-redesign-followups/copy-refuses-a-destination-that-holds-no-message.md`

### F3 — The Erase confirmation is taller than the window

**Severity: medium.** The confirmation runs to eight paragraphs, and its own
buttons fall off the bottom:

| Viewport | Content | Viewport | The buttons |
|---|---|---|---|
| 900×700 | 799 px | 664 px | off screen |
| 980×760 | 799 px | 724 px | bottom edge at y=777 in a 760 px window |

Confirming an erase means scrolling to find the button first, at both reviewed
sizes. The copy is also the clearest remaining instance of the "too much text"
complaint the redesign was commissioned to answer: seven explanatory paragraphs for
one destructive action whose outcome is a single sentence.

Evidence: `screenshots/hf-erase-confirmation-980.png`,
`screenshots/hf-erase-confirmation-900.png`.

Ticket: `docs/tickets/studio-redesign-followups/the-erase-confirmation-is-taller-than-the-window.md`

### F4 — Reset is called "Blank" in its own panel

**Severity: low (vocabulary).** The mode is **Reset**. Its panel says *Blank a
tag*, *Read the tag to blank*, *Blank this tag permanently*, *Blank another tag*,
and the page subtitle says "…or blank a tag". `GLOSSARY.md` puts "blank (as a verb)"
on Reset's *Avoid* line, precisely because the word invited the factory-restore
reading the spec set out to end.

Evidence: `screenshots/lf-reset-confirmation-980.png`,
`screenshots/lf-reset-confirmation-900.png`.

Ticket: `docs/tickets/studio-redesign-followups/reset-is-called-blank-in-its-own-panel.md`

## Observations — recorded, no ticket

**O1 — The default bottom-right corner can sit over a confirmation's own control.**
At 900×700, the success message for "Read 55 00 84 82 12" covers part of *Keep the
tag as it is* on the Reset confirmation (`lf-reset-confirmation-900.png`), and at
980×760 the same corner covers a paragraph of the Read-mode "Edit as Draft"
explanation. Not filed as a defect: a corner is where the user put it, the message
clears itself in four seconds, and choosing another corner is one click. Recorded
because it is the one place the corner model and a confirmation collide, and a
future pass may want the viewport to reserve the chosen corner's strip.

**O2 — Values wrap mid-token in the Memory panel.** At 980 px, the UID column wraps
`04 9A 2B 3C 4D 5E 60` after `5E`, and the read timestamp wraps after `2026-11-`.
These are `<dd>` values, not controls, so the no-wrap criterion is untouched; it
reads as sloppy rather than as broken. Recorded for a future polish pass
(`hf-memory-dump-980.png`).

**O3 — The viewport does not reserve a strip for messages.** Related to O1: the
content column fills the window, so any corner overlaps content by construction.
The spec's answer is the corner setting, and it works; noted so that nobody
"fixes" the overlap by shrinking the page.

## Limits of this verification — stated, not worked around

**L1 — The release build's raw console is not visible here.** The Tools screenshot
is a development build, and the read-only allow-list (ADR 0006) is a property of
the Rust binary. The console on screen therefore shows no release warning. That
warning is proved by `src-tauri/src/console.rs`'s tests, not by this screenshot.

**L2 — Everything about a tag, a write, a beep and an LED is unrun.** Criteria 3–7
of the ticket need a Reader and real tags. They are written out as a runbook at
`docs/superpowers/hardware-checklist-studio-redesign.md` and left unticked.

## Things checked and found correct

Recorded because "we looked and it was right" is also a finding:

- The five destinations, in the spec's order, with Reader status, firmware and
  Connect/Reconnect always visible, and no credits footer or beep toggle in the
  sidebar.
- The 125 kHz segmented control opens on Read, and each mode is one click away with
  no scrolling at 900×700.
- The 13.56 MHz order is Read · Write · Copy · Erase · **Memory** — the mode is not
  called Diagnostics, and Diagnostics lives only in Settings.
- The Reset confirmation carries all three writability caveats, in plain words,
  before the button.
- The ADR 0001 guard fires through the page: a Write whose target Identity is the
  Identity already on the tag is refused with *"Refused: the tag already carries
  55 00 84 82 12"*, and the button is disabled rather than removed.
- Copy's observed-removal step refuses the source and any other latched tag, and
  names which.
- A refused Reset leaves the tag unchanged, says so, and sends three chirps and a
  delayed LED-off at the seam.
- The 13.56 MHz readout names the *family range* an ATQA/SAK pair covers
  ("MIFARE Ultralight / NTAG21x") rather than a member it cannot distinguish.
- A poll reply that resolves to nothing renders as raw bytes with a reason and
  offers no Records read.
- The Memory panel names the tag by UID and type number only — no family.
- Library is two panes in both collections, with an explicit *Nothing selected*
  state.
- Settings states the plaintext-library fact once, gates clearing with a typed
  word, and lists its limits in one place (see F1 for what those limits say).
- 0 of 372 controls wrapped at either size, on 25 states.
