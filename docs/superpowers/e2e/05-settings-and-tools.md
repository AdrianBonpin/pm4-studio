# 05 — Settings in four groups; Tools

**Ticket criterion:** Settings, all four groups; Tools. At both sizes.

Every image below was taken from `e2e.html` on port 1421 with
`src/dev/deviceStub.ts` at the Tauri invoke boundary — no Reader attached —
branch `ticket/07-e2e-destinations` off integration `d6eadd2`.

| Surface | 980×760 | 900×700 |
|---|---|---|
| Feedback | `settings-feedback-980.png` | `settings-feedback-900.png` |
| Data | `settings-data-980.png` | `settings-data-900.png` |
| Data, scrolled to the typed-word gate | `settings-data-gate-980.png` | `settings-data-gate-900.png` |
| About | `settings-about-980.png` | `settings-about-900.png` |
| Diagnostics | `settings-diagnostics-980.png` | `settings-diagnostics-900.png` |
| Diagnostics, scrolled to the limits | `settings-diagnostics-limits-980.png` | `settings-diagnostics-limits-900.png` |
| Tools | `tools-console-980.png` | `tools-console-900.png` |

The four groups are one page with one Collection-shaped switcher
(*Feedback · Data · About · Diagnostics*, `aria-pressed` on the current one), and
each group's sections are separated by a rule that reaches both edges of the
content area.

## Settings

- **Feedback** — the three-way quiet level (*Off · Errors and warnings only ·
  All*, with *All* current), under "Every report sounds: one chirp for done, two
  for needs you, three for attention." and "Remembered between sessions, and
  settable with nothing plugged in." Then the *Beep test* with the honest caption
  *"The firmware never confirms that the buzzer sounded, so a sent frame is not
  proof that it was heard"*, and then *Messages appear in* — the four corners laid
  out in the shape of the window, two rows of two, with *Bottom right* current.
  Everything fits inside 900×700 without a scroll.
- **Data** — the library file's path
  (`/Users/someone/Library/Application Support/pm4-studio/library.json`, the
  fixture's string) with *Reveal in file manager* and the plaintext notice
  ("The library is local plaintext JSON on this machine. It is never synced,
  uploaded, or sent anywhere."), then *Export and import*, then *Clear all saved
  data*: the three bullets naming exactly what goes, the paragraph that says every
  target is resolved by the app itself and that a symlink is refused rather than
  followed, then the typed-word gate.
  The group needs 874 px of content against 724 px of viewport at 980×760 and
  664 px at 900×700, so the gate — *Type `clear` to confirm*, the field, and the
  disabled **Clear all saved data** — is below the fold at both sizes. The
  `settings-data-gate-*` pair is that gate; the earlier version of this report
  claimed it as part of Data while showing an image that stopped before it, and
  that is what the second pair fixes.
- **About** — *This build*: version `0.2.0`, licence MIT, the repository link
  `https://github.com/AdrianBonpin/pm4-studio`; *Reader*, reported by the Reader
  itself: product `NFC-PM4`, manufacturer `pm4`, serial `STUB00000001`, firmware
  `H00S07` — the serial is the fixture's stand-in, not a device this pass saw;
  *Credits*: "The protocol was reverse-engineered from USB captures of this
  Reader. Not PC/SC, not CCID." with the two upstream links. At 980×760 the whole
  group is visible; at 900×700 the Credits paragraph and its links sit on the
  bottom edge.
- **Diagnostics** — *Indicator test*: **Beep** `0x53` and **LED off** `0x55`, with
  "Both frames are fire-and-forget: they act, then send nothing back." and the
  note that no LED-on-only command has been identified; then *Capability limits*,
  seven entries under the header "Stated here once. These are limits of this
  Reader's firmware and protocol, not failures of the Tag in front of it."
  The group needs 1011 px of content at 980×760 and 1050 px at 900×700, so
  `settings-diagnostics-*` is the top (the indicator test and the first entries)
  and `settings-diagnostics-limits-*` is the same group scrolled by one pane.

### F1 is no longer a finding — the limits now describe this build

The previous version of this report raised the capability limits as its most
serious finding: two entries said the app could not do what the same build
demonstrably did. Those entries have been corrected, and both are visible in
`settings-diagnostics-limits-980.png` and `settings-diagnostics-limits-900.png`:

> **NDEF messages** — "Available through the Type 2 TLV. A Type 2 Tag's message is
> read and listed as Records, written back from a Draft, and erased — read, write
> and erase are each verified on hardware. Copy carries a whole message to a
> second Tag, though its read-back has not yet been recorded on hardware. MIFARE
> Classic carries no Type 2 container, so NDEF is not possible there; password
> protection and APDU passthrough stay unavailable in their own entries."

> **7- and 10-byte UIDs** — "Decoded. The reply states its own UID length byte,
> and 4-, 7- and 10-byte widths are all read from it: a 7-byte UID is presented as
> seven bytes, with no fallback. The 10-byte width has a decoder but no hardware
> confirmation yet, because no 10-byte Tag has been tried — an open question
> rather than a limit."

That matches what the rest of this corpus shows: the decoded readout reports UID
`04 43 8A 01 22 09 03` as seven bytes with no fallback
(`hf-read-decoded-980.png` in [03-13-56-mhz.md](03-13-56-mhz.md)), and Write, Copy
and Erase all reach their confirmations in the same session. The one claim in the
list that this pass cannot check is the phrase "verified on hardware": nothing in
this directory is hardware evidence. The follow-up ticket
`docs/tickets/studio-redesign-followups/the-capability-limits-contradict-the-app.md`
is marked done, and this report now agrees with it instead of contradicting it.
[08-findings.md](08-findings.md) records F1 as **fixed** — its status table names
`9189c35`, integrated in `2febeea` — so the two reports agree; 08 keeps the finding's
original words as the record of what the verification saw, which is why its detail
section still quotes the retired sentences.

## Tools

The raw console and nothing else: a frame typed by hand into the field (the
default frame is `55 00 53 00 00 FF 00`), **Send**, the reply with its command id
and `checksum verified`, and the seven frame presets — now **ghost buttons**, not
chips, because pressing one types its frame into the field and sends nothing:

`Wake 0x51`, `LF read 0x72`, `HF poll 0x69`, `Beep 0x53`, `LED off 0x55`,
`Version 0x54`, `NTAG info 0x83`.

The reply in these images (`cmd 0x0055`, `checksum verified`, payload
`55 00 84 82 12 00 00 …`) is the fixture's answer to a frame, not a Reader's: the
stub returns a fixed payload whatever is sent. It is evidence that the console
renders a reply, and evidence of nothing else.

### Observation: the preset row reflows between buttons

Recorded as an observation, not a defect to fix, and `src/pages/ToolsPage.tsx` was
not touched by this ticket. The presets are seven ghost buttons with 11px mono
labels in a `flex flex-wrap` row inside the console's content column. Measured on
this branch:

| Viewport | Row container | Rows as laid out | Row extents |
|---|---|---|---|
| 900×700 | 628 px | **5 + 2** — Wake, LF read, HF poll, Beep, LED off ▪ Version, NTAG info | 525.6 px ▪ 235.1 px |
| 980×760 | 708 px | **6 + 1** — the first six ▪ NTAG info | 640.4 px ▪ 120.3 px |

The seven buttons sum to 720.7 px of width; with the six 8 px gaps between them a
single row would need about 769 px, which is why it wraps at both sizes. Every
button is 29.7 px tall at both widths, so **no preset's own label wraps onto a
second line** — the row reflows between buttons, and the minimum-size no-wrap
criterion holds. [06-long-label-sweep.md](06-long-label-sweep.md) records the same
row as 722 px of buttons and 770 px with the gaps; the 1–2 px difference is the
method (summed `getBoundingClientRect` widths here, the row's own extents there),
not a disagreement about the wrap.

**Limitation of this verification, stated plainly:** this is a **development**
build, and the raw console asks the backend what it is allowed to send
(`console_capability`; the fixture answers `readOnly: false`). The release build's
read-only allow-list — ADR 0006's promise — is a property of the Rust binary and is
therefore **not visible here**. The screenshot shows the console without the
release warning because that warning belongs to a build this verification cannot
produce.

## What is *not* established here

- That the release console refuses a write command: that is a Rust test's job
  (`console.rs`, ADR 0006), not a browser's.
- That the beep test or the LED test does anything at all on hardware. The
  indicator test sends frames; whether anything sounds or lights is the hardware
  checklist's business (**unrun**).
- That the version string matches the three manifests: that is
  `src/lib/appInfo.test.ts`'s assertion, not a screenshot's.
- That the Reader's serial, product or firmware are what any real device reports:
  every one of them in these images is the fixture's.
