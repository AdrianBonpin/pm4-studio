# 06 — The long-label sweep at the minimum size

**Ticket criterion:** "No control wraps onto a second line at the minimum size,
and the sweep covers the longest labels in the app."

## What was measured

At **900×700** (and, for a baseline, at 980×760), on 25 rendered states, every
control was inspected — `button`, `select`, `summary`, `[role=button]`,
`[role=tab]`, `[role=option]` — and for each of its text nodes a DOM `Range` was
built over the contents. A `Range` reports **one client rect per line**, so a
label that wrapped is a label with two distinct `top` values. That is a
measurement of the rendered text, not an inference from a width.

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

## Result

| Viewport | States | Controls inspected | Wrapped labels |
|---|---|---|---|
| 900×700 | 25 | 372 | **0** |
| 980×760 | 25 | 372 | **0** |

Per state — controls inspected / wrapped, both sizes identical in outcome:

| State | 900×700 controls | wrapped | 980×760 controls | wrapped |
|---|---|---|---|---|
| shell, each of the four corners | 15 each | 0 | 15 each | 0 |
| 125 kHz Read | 15 | 0 | 15 | 0 |
| 125 kHz Write (confirmation) | 14 | 0 | 14 | 0 |
| 125 kHz Reset (confirmation) | 17 | 0 | 17 | 0 |
| 125 kHz Clone (confirmation) | 15 | 0 | 15 | 0 |
| 125 kHz Batch (one attempt) | 15 | 0 | 15 | 0 |
| 13.56 Read, decoded | 14 | 0 | 14 | 0 |
| 13.56 Read, raw-only | 15 | 0 | 15 | 0 |
| 13.56 Write (confirmation) | 15 | 0 | 15 | 0 |
| 13.56 Copy (confirmation) | 15 | 0 | 15 | 0 |
| 13.56 Erase (confirmation) | 14 | 0 | 14 | 0 |
| 13.56 Memory | 13 | 0 | 13 | 0 |
| Library Snapshots, selected | 17 | 0 | 17 | 0 |
| Library Snapshots, none | 12 | 0 | 12 | 0 |
| Library Drafts, selected | 23 | 0 | 23 | 0 |
| Library Drafts, none | 18 | 0 | 18 | 0 |
| Settings Feedback | 18 | 0 | 18 | 0 |
| Settings Data | 14 | 0 | 14 | 0 |
| Settings About | 10 | 0 | 10 | 0 |
| Settings Diagnostics (×2 scroll positions) | 12 | 0 | 12 | 0 |
| Tools | 14 | 0 | 14 | 0 |

Raw measurements: `sweep-900.log` and `sweep-980.log` were the capture pass's own
output and are not committed; the numbers above are the whole of them.

## Does the sweep cover the longest labels?

The longest control labels in the app were all on screen during a swept state:

| Label | Where | Length |
|---|---|---|
| "Write the blank on the reader" | 125 kHz Batch | 29 |
| "Blank this tag permanently" | 125 kHz Reset confirmation | 27 |
| "Errors and warnings only" | Settings Feedback | 24 |
| "Write it to several blanks" | 125 kHz Clone | 24 |
| "Write to this Blank…" / "Replace 55 00 84 82 12 with 77 00 AB CD EF" | 125 kHz Clone | 28 / 41 |
| "Read the tag, then write" | 125 kHz Write | 24 |
| "Copy 55 00 84 82 12" | Library Snapshot detail (icon + UID) | 21 |
| "Delete Office guest Wi-Fi" | Library Draft detail | 24 |
| "Reveal in file manager" | Settings Data | 22 |
| "Copy 04 43 8A 01 22 09 03" | Library, HF Snapshot detail | 24 |
| "The original is still on the Reader" style notices | not controls | — |

Two surfaces with long labels were **not** reachable in the swept states, and are
recorded as gaps rather than as passes:

1. **The `<select>` option list.** The Write mode's Draft picker and the
   Records editor's 11-entry type picker render their options in a native popup,
   which is not part of the page and cannot be measured this way. Their closed
   control ("Choose a Draft", "Text") was measured and does not wrap.
2. **The 11-entry Record-type picker in a Draft with a MIFARE-style long name.**
   The picker's closed control was measured; the popup was not.

Nothing else in the app has a control label longer than the surface the sweep
covered.

## What this does *not* say

- It says nothing about prose. Body copy, notices and messages wrap by design; the
  criterion is about controls, and a message that wrapped would not be a defect.
- It says nothing about a window smaller than 900×700, which the app does not
  allow.
- It cannot see a wrap that only appears after an interaction the sweep did not
  perform. The 25 states were chosen to include every mode, every confirmation and
  every Settings group; a state not on that list was not measured.

## Related: controls that are below the fold

Not a wrap, but the same family of question — is the control where the user can
reach it. Content height vs. the content viewport at 900×700 (664 px):

| State | Content height | Overflow |
|---|---|---|
| 125 kHz Write confirmation | 820 | 156 |
| 125 kHz Reset confirmation | 863 | 199 |
| 125 kHz Clone confirmation | 774 | 110 |
| 13.56 Read, decoded | 961 | 297 |
| 13.56 Read, raw-only | 978 | 314 |
| 13.56 Write confirmation | 732 | 68 |
| 13.56 Copy confirmation | 794 | 130 |
| **13.56 Erase confirmation** | **799** | **135 — and its buttons are in the overflow** |
| Library Snapshots, selected | 794 | 130 |
| Library Drafts, selected | 1002 | 338 |
| Settings Data | 882 | 218 |
| Settings Diagnostics | 980 | 316 |
| every other state | 664 | 0 |

Only the Erase confirmation puts its own *action buttons* below the fold; that is
finding **F3** and has a follow-up ticket. The rest are prose or tables that
scroll, which is what scrolling is for.

The shell itself never scrolls: the sidebar and the message layer are fixed, and
the content column owns the scrollbar. That is the layout behaving at both sizes.
