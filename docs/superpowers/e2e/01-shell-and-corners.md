# 01 — The shell, its five destinations, and the four message corners

**Ticket criterion:** screenshots at 980×760 and at the 900×700 minimum for the
shell with all five destinations, and a message in each of the four corner
settings.

**Method:** for each corner — Settings → Feedback → the corner control → back to
125 kHz → Read tag. The message is produced by a real operation after the corner
is chosen, so what is photographed is the stored setting doing its work, not a
positioned box.

**Re-captured on `ticket/06-e2e-shell-and-125khz`** (integration
`d6eadd2`), from `http://localhost:1420/e2e.html?lf=source`, at both sizes, with
the fixture standing at the invoke boundary. Every image in this file is one
taken in that pass; nothing here survives from the previous capture.

## The five destinations

One click on the sidebar each, in the spec's order. The sidebar's five entries
are visible in every image in this file, whichever page is showing.

| Destination | 980×760 | 900×700 |
|---|---|---|
| 125 kHz | `screenshots/shell-destination-125-khz-980.png` | `screenshots/shell-destination-125-khz-900.png` |
| 13.56 MHz | `screenshots/shell-destination-13-56-mhz-980.png` | `screenshots/shell-destination-13-56-mhz-900.png` |
| Library | `screenshots/shell-destination-library-980.png` | `screenshots/shell-destination-library-900.png` |
| Tools | `screenshots/shell-destination-tools-980.png` | `screenshots/shell-destination-tools-900.png` |
| Settings | `screenshots/shell-destination-settings-980.png` | `screenshots/shell-destination-settings-900.png` |

## The four message corners

| Corner | 980×760 | 900×700 |
|---|---|---|
| Top left | `screenshots/shell-corner-top-left-980.png` | `screenshots/shell-corner-top-left-900.png` |
| Top right | `screenshots/shell-corner-top-right-980.png` | `screenshots/shell-corner-top-right-900.png` |
| Bottom left | `screenshots/shell-corner-bottom-left-980.png` | `screenshots/shell-corner-bottom-left-900.png` |
| Bottom right | `screenshots/shell-corner-bottom-right-980.png` | `screenshots/shell-corner-bottom-right-900.png` |

Each of the eight is the same operation — Read tag, on the 125 kHz page, with the
fixture's written-once T5577 in the field — photographed after a corner was
chosen in Settings. The message is "Read 55 00 84 82 12." in all eight; what
changes is the corner.

## What the shell shows

- Five destinations, in the spec's order: **125 kHz · 13.56 MHz · Library ·
  Tools · Settings.** Drafts is not among them.
- Reader identity, status badge, firmware revision and the Connect/Reconnect
  control are in the sidebar below the navigation, visible on every page.
- No credits footer on any page; the credits are in Settings → About.
- The sidebar is exactly navigation and connection: no beep control in the
  footer (it is in Settings → Feedback).

### The shape this branch ships, re-checked in these images

- **Every switcher is a row of 4px-cornered chips, on one line, at both sizes.**
  Measured on the 125 kHz switcher at 980×760: each option is `border-radius:
  4px` and 26px tall. The two other switchers visible here — Settings' groups
  (four options) and Settings' Quiet level — are on one row at 900×700 too, and
  the corner control is the two-column grid that lays out the way the window
  does (top row first).
- **Every button is a 6px rectangle.** Measured at 980×760: `Reconnect`,
  `Read tag`, `Read the tag to clear` and `Destroy a tag instead` are all
  `border-radius: 6px`. The radius is one constant in `components/ui/Button`, so
  it does not change with the window. The one pill in the interface is the
  Toggle, which is on the Write confirmation (see `lf-write-confirmation-980.png`
  in [02](02-125-khz.md)).
- **The page uses the pane's full width at a 24px inset, with section rules
  reaching both edges.** Measured: the pane spans x=224–980 at 980×760 and
  x=224–900 at 900×700; the rule under the page header spans exactly that
  (756px and 676px wide), while the content it separates starts at x=248, which
  is the pane's left edge plus 24. The rule above Destroy *inside* the Clear
  panel is the other half of the rule: it stays at the inset,
  x=248–956 (980) and x=248–876 (900), so it divides the section rather than
  cutting the page.

## Observations

1. **Each corner does what it promises.** Every one of the four puts the message
   fully inside the window at both sizes, with the dismiss control reachable and
   the message never reflowing the page under it (`ToastViewport` renders outside
   the page flow, as designed).
2. **Top left covers the product name, at both sizes.** The top-left message sits
   over "PM4 Studio" and "NFC-PM4 reader". Expected — a corner is a corner — and
   the message clears itself in four seconds, so this is a note rather than a
   finding. (Previously recorded at 900×700 only; at 980×760 it does the same.)
3. **Bottom left lands on the sidebar's connection block.** At 980×760 it covers
   the firmware row; at 900×700 it covers the firmware row and the top edge of
   Reconnect. It is the one corner that lands on a control rather than on empty
   pane, and it is still not a finding for the same reason: the corner is the
   user's, and the message leaves in four seconds.
4. **Bottom right is empty pane on the 125 kHz Read page, at both sizes.** It is
   the default, and on this page it overlaps nothing. It does collide with a
   confirmation's own controls — see the observations in
   [02-125-khz.md](02-125-khz.md) and O1 in [08-findings.md](08-findings.md).
5. **Dev-only: React StrictMode double-invokes an effect.** The fixture's command
   log at launch shows `plugin:event|listen` twice, which is the subscription
   effect being run, torn down and run again on the dev server. A production
   build mounts once (and the fixture is not in it at all). This is the
   development build's behaviour, not the app's.

## What is fixture in these images

The Reader shown (`NFC-PM4`, serial `STUB00000001`, firmware `H00S07`) is fixture
data. `H00S07` is the revision shape `formatFirmwareRevision` expects, and the
product name is the string the app displays when a Reader is connected; none of it
is a claim about hardware. The Tag read in the corner images (`55 00 84 82 12`) is
the fixture's written-once T5577, and "Read 55 00 84 82 12." is the app's own
message for that read.
