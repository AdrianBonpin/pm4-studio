# 07 — The release build: absence, and failing closed

**Ticket criterion:** "The device stub is provably absent from a release build."

This report is the proof of mechanism, not a screenshot of a page. Two mechanisms
answer the criterion, and each is proved separately. The full account is in
[README.md](README.md#the-stub-cannot-ship--the-mechanisms-and-the-proof); this is
the evidence record.

## Mechanism 1 — the stub is not in the release bundle

`bun run build` builds `index.html` → `src/main.tsx` and nothing else. The stub is
reachable only from `e2e.html` → `src/dev/e2e-main.tsx`. The stub module carries a
string that appears nowhere else (`STUB_MODULE_MARKER =
"PM4-STUDIO-VERIFICATION-DEVICE-STUB"`), and string literals survive minification,
so its absence is evidence of absence rather than evidence of renaming.

```
$ bun run build
dist/index.html                     0.48 kB
dist/assets/index-*.js            374.60 kB
dist/assets/index-*.css            34.38 kB

$ grep -rl "PM4-STUDIO-VERIFICATION-DEVICE-STUB" dist/
(no output — ABSENT)

$ grep -c "installDeviceStub"   dist/assets/index-*.js   0
$ grep -c "e2e-main"            dist/assets/index-*.js   0
$ grep -c "04 43 8A 01 22 09 03" dist/assets/index-*.js  0   # the NTAG fixture UID
$ grep -c "STUB00000001"        dist/assets/index-*.js   0   # the fixture Reader serial
$ grep -c "verification only"   dist/assets/index-*.js   0   # the panel's own caption
$ grep -c "PM4_DEVICE_FIXTURE_BACKEND" dist/assets/index-*.js   1
```

That last `1` is the **guard**, `src/lib/deviceBoundary.ts`. It is in the shipped
bundle deliberately: it is the half of the guarantee that still works if the second
entry point is ever added to a production build.

The real bundle was also loaded in a browser, outside Tauri
(`screenshots/release-build-absent-fixture-980.png`):

```
fixture marker            false
window.__TAURI_INTERNALS__ false
shell rendered            true, with "no reader / error / not connected"
```

The shipped build renders, finds no backend, and says so — an error message about a
missing invocation, no invented tag, no fixture. (Observation, not a defect: that
message is a raw `TypeError: Cannot read properties of undefined (reading
'invoke')`. The shipped artifact is a Tauri window, where the boundary is always
installed, so this string is only reachable by opening the built HTML in a plain
browser.)

## Mechanism 2 — a release build that reached the stub fails closed

Arguing that a build "could not" reach the stub is not the same as showing what
happens if it does. So a **production** build was made whose input was `e2e.html`
— a temporary Vite config, written outside the repository and deleted afterwards,
with its output outside the repository:

```
dist/assets/e2e-*.js    26.12 kB   ← the stub, inside a production build
dist/assets/main-*.js  351.40 kB   ← the app
```

Served and loaded in a browser (`screenshots/release-build-stub-refused-980.png`),
measured in the page:

```
root text          "This build will not run. The 13.56 MHz and 125 kHz pages were
                    drawn from a fixture build. This bundle carries the verification
                    device stub, so it must not answer a device call at all: every
                    reading it could show would be invented. Refusing to run."
notice             [data-device-boundary="fixture-in-release-build"], role="alert"
fixture marker     false      ← the stub refused to install, so there is nothing to
__TAURI_INTERNALS__ false       answer from and no boundary to answer on
app rendered       false      ← the shell never mounts; not one frame of interface
```

Both mechanisms are the same decision made twice: **an app that cannot reach a
Reader must look like an app that cannot reach a Reader**, never like one that has
one. The stub is only ever an instrument for looking at layout.

## Keeping it true

Two tests hold the runtime half, so it cannot rot silently:

- `src/dev/deviceStub.test.ts` — a production build refuses to install, leaves no
  boundary, and says why on screen; a development build installs, answers, and
  rejects an unscripted command loudly.
- `src/lib/deviceBoundary.test.ts` — a production build with a fixture present
  throws and leaves the notice; a production build without one renders; a
  development build ignores the fixture.

The structural half is a property of `vite.config.ts`'s single entry point. A
future change that adds `e2e.html` to the build inputs would not ship a silent
fixture — it would ship one that refuses to run, which is the outcome this was
designed to make recoverable.
