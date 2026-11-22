# 06 — The long-label sweep at the minimum size

**Ticket criterion:** "The long-label sweep is re-run at 900×700 over every
destination and every mode, and every label stays on one line. The sweep report
states which labels it covers and records that each mode is one click from the
others."

**Re-run for:** ticket 08 of `interface-polish-and-contributing`, on
`feat/interface-polish-and-contributing` at `d6eadd2` (the integration tip this
pass started from), 2026-11-22. Every number below was measured on this branch.
Nothing here is carried over from the previous pass; the previous pass's numbers
are quoted only where they are being compared with these.

## What was measured

At **900×700** (the app's minimum), on **36 rendered states**, every control was
inspected — `button`, `select`, `summary`, `[role=button]`, `[role=tab]`,
`[role=option]` — and for each of its text nodes a DOM `Range` was built over the
contents. A `Range` reports **one client rect per line**, so a label that wrapped
is a label with two distinct `top` values. That is a measurement of the rendered
text, not an inference from a width.

The check, as run in the page:

```js
const S = 'button,select,summary,[role=button],[role=tab],[role=option]';
const wrapped = [];
let controls = 0;
for (const el of document.querySelectorAll(S)) {
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) continue;        // not rendered in this state
  controls++;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (!node.textContent.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const tops = new Set([...range.getClientRects()].map((x) => Math.round(x.top)));
    if (tops.size > 1) wrapped.push({ tag: el.tagName, text: node.textContent.trim() });
  }
}
```

Two things about this run, so the numbers are read correctly:

- **The content scroller is put back to the top before each measurement.** The
  layout measured is therefore the at-rest one. A control that is below the fold
  still reports a rect and is still measured; a control whose mode is not on show
  has no rect and is not counted, which is why the per-state counts differ.
- **Only 900×700 was swept in this pass.** The previous report also ran 980×760;
  the column is dropped here rather than filled with numbers this pass did not
  take. The two widths that were captured at 980 for the Draft-list report
  (`10-draft-list.md`) are images, not a sweep.

## What the sweep covers

Every destination and every mode in the app, plus the confirmations reachable by
clicking, plus all four message corners:

- **Destinations (5):** 125 kHz, 13.56 MHz, Library, Tools, Settings.
- **125 kHz, all five modes, plus the states inside them that carry the longest
  labels:** Read · Write (entry, and the confirmation before the write) · Clear
  (idle and the confirmation) · Clone (before the read, waiting for the Blank,
  and the confirmation after the tag swap) · Batch (idle and with a source
  read), plus the shell returning to this destination still on the mode it left.
- **13.56 MHz, all five modes, plus the states inside them:** Read (before a tag
  and decoded) · Write (the Draft list with nothing chosen, a Draft chosen, and
  the confirmation after Check tag) · Copy (start, source read, and the field
  checked with the source still in it) · Erase (start and the confirmation) ·
  Memory (start and a dump taken).
- **Library's two Collections (2):** each with its first item open on arrival, a
  chosen Snapshot, and — the state the Collections arrive in when you click a row
  that is already open — no item open at all.
- **Settings' four groups (4):** Feedback · Data · About · Diagnostics.
- **The four message corners:** top-right (the default), top-left, bottom-left,
  bottom-right.

## Result

| Viewport | States | Controls inspected | Wrapped labels |
|---|---|---|---|
| 900×700 | 36 | **532** | **0** |

Per state, in the order the pass visited them. "Overflow" is the content
column's `scrollHeight − clientHeight`; 0 means the state fits without scrolling.

| # | State | Controls | Wrapped | Overflow |
|---|---|---|---|---|
| 1 | 125 kHz Clear (confirmation) | 13 | 0 | 183 |
| 2 | 125 kHz Clone | 12 | 0 | 0 |
| 3 | 125 kHz Clone (original read, before the swap) | 15 | 0 | 0 |
| 4 | 125 kHz Clone (waiting for the Blank) | 13 | 0 | 0 |
| 5 | 125 kHz Clone (confirmation after the tag swap) | 14 | 0 | 0 |
| 6 | 125 kHz Batch | 13 | 0 | 0 |
| 7 | 125 kHz Batch (source read, one attempt available) | 14 | 0 | 261 |
| 8 | 125 kHz Read | 13 | 0 | 0 |
| 9 | 125 kHz Write (Identity entry) | 15 | 0 | 0 |
| 10 | 125 kHz Write (confirmation, before the write) | 15 | 0 | 129 |
| 11 | 13.56 MHz Read (before any tag is read) | 13 | 0 | 0 |
| 12 | 13.56 MHz Read (decoded NTAG215) | 15 | 0 | 306 |
| 13 | 13.56 MHz Write (Draft list, nothing chosen) | 13 | 0 | 0 |
| 14 | 13.56 MHz Write (a Draft chosen, write panel showing) | 14 | 0 | 0 |
| 15 | 13.56 MHz Write (confirmation after Check tag) | 16 | 0 | 186 |
| 16 | 13.56 MHz Copy (start) | 12 | 0 | 0 |
| 17 | 13.56 MHz Copy (source read, destination wanted) | 14 | 0 | 0 |
| 18 | 13.56 MHz Copy (field checked, same tag still there) | 14 | 0 | 40 |
| 19 | 13.56 MHz Erase (start) | 13 | 0 | 0 |
| 20 | 13.56 MHz Erase (confirmation) | 15 | 0 | 3 |
| 21 | 13.56 MHz Memory (start) | 14 | 0 | 0 |
| 22 | 13.56 MHz Memory (dump read) | 14 | 0 | 0 |
| 23 | Library Snapshots (first Snapshot open on arrival) | 18 | 0 | 122 |
| 24 | Library Snapshots (Lobby poster open) | 18 | 0 | 623 |
| 25 | Library Snapshots (no Snapshot open) | 13 | 0 | 0 |
| 26 | Library Drafts (first Draft open on arrival) | 24 | 0 | 330 |
| 27 | Library Drafts (no Draft open) | 12 | 0 | 0 |
| 28 | Tools | 15 | 0 | 0 |
| 29 | Settings Feedback (top-right corner, arrival) | 19 | 0 | 0 |
| 30 | Settings Feedback (top-left corner) | 19 | 0 | 0 |
| 31 | Settings Feedback (bottom-left corner) | 19 | 0 | 0 |
| 32 | Settings Feedback (bottom-right corner) | 19 | 0 | 0 |
| 33 | Settings Data | 15 | 0 | 210 |
| 34 | Settings About | 11 | 0 | 33 |
| 35 | Settings Diagnostics | 13 | 0 | 386 |
| 36 | 125 kHz Batch (returning to the destination keeps the mode) | 13 | 0 | 0 |

Raw measurements were the capture pass's own output and are not committed; the
table above is the whole of them.

## The switcher, and the modes one click apart

**One click away, verified by the click trail.** Every mode of both band pages
was entered by **one click** on its option in the switcher that was on screen —
never by a trip to another destination, another page, or another menu:

| From | One click reaches | Switcher |
|---|---|---|
| 125 kHz Read | Write | `125 kHz operation` |
| 125 kHz Write | Clear | `125 kHz operation` |
| 125 kHz Clear | Clone | `125 kHz operation` |
| 125 kHz Clone | Batch | `125 kHz operation` |
| 13.56 MHz Read | Write | `13.56 MHz mode` |
| 13.56 MHz Write | Copy | `13.56 MHz mode` |
| 13.56 MHz Copy | Erase | `13.56 MHz mode` |
| 13.56 MHz Erase | Memory | `13.56 MHz mode` |
| Library Snapshots | Drafts | `Collection` |
| Settings Feedback | Data | `Settings group` |
| Settings Data | About | `Settings group` |
| Settings About | Diagnostics | `Settings group` |
| Messages in any one corner | any of the other three | `Messages appear in` |

The switcher itself is **present in every state of its page**: one `role="group"`
with a name, one button per option, exactly one carrying `aria-pressed="true"`,
no option hidden or disabled, and every label one line. Measured positions:

| Switcher | Options | Rows | Option height | Option row top edge |
|---|---|---|---|---|
| `125 kHz operation` | 5 (Read, Write, Clear, Clone, Batch) | 1 | 26 px | y = 136, every 125 kHz state |
| `13.56 MHz mode` | 5 (Read, Write, Copy, Erase, Memory) | 1 | 26 px | y = 156, every 13.56 MHz state |
| `Identity entry` | 2 (Customer, facility, card / Five-byte hex) | 1 | 26 px | under the band switcher |
| `Collection` | 2 (Snapshots, Drafts) | 1 | 26 px | y = 156, both collections |
| `Settings group` | 4 (Feedback, Data, About, Diagnostics) | 1 | 26 px | y = 136, every group |
| `Quiet level` | 3 (Off, Errors and warnings only, All) | 1 | 26 px | y = 247, in Feedback |
| `Messages appear in` | 4 (Top left, Top right, Bottom left, Bottom right) | **2 rows of 2** | 26 px each | y = 485 and 515, in Feedback |
| Draft list (`Draft to write`) | 2 Drafts | 2 rows | 51 px each | 13.56 MHz Write; a list, not a switcher |

The two band pages differ by 20 px in where their option row starts (136 against
156) because the 13.56 MHz page's subtitle wraps onto a second line at the
minimum width, and the row does not move when the mode changes on either page.

The corner switcher is the one deliberate two-column grid: 2 rows of 2, each
label on one line ("Top left" 100 px wide, "Bottom right" 100 px wide). Every
other switcher is one row at the minimum size. The widest label in any switcher
is "Errors and warnings only" at 176 px inside a 26 px-tall button — one line.

The longest switcher label of all, `Customer, facility, card` (24 characters),
measured 165 × 26 px in one line, at the minimum size.

## Tools: a wrapping row of presets, which is not a label wrap

The console's seven presets are buttons in a `flex-wrap` row, not a switcher. At
900×700 the row breaks **5 + 2**:

| Row | Presets | Button size | Inner text overflow |
|---|---|---|---|
| 1 | Wake 0x51 · LF read 0x72 · HF poll 0x69 · Beep 0x53 · LED off 0x55 | 87–107 × 30 px | none (`scrollWidth` = `clientWidth`) |
| 2 | Version 0x54 · NTAG info 0x83 | 107–120 × 30 px | none |

The seven buttons measure 722 px across and need 770 px with the row's six 8 px
gaps, so a single row is not available at the minimum size. **This is a row that
wraps, not a label that wraps**: every preset's own label stayed on one line,
which is what the criterion is about. It is recorded here as an observation so
the number 5+2 is not later read as a finding.

The Draft list's rows are the other deliberate two-line control: each row is the
Draft's name over its facts (`2 Records · 131 bytes · 1d ago`), as two separate
text nodes. Neither line wrapped, and both are clipped with `truncate` rather
than wrapped, so a long Draft name cannot become a third line.

## Does the sweep cover the longest labels?

91 distinct control labels and control texts were on screen during the swept
states. The longest of them, and the state each was measured in:

| Label | Length | Where | Wrapped |
|---|---|---|---|
| `Replace 77 00 AB CD EF with 55 00 84 82 12` | 42 | 125 kHz Clone confirmation (after the swap) | no |
| `Write the blank on the reader` | 29 | 125 kHz Batch (source read) | no |
| `Write it to several blanks` | 26 | 125 kHz Clone (original read) | no |
| `Errors and warnings only` | 24 | Settings Feedback, Quiet level | no |
| `Customer, facility, card` | 24 | 125 kHz Write, Identity entry | no |
| `Read the tag, then write` | 24 | 125 kHz Write confirmation | no |
| `Erase the tag's content` | 23 | 13.56 MHz Erase confirmation | no |
| `Reveal in file manager` | 22 | Settings Data | no |
| `Keep the tag as it is` | 21 | Clear and Clone confirmations | no |
| `Read the tag to copy` | 20 | 125 kHz Batch | no |
| `Clear all saved data` | 20 | Settings Data | no |
| `Preview the Identity` | 20 | 125 kHz Write | no |
| `Tap a different tag` | 19 | 125 kHz Clone confirmation | no |
| `Change the values` | 17 | 125 kHz Write confirmation | no |
| `Keep the content` / `Clear this tag` | 16 / 14 | 13.56 MHz Erase, 125 kHz Clear | no |
| `Dismiss: …` (the message layer's dismiss control) | up to 57 | every state a message is showing | no |

Three surfaces in that list are worth naming because their length comes from the
message layer rather than from the page: the dismiss button's accessible name is
the whole message ("Dismiss: Read 55 00 84 82 12 — the original."), and it did
not wrap in any state.

## What this sweep does not cover

Recorded as gaps rather than as passes:

1. **Native `<select>` popups.** The Record-type picker (11 entries) and the
   Wi-Fi authentication and encryption pickers render their options in a native
   popup, which is not part of the page and cannot be measured this way. Their
   **closed** controls were measured and do not wrap: `Record type to add`,
   `Wi-Fi authentication` ("WPA2-Personal") and `Wi-Fi encryption` ("AES"). The
   61-character concatenation `TextURLPhoneEmailContactSMSLocation-Wi-Fi…` in the
   raw label list is the `<select>` element's own `textContent` — all eleven
   options at once, in a popup that is not rendered as page lines.
2. **No window smaller than 900×700**, which the app does not allow.
3. **A wrap that appears only after an interaction the sweep did not perform.**
   The 36 states were chosen to include every destination, every mode, every
   confirmation reachable by clicking, both Collections with and without an item
   open, all four Settings groups and all four corners. Not reached: Batch's
   per-attempt result lines (they need a second Blank per attempt), and 13.56
   MHz Copy's own confirmation, which needs a destination tag in the field. No
   state not in the table was measured.

## The fixture's own panel, as an observation

The verification build exposes a hidden device-stub panel (`Alt+Shift+D`) with
its own buttons. Measured once with that panel open, one of *its* buttons —
`NTAG213 04 9A 2B 3C 4D 5E 60 (copy destination)` — wrapped onto two lines in
the overlay. It is recorded here because it was seen, and it is **not** an app
finding: that panel is a developer control surface that no shipped build carries,
it is not part of the interface under test, and the same state measured with the
panel closed is row 5 of the table — 14 controls, zero wrapped.

## Related: controls that are below the fold

Not a wrap, but the same family of question — is the control where the user can
reach it. Content height vs. the content viewport at 900×700 (664 px), from the
Overflow column above:

| State | Overflow |
|---|---|
| Library Snapshots (Lobby poster open) | 623 |
| Settings Diagnostics | 386 |
| Library Drafts (a Draft open) | 330 |
| 13.56 MHz Read, decoded | 306 |
| 125 kHz Batch (source read) | 261 |
| Settings Data | 210 |
| 13.56 MHz Write confirmation | 186 |
| 125 kHz Clear confirmation | 183 |
| 125 kHz Write confirmation | 129 |
| Library Snapshots (first open on arrival) | 122 |
| 13.56 MHz Copy (same tag still there) | 40 |
| Settings About | 33 |
| 13.56 MHz Erase confirmation | 3 |
| every other state | 0 |

One number here changes a previous finding, so it is stated exactly rather than
by reference. The previous pass recorded the **13.56 MHz Erase confirmation** at
135 px of overflow with its own action buttons below the fold (finding F3). In
this run the same state overflows by **3 px**, and its two action buttons measure
`top 636, bottom 670` inside the 700 px viewport — fully visible, at rest, with no
scrolling. The remaining 3 px is the closing sentence under the buttons. F3 is
therefore not reproduced at this size on this branch; whether it should be closed
on that evidence is the owning ticket's call, not this pass's.

The shell itself never scrolls: the sidebar and the message layer are fixed, and
the content column owns the scrollbar. That is the layout behaving at both sizes.
