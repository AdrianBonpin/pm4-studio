# 05 — Settings in four groups; Tools

**Ticket criterion:** Settings, all four groups; Tools. At both sizes.

| Surface | 980×760 | 900×700 |
|---|---|---|
| Feedback | `settings-feedback-980.png` | `settings-feedback-900.png` |
| Data | `settings-data-980.png` | `settings-data-900.png` |
| About | `settings-about-980.png` | `settings-about-900.png` |
| Diagnostics | `settings-diagnostics-980.png` | `settings-diagnostics-900.png` |
| Diagnostics, scrolled to the limits | `settings-diagnostics-limits-980.png` | `settings-diagnostics-limits-900.png` |
| Tools | `tools-console-980.png` | `tools-console-900.png` |

## Settings

- **Feedback** — the three-way quiet level (Off · Errors and warnings only · All),
  a beep test carrying the honest caption *"The firmware never confirms that the
  buzzer sounded, so a sent frame is not proof that it was heard"*, and the four
  message corners laid out in the shape of the window.
- **Data** — the library file's path with *Reveal in file manager*, export and
  import, and clear-all-saved-data: what it removes (bulleted, exact), that it
  resolves every target itself and follows no symlink, and the typed-word gate.
- **About** — version `0.2.0`, licence MIT, the repository link, the Reader's
  product/manufacturer/serial/firmware, and the credits that used to sit on every
  page footer.
- **Diagnostics** — the indicator test (Beep `0x53`, LED off `0x55`, with the note
  that no LED-on-only command exists) and the capability limits.

### Finding F1 — the capability limits contradict the app that shows them

Under Diagnostics → Capability limits, two entries state that the app cannot do
what the rest of this build demonstrably does (`settings-diagnostics-limits-980.png`):

> **NDEF messages** — "Not readable or writable today. The NTAG commands that carry
> NDEF have never answered on this Reader, so a 13.56 MHz Tag reports its UID and
> its raw payload only."

> **7- and 10-byte UIDs** — "Not decoded. Only 4-byte UIDs are split out; a longer
> UID is shown as raw bytes."

The build reads and writes NDEF from a 13.56 MHz tag (Read, Write, Copy, Erase all
work in this same session), and its decoder reports a 7-byte UID as a 7-byte UID
(`hf-read-decoded-980.png`). Diagnostics is the one place the spec says a
limitation may be stated, so a stale entry there is worse than a missing one: it
tells a user the app cannot do what they are looking at.

Follow-up ticket:
`docs/tickets/studio-redesign-followups/the-capability-limits-contradict-the-app.md`.
This is the most serious finding of this ticket.

## Tools

The raw console and nothing else: a frame typed by hand, the command chips
(Wake `0x51`, LF read `0x72`, HF poll `0x69`, Beep `0x53`, LED off `0x55`,
Version `0x54`, NTAG info `0x83`), and the reply with `checksum verified`.

**Limitation of this verification, stated plainly:** this is a **development**
build, and the raw console asks the backend what it is allowed to send
(`console_capability`). The release build's read-only allow-list — ADR 0006's
promise — is a property of the Rust binary and is therefore **not visible here**.
The screenshot shows the console without the release warning because that warning
belongs to a build this verification cannot produce.

## What is *not* established here

- That the release console refuses a write command: that is a Rust test's job
  (`console.rs`, ADR 0006), not a browser's.
- That the beep test or the LED test does anything at all on hardware. The
  indicator test sends frames; whether anything sounds or lights is the hardware
  checklist's business (**unrun**).
- That the version string matches the three manifests: that is
  `src/lib/appInfo.test.ts`'s assertion, not a screenshot's.
