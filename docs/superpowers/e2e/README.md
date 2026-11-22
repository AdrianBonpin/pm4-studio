# E2E: the redesign, seen at the sizes it ships at

**Ticket:** [20 — Verify the redesign visually and on hardware](../../tickets/studio-redesign/20-verify-the-redesign.md)
**Spec:** [Studio Redesign](../specs/2026-11-22-studio-redesign.md), "E2E: OPTED-IN" and the manual hardware checklist
**Method:** browser automation against the Vite dev server, with the Tauri invoke boundary stubbed
**Result:** the browser half is done; **the hardware half was not run.** See [the hardware checklist](../hardware-checklist-studio-redesign.md) and the honest split at the bottom of this file.

## What these screenshots are, and what they are not

Every image in `screenshots/` was taken from the app running with a **fixture
backend standing at the Tauri invoke boundary** (`src/dev/deviceStub.ts`). A real
Reader was not attached, and no tag, write, beep or LED in any of this is
observed. The fixture answers from values written down in the stub, taken from
recorded captures in `docs/PROTOCOL.md` where those exist and invented — and
labelled as invented — where they do not.

So these documents support exactly these claims:

- the layout at 980×760 and at the 900×700 minimum;
- that each destination, each mode and each confirmation *renders*;
- that no control's own label wraps onto a second line at the minimum size;
- that the seam turns an outcome into the chirp sequence the alphabet defines,
  where "chirp sequence" means the frames sent to the backend.

They support **none** of these:

- that a tag reads, a write lands, a refusal happens on real hardware, or that a
  beeper is audible. Every such claim is in the hardware checklist, unrun.

## How it was driven

- **Server:** `bun run dev` → Vite on **port 1420** (fixed, `strictPort`).
- **Entry point:** `http://localhost:1420/e2e.html`. That page loads
  `src/dev/e2e-main.tsx`, which installs the fixture before the app renders.
  `index.html` — the only input a production build has — never mentions it.
- **Viewports:** 980×760 and 900×700 (`set viewport <w> <h>`, device scale 1).
- **Field profiles:** the tag in the field is a query parameter, so a screenshot
  is reproducible — `?lf=source|blank|none`, `?hf=ntag|ntag-empty|ntag-dest|classic|unknown|none`.
- **Tag swaps:** the two flows that require a human to move a tag (Clone's "take
  the original off", Copy's observed removal) change the fixture through the
  stub's control surface, which is also reachable from a hidden panel
  (`Alt+Shift+D`) built for a person doing this by hand.
- **Clicks:** every interaction in the capture pass is a real click on a resolved
  accessibility ref, in the order a user would make it. Only the tag swap is
  scripted, because a stub cannot see a hand.

The capture pass is 135 steps per viewport; it ran 135/135 green at 980×760 and
135/135 at 900×700.

## The stub cannot ship — the mechanisms, and the proof

Two mechanisms, in two different places, because one mechanism with one failure
mode is what a build-config change can undo.

1. **Structural.** The stub is reachable only from `e2e.html`, and `vite build`
   reads `index.html` only. `src/main.tsx` does not import it, directly or
   transitively.
2. **Runtime.** `installDeviceStub` is handed `import.meta.env.PROD` and throws
   `DeviceStubInProductionError` rather than installing when that is true, leaving
   the page with **no** device boundary at all. Independently, `src/main.tsx`
   calls `assertNoFixtureBackend` before React renders; in a production build with
   the fixture marker present it paints a fatal notice and throws.

### Proof A — the stub is absent from the release bundle

`bun run build` → `dist/`, then:

```
$ grep -rl "PM4-STUDIO-VERIFICATION-DEVICE-STUB" dist/        # the stub module marker
ABSENT
$ for s in installDeviceStub e2e-main deviceFixture "04 43 8A 01 22 09 03" \
           "STUB00000001" "verification only"; do grep -c "$s" dist/assets/*.js; done
0 0 0 0 0 0
$ grep -c "PM4_DEVICE_FIXTURE_BACKEND" dist/assets/*.js
1
```

The single remaining occurrence is the **guard** in `src/lib/deviceBoundary.ts`,
which is in the shipped bundle on purpose: it is the half that still works if
somebody adds the second entry to the production build. String literals survive
minification, so "absent" means "not in the graph", not "renamed".

The real bundle was also loaded in a browser
(`screenshots/release-build-absent-fixture-980.png`): the shell renders with
`no reader / error / not connected`, `window.__TAURI_INTERNALS__` is absent, and
no fixture marker exists. It answers nothing, from nothing.

### Proof B — a release build that *did* reach the stub fails closed

To make the second mechanism observable rather than argued, a **production** build
was made whose input *was* `e2e.html` (a temporary Vite config outside the tree,
output outside the tree). It contains the stub chunk and the app chunk:

```
dist/assets/e2e-*.js    26.12 kB   ← the stub, in a production build
dist/assets/main-*.js  351.40 kB   ← the app
```

Loaded in a browser (`screenshots/release-build-stub-refused-980.png`), measured
in the page:

```
root text      "This build will not run. The 13.56 MHz and 125 kHz pages were
                drawn from a fixture build. This bundle carries the verification
                device stub, so it must not answer a device call at all: every
                reading it could show would be invented. Refusing to run."
notice         [data-device-boundary="fixture-in-release-build"], role="alert"
fixture flag   false
__TAURI_INTERNALS__   false
app rendered   false     ← the shell never mounts
```

That is the guarantee in full: a shipped build cannot contain the stub, and a
shipped build that contains it refuses to draw a single frame rather than answer
a device call from a fixture.

## The flow reports

| Area | Report | Screenshots |
|---|---|---|
| Shell, five destinations, four toast corners | [01-shell-and-corners.md](01-shell-and-corners.md) | 18 |
| 125 kHz: Read · Write · Clear · Clone · Batch | [02-125-khz.md](02-125-khz.md) | 18 |
| 13.56 MHz: Read · Write · Copy · Erase · Memory | [03-13-56-mhz.md](03-13-56-mhz.md) | 21 |
| Library: both collections, with and without a selection | [04-library.md](04-library.md) | 10 |
| Settings: four groups; Tools | [05-settings-and-tools.md](05-settings-and-tools.md) | 15 |
| The long-label sweep at the minimum size | [06-long-label-sweep.md](06-long-label-sweep.md) | — |
| Release-build proofs | [07-release-build-proof.md](07-release-build-proof.md) | 2 |
| Every finding, in one place | [08-findings.md](08-findings.md) | — |
| 13.56 MHz Write: the Draft list searched, emptied, cleared and chosen | [10-draft-list.md](10-draft-list.md) | 12 |

## The honest split

- **Ticked on this ticket:** the screenshot pair for every named surface; the
  no-wrap sweep at 900×700; the stub's absence from a release build and its
  fail-closed behaviour; the recording of every finding.
- **Not run, and not claimed:** criteria 3–7, which need a Reader and real tags.
  They are written out as a runbook with the exact steps and expected
  observations at [hardware-checklist-studio-redesign.md](../hardware-checklist-studio-redesign.md).
  Nothing in this directory is evidence for them.

One piece of *supporting* seam evidence is worth naming without overclaiming it:
a refused Reset in the browser sends exactly three `beep` frames and then one
`led_off` two seconds later, which is the attention symbol leaving the queue in
order. That is the app's bookkeeping. It says nothing about whether a buzzer
sounded, and criterion 5 remains unrun for that reason.
