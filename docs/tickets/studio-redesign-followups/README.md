# Studio Redesign — follow-ups

Findings recorded by [ticket 20 — Verify the redesign](../../superpowers/e2e/08-findings.md)
that were **not** fixed there. Ticket 20's contract is verification: it records what
it finds and does not absorb a defect silently into itself, and it does not edit
the twenty tickets that are the record of what was claimed.

Each ticket below has the same shape as the ones in
`docs/tickets/studio-redesign/`: what to build, what it is blocked by, the seams it
lands on and what those seams miss, the tracker, a status, and acceptance criteria.

| Ticket | Severity | Delivers |
|---|---|---|
| [The capability limits contradict the app](the-capability-limits-contradict-the-app.md) | high | Diagnostics stops telling the user that NDEF is unavailable and that long UIDs are raw, in a build that does both |
| [Copy refuses a destination that holds no message](copy-refuses-a-destination-that-holds-no-message.md) | high | Copy works onto the empty tag that is the ordinary destination for a copy |
| [Clearing a tag must leave it usable; destroying it must be its own action](clearing-a-tag-must-leave-it-usable.md) | high | Reset stops consuming tags: Clear leaves a live rewritable chip, and Destroy is the deliberate all-zero write |
| [Reset's refusal was never seen, and a blanked tag may stop answering](resets-refusal-was-never-seen-on-hardware.md) | high | Ticket 12's central claim is observed on hardware, and the app stops promising a blanked tag still reads |
| [Device commands run on the main thread](device-commands-run-on-the-main-thread.md) | high | A slow, wedged or absent Reader cannot freeze the window, and no new command can reintroduce it |
| [The Erase confirmation is taller than the window](the-erase-confirmation-is-taller-than-the-window.md) | medium | Erase's own buttons are on screen at 900×700, and its copy is worth reading |
| [Reset is called "Blank" in its own panel](reset-is-called-blank-in-its-own-panel.md) | low | The operation has one name, the one the glossary gives it |

## Not filed, and why

- **The default bottom-right message corner can cover a confirmation's own control
  at 900×700.** Recorded as observation O1 in
  [08-findings.md](../../superpowers/e2e/08-findings.md). A corner is where the user
  put it, the message clears itself in four seconds, and choosing another corner is
  one click. If a future pass reserves a strip for messages, this is the reason to.
- **Values wrap mid-token in the Memory panel** (`04 9A 2B 3C 4D 5E 60` and the
  read timestamp at 980 px). Observation O2. Values rather than controls, so the
  no-wrap gate is untouched; it is polish.
- **In a plain browser the release bundle reports `TypeError: Cannot read
  properties of undefined (reading 'invoke')`.** Observation in
  `docs/superpowers/e2e/07-release-build-proof.md`. The shipped artifact is a Tauri
  window where the boundary is always installed, so this string is only reachable by
  opening the built HTML outside the desktop shell — a place no user runs it.
