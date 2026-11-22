# 01 — The shell, its five destinations, and the four message corners

**Ticket criterion:** screenshots at 980×760 and at the 900×700 minimum for the
shell with all five destinations, and a message in each of the four corner
settings.

**Method:** for each corner — Settings → Feedback → the corner control → back to
125 kHz → Read tag. The message is produced by a real operation after the corner
is chosen, so what is photographed is the stored setting doing its work, not a
positioned box.

| Corner | 980×760 | 900×700 |
|---|---|---|
| Top left | `screenshots/shell-corner-top-left-980.png` | `screenshots/shell-corner-top-left-900.png` |
| Top right | `screenshots/shell-corner-top-right-980.png` | `screenshots/shell-corner-top-right-900.png` |
| Bottom left | `screenshots/shell-corner-bottom-left-980.png` | `screenshots/shell-corner-bottom-left-900.png` |
| Bottom right | `screenshots/shell-corner-bottom-right-980.png` | `screenshots/shell-corner-bottom-right-900.png` |

## What the shell shows

- Five destinations, in the spec's order: **125 kHz · 13.56 MHz · Library ·
  Tools · Settings.** Drafts is not among them.
- Reader identity, status badge, firmware revision and the Connect/Reconnect
  control are in the sidebar below the navigation, visible on every page.
- No credits footer on any page; the credits are in Settings → About.
- The sidebar is exactly navigation and connection: no beep control in the
  footer (it is in Settings → Feedback).

## Observations

1. **Each corner does what it promises.** Every one of the four puts the message
   fully inside the window at both sizes, with the dismiss control reachable and
   the message never reflowing the page under it (`ToastViewport` renders outside
   the page flow, as designed).
2. **Top left covers the product name.** At 900×700 the top-left message sits
   over "PM4 Studio" in the sidebar header. Expected — a corner is a corner — and
   the message clears itself in four seconds, so this is a note rather than a
   finding.
3. **The bottom-right default can sit over a confirmation's own controls.** See
   `lf-reset-confirmation-900.png`: the success message covers part of "Keep the
   tag as it is". Recorded in [08-findings.md](08-findings.md) as an observation.
4. **Dev-only:** the fixture backend is asked for `connect` and `library_load`
   twice at launch because React's StrictMode double-invokes effects on the dev
   server. That is the development build, not the app: a production build mounts
   once (and the fixture is not in it at all).

## The Reader identity in these images

The Reader shown (`NFC-PM4`, serial `STUB00000001`, firmware `H00S07`) is fixture
data. `H00S07` is the revision shape `formatFirmwareRevision` expects, and the
product name is the string the app displays when a Reader is connected; none of it
is a claim about hardware.
