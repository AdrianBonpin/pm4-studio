# Studio Redesign — feedback, settings, and a layout that survives five tag operations

**Baseline:** aff5eff10d74a7545a37207fa55133818adde1fb   **Branch:** feat/studio-redesign   **Date:** 2026-11-22

## Problem Statement

PM4 Studio can do more than it can say. It reads and writes 125 kHz Identities,
clones them in batches, authors them by hand, blanks tags, reads 13.56 MHz UIDs
and NDEF messages, writes and erases messages, and dumps memory. Almost none of
that announces itself.

**It is silent when it matters most.** Nine of roughly thirty user-visible
operations make a sound, and the sound is identical for all of them. Nothing
makes any sound on failure. The listener's only signal that an operation went
wrong is to read the screen. Every 13.56 MHz write, erase, copy and memory read
is completely silent. Worse, the one signal that does exist fires after a
13.56 MHz poll even when the decode failed, so a success tone accompanies a
warning badge.

**Every page is one long column.** Operations are stacked vertically in the order
they were written, not in the order they are used. 125 kHz is five stacked
sections and about three screens of scroll to reach the last one. 13.56 MHz is
five stacked sections plus roughly six hundred words of explanation, one block of
which — an entire section on why the decode is provisional — exists only because
of an offset hypothesis that has now been refuted. The user's words: *"too much
text"*, *"utilize space better as its currently just plain top to bottom"*.

**The pages are ordered against the task.** On 125 kHz the guided Clone wizard is
first, ahead of reading a tag, though reading is both the base capability and the
precondition every write depends on. On 13.56 MHz the diagnostic surfaces sit
between the readout and the operations. A functional but wrapping control — a
"New Draft" button next to a full-width input — is the visible symptom of a
layout nobody sized for its contents.

**Errors have nowhere to go.** There is no notification channel. Errors surface
through four unrelated mechanisms: a shell notice strip for device failures, a
library-lock banner, per-component local state that disappears the moment you
navigate away, and one-line notes. An error raised in the memory panel is
invisible from the library. Nothing survives leaving the page.

**Drafts and Library are the same mistake twice.** Both are single columns where
the list and the thing you selected share the page. Editing a Draft puts the
Records editor below an unrelated read-a-tag panel, so the thing you came to edit
is the third block down. Drafts also carries the only NDEF reading surface in the
app, which is why NDEF appears to live in a tab of its own.

**The settings do not have a home.** The beep toggle sits in the sidebar footer
next to the Connect button and is disabled whenever the Reader is unplugged, for
a value that is stored locally and has nothing to do with the Reader. Credits
occupy a footer on every page. There is no way to clear saved data, no version
number visible anywhere, and no link to the project.

**And one capability was offered that could never work.** Blanking reported *"the
tag still reads as 55 00 84 82 12 after the blanking write, so it was not
blanked."* Nothing in the app could have predicted that. The Reader's 125 kHz
read reply carries no chip family and no writability flag, so a T5577 already
written once — which that tag is, written by this project's own early probe — is
indistinguishable from a fresh T5577 or from a read-only EM4100. The app offered
an irreversible operation it had no way to qualify, and then reported the
consequence as though it were a surprise.

## Solution

The capability set does not change, with two deliberate additions. What changes
is that the app says what it is doing, arranges itself in the order the work
happens, and stops implying knowledge it does not have.

**One outcome, two channels, no gaps.** Every operation the user starts ends in
exactly one typed outcome, reported through a single seam. A toast shows it; the
Reader's beeper sounds it. Neither can be produced without the other, so an
operation that forgets to report is a visible structural gap rather than a
silence. Background and automatic work — connecting, the firmware query,
autosave, the poll loop — reports nothing.

**An audible alphabet that distinguishes failure from success.** One chirp means
*done*. Two mean *needs you* — the operation completed but the result wants
checking. Three mean *attention* — it failed or was refused, and nothing changed;
the LED is held on for two seconds so the message survives a noisy room. Silence
means *nothing happened*. Silent versus distinct-from-success is the whole point:
today a failure and a success sound the same. A three-way quiet level replaces the
on/off switch, so *errors and warnings only* is a real daily setting and *off* is
still possible.

**One operation visible at a time.** The two band pages become mode-switched
workspaces with a segmented control, ordered by the work: 125 kHz is **Read ·
Write · Reset · Clone · Batch**; 13.56 MHz is **Read · Write · Copy · Erase ·
Memory**. Selecting a mode shows that mode and nothing else. This is what
removes the scroll, and it is also what makes per-operation feedback tractable:
every operation has a name, an entry point, and therefore an outcome.

**Collections get two panes.** Library becomes a master-detail surface holding
two collections — Snapshots and Drafts — with the list beside the editor. Editing
a Draft puts its Records next to the list, never below an unrelated panel. Drafts
stops being a top-level tab, which dissolves the "why is NDEF in its own tab"
question: reading a 13.56 MHz tag now shows its Records inline, and *Edit as
Draft* turns a read message into an editable Draft.

**Settings has a home.** A fifth destination holds Feedback (quiet level, beep
test, toast corner), Data (library path, export and import, clear all saved
data), About (version, credits, GitHub, licence, Reader and firmware), and
Diagnostics (indicator test, capability limits). Tools keeps only the raw
console, because ADR 0006 makes that surface deliberately visible and honest.

**The app stops pretending to know what a 125 kHz tag will accept.** Reset keeps
its capability — it demonstrably works on a fresh T5577 — and says plainly that
the first write is the test: a tag already written once may permanently refuse,
this Reader cannot tell which it is, and the attempt is safe only on a tag you can
afford to lose. A refusal becomes its own outcome, *this tag will not accept
writes*, with the cause named. No probe is offered, because every possible probe
is a write, and the only non-destructive-looking one — writing a tag's own
Identity back to it — is the operation this project already identifies as the
chip-locker.

**And the decode stops being provisional, because it was measured.** A capture
from two tag families refuted the documented offsets and produced a
self-describing layout. The provisional badge and its explanatory section are
deleted, and 7-byte and 10-byte UIDs become supported instead of falling back to
raw bytes.

Delivery is five ordered slices.

## User Stories

**Design language and agent instructions**

1. As a maintainer, I want the impeccable design skill vendored in the repository, so that any contributor or agent gets the same rules on a fresh clone.
2. As a maintainer, I want the repository to state that impeccable is the binding design vocabulary, so that a UI change is held to a standard rather than a preference.
3. As a maintainer, I want the product's intent and its design tokens written down where the skill reads them, so that the vocabulary is applied to this app rather than to a generic one.
4. As a maintainer, I want a command that reports design-rule violations, so that the rules are measurable rather than aspirational.
5. As a maintainer, I want that command to block once the redesign has landed, so that the patterns removed here cannot quietly return.
6. As a maintainer, I want the design check to fail loudly when it cannot run, so that a missing tool is never mistaken for a passing result.
7. As a user, I want no control to wrap onto a second line, at any window size the app allows, so that the interface looks deliberate.
8. As a user, I want no message to be announced only by a coloured bar down one side of a box, so that the notice style stops being a generic container.

**Shell and navigation**

9. As a user, I want five destinations — 125 kHz, 13.56 MHz, Library, Tools, Settings — so that every surface has an obvious home.
10. As a user, I want the current Reader, its status and its firmware permanently visible, so that I can tell a hardware problem from an app problem without navigating.
11. As a user, I want Connect and Reconnect reachable from anywhere, so that replugging the Reader does not require finding the right page.
12. As a user, I want the page footer that repeated the credits on all five pages removed, so that the content area is the content.
13. As a user, I want Drafts to stop being a top-level destination, so that "Library" means everything I have saved and nothing I have not.
14. As a user, I want a mode I leave and return to be the mode I come back to within a session, so that checking something else does not cost my place.

**Outcomes, toasts and alerts**

15. As a user, I want every operation I start to end in a visible message, so that I never have to guess whether it finished.
16. As a user, I want a successful operation to say so briefly and get out of the way, so that success does not compete for attention with failure.
17. As a user, I want a failure to stay on screen until I dismiss it, so that walking away does not lose the reason it failed.
18. As a user, I want a warning to linger longer than a success but still clear itself, so that "check this" is noticed without becoming permanent furniture.
19. As a user, I want to choose which corner messages appear in, so that they do not cover the thing I am working on.
20. As a user, I want at most three messages stacked, with the rest counted rather than listed, so that a batch operation cannot bury the screen.
21. As a user, I want to dismiss a message from the keyboard, so that I do not have to hunt for a target with a mouse.
22. As a user, I want a message to be read by a screen reader without stealing my focus, so that the app stays usable without sight.
23. As a user, I want a device failure to appear as a message rather than as a strip that pushes the page down, so that the layout does not jump when the cable is loose.
24. As a user, I want a repeated identical outcome to be coalesced, so that twenty successful batch writes do not produce twenty stacked messages.
25. As a user, I want conditions that stay true — a library file I cannot write to, a migration warning, an invalid Record, a pending confirmation — to remain inline where they belong, so that a permanent condition does not fire a transient message.
26. As a user, I want to be told when a read-only limitation of the build refused my action, distinguished from a refusal about the tag in front of me, so that I know whether to change the frame or reseat the tag.

**The audible signal**

27. As a user, I want one chirp when an operation completes and is confirmed good, so that I can work without looking at the screen.
28. As a user, I want two chirps when the operation finished but the result needs checking, so that "done" and "done, but verify" are different sounds.
29. As a user, I want three chirps when an operation failed or was refused, so that a failure is unmistakable.
30. As a user, I want no chirp at all when nothing happened — no tag in the field, nothing latched — so that silence means "there was nothing to do" rather than "the app broke".
31. As a user, I want the LED held on for two seconds after an attention signal, so that I can see a failure in a loud room or with headphones on.
32. As a user, I want the same alphabet on both bands and on every operation, so that I learn it once.
33. As a user, I want every operation on the 13.56 MHz page to signal, so that the silent band stops being silent.
34. As a user, I want a 13.56 MHz poll that decodes to nothing to signal *needs you* rather than *done*, so that a raw fallback does not sound like success.
35. As a user, I want the batch clone to signal each attempt, so that I hear which fob worked without reading a list.
36. As a user, I want connecting, the firmware query, autosave and the background poll to stay silent, so that the app is not chirping at nothing.
37. As a user, I want a three-way quiet level — off, errors and warnings only, all — so that "silent except failures" is possible without losing failures entirely.
38. As a user, I want the quiet level to be changeable with the Reader unplugged, so that a stored preference does not depend on hardware being present.
39. As a user, I want a beep test in Settings, so that I can confirm the beeper works without running an operation.
40. As a user, I want signals fired in quick succession to play out in order rather than overlapping into noise, so that a batch run stays intelligible.

**Settings**

41. As a user, I want the beep controls out of the sidebar footer and in Settings, so that the sidebar is navigation and connection, not preferences.
42. As a user, I want to choose the message corner, so that the default does not have to suit everyone.
43. As a user, I want to see the app version, so that I can report which build a problem happened on.
44. As a user, I want a link to the project's repository, so that I can find the code, the issues and the releases.
45. As a user, I want the protocol credits and the licence named in one place, so that the reverse-engineering this app stands on is acknowledged without repeating on every page.
46. As a user, I want the Reader product, manufacturer, serial and firmware in Settings, so that hardware detail is available without cluttering the working pages.
47. As a user, I want the library file's location shown with a control to reveal it in the file manager, so that I can back it up myself if I want to.
48. As a user, I want export and import to live with the other data actions rather than on the browsing page, so that the library page is for finding things.
49. As a user, I want to clear all saved data in one action, so that handing the machine on or starting over is possible.
50. As a user, I want that action to require typing a word, so that it cannot be triggered by a stray second click.
51. As a user, I want it to tell me exactly what it removed, so that I know whether my Snapshots, my Drafts and my preferences are gone.
52. As a user, I want clearing data to touch nothing outside the app's own storage, so that no other part of my machine is at risk.
53. As a user, I want the Reader capability limits listed in one place, so that I stop being shown disabled controls on every tag.
54. As a user, I want an indicator test for the Reader's beeper and LED in Diagnostics, so that a hardware problem is diagnosable.

**125 kHz**

55. As a user, I want the 125 kHz page ordered Read, Write, Reset, Clone, Batch, so that the page follows the order I actually work in.
56. As a user, I want only the selected operation visible, so that I do not scroll past four things to reach the fifth.
57. As a user, I want reading a tag to be the first thing on the page, so that the precondition for every write is also the first step.
58. As a user, I want the Identity, facility code and card number shown large enough to read across a desk, so that confirming which credential I hold takes no effort.
59. As a user, I want the raw payload available but not in the way, so that verifying a decode I do not trust is possible without costing space on every read.
60. As a user, I want to save a read to the library in one action and be told it was saved, so that keeping a credential is not a separate trip.
61. As a user, I want to author an Identity from customer, facility and card values, or from a raw five-byte value, so that both mental models work.
62. As a user, I want out-of-range entries refused with the valid range shown, so that I cannot write a malformed Identity.
63. As a user, I want the guided Clone to require the source tag be removed before the Blank is written, so that I cannot overwrite my own credential.
64. As a user, I want a refused clone to say *why* it refused, so that a reseated tag is distinguishable from a guard firing.
65. As a user, I want to write one Identity to successive Blanks without re-reading the source, so that making several fobs is not repetitive.
66. As a user, I want each batch attempt reported separately, so that I know which fob succeeded.
67. As a user, I want Reset described as Reset, so that I am not led to expect a factory restore the hardware cannot perform.
68. As a user, I want to be told before a Reset, in plain words, that a tag already written once may permanently refuse further writes, that this Reader cannot tell which kind it is, and that the attempt is safe only on a tag I can afford to lose.
69. As a user, I want a refused Reset to be reported as *this tag will not accept writes*, with the likely cause named, so that I am not told the tag is unchanged as though nothing can be concluded.
70. As a user, I want the app to stop offering a pre-check for writability, because no such check exists, so that I do not go looking for one.
71. As a user, I want the blame for a refused write never assigned to the payload, so that I do not try again with the same tag.
72. As a user, I want the 125 kHz page to stop carrying a section that only points at another page, so that the last thing on the page is an operation.

**13.56 MHz**

73. As a user, I want the 13.56 MHz page ordered Read, Write, Copy, Erase, Memory, so that operations come before troubleshooting.
74. As a user, I want a single Read action to report the UID, the card type, the capacity, the NDEF status and the Records, so that one tap answers the whole question.
75. As a user, I want a Read whose Records could not be fetched to still show the identity it did get, and to say why the Records are missing, so that a partial result is neither hidden nor dressed up as complete.
76. As a user, I want a 7-byte UID decoded, so that an NTAG stops being an unreadable blob.
77. As a user, I want a 10-byte UID to follow the same layout rather than be rejected out of hand, so that a tag I have not been able to test is not second-class by construction.
78. As a user, I want the card type, capacity and technologies presented as measured facts, so that the provisional badge and its explanatory section are gone.
79. As a user, I want an ATQA/SAK pair that matches no published assignment to show raw bytes and no family, so that the app never presents a guess as a fact.
80. As a user, I want the NDEF Records listed as rows — kind, summary, size, validity — so that a message is scanned rather than read as prose.
81. As a user, I want to turn a read message into an editable Draft in one action, so that editing what is on a tag does not require a separate trip to another page.
82. As a user, I want to write a Draft to a tag having been shown exactly what will be replaced, so that I consent knowingly.
83. As a user, I want a write whose read-back cannot confirm it reported as unknown rather than failed, so that I do not discard a tag that may be correct.
84. As a user, I want to copy one tag's whole NDEF message onto another tag, so that duplicating a message is not a manual two-step.
85. As a user, I want Copy to require the source tag be removed before anything is written to the destination, so that I cannot overwrite the tag I am copying from.
86. As a user, I want Copy to show the destination's current message before replacing it, so that I know what I am losing.
87. As a user, I want Copy's result verified by reading the whole message back and comparing it, so that "copied" means observed.
88. As a user, I want Copy to refuse a destination that is read-only or password protected with an outcome that says which, so that I am not left guessing.
89. As a user, I want Copy to refuse a message that will not fit the destination's capacity, before writing anything, so that a partial write cannot happen.
90. As a user, I want to erase a tag's NDEF content, so that I can reuse it.
91. As a user, I want Erase to keep saying that an erased tag is still a tag, so that I do not expect it to become Blank.
92. As a user, I want a memory dump available as a diagnostic, so that I can inspect a tag the decoder does not recognise.
93. As a user, I want to export a memory dump to a file, so that I can compare captures across sessions.
94. As a user, I want the memory dump to stop labelling an unrecognised tag by family, so that a MIFARE Classic is not reported as an NTAG.
95. As a user, I want the password panel gone from the band page and its absence recorded once among the capability limits, so that a permanently unavailable control stops occupying half a screen.
96. As a user, I want the unexplained bytes in the reply documented rather than filled in, so that I can trust the parts that are explained.

**Library and Drafts**

97. As a user, I want Library to show a list beside the selected item, so that choosing something does not push the thing I am editing below other content.
98. As a user, I want Snapshots and Drafts as two collections of one page, so that everything I have saved is in one place and still clearly two different kinds of thing.
99. As a user, I want to see which collection I am in and switch in one click, so that the distinction stays visible.
100. As a user, I want a Draft's Records editor beside the list, so that it is never below an unrelated panel.
101. As a user, I want a 13.56 MHz read savable as a Snapshot including its Records, so that an HF read is as durable as a 125 kHz one.
102. As a user, I want a saved HF Snapshot usable offline, so that the library works with no Reader attached.
103. As a user, I want to write a Snapshot's Records back to a tag, so that a saved message is reusable rather than merely readable.
104. As a user, I want to rename a Snapshot or Draft in place, so that fixing a hasty name does not require a dialog.
105. As a user, I want deleting a Snapshot or a Draft to take a second, deliberate confirmation, so that neither is lost to a stray click.
106. As a user, I want to search and sort Snapshots, so that the library stays usable as it grows.
107. As a user, I want the library to stay interactive at five hundred Snapshots, so that keeping records does not make the app slow.
108. As a user, I want an empty state that explains what a Snapshot is and what a Draft is, so that an empty library is not a blank screen.
109. As a user, I want an explicit "no Draft selected" state, so that the right pane never looks broken.

**Data, migration and errors**

110. As a user, I want my existing library to survive this change intact, so that an upgrade costs me nothing.
111. As a user, I want a library file written by a newer build refused rather than rewritten, so that opening an old build cannot destroy my Drafts.
112. As a user, I want a library file that fails to parse reported and left untouched, so that a recoverable file is never replaced with an empty one.
113. As a user, I want my existing beep preference carried into the new quiet level, so that upgrading does not silently change what I hear.
114. As a user, I want a Reader unplugged mid-operation to produce a clear message and a clean state, so that I can replug and continue.
115. As a user, I want an operation that wedges the Reader to name the remedy — a physical replug — rather than leaving the interface waiting.
116. As a user, I want every operation to have a bounded wait and its own failure, so that nothing hangs indefinitely.
117. As a user, I want a write that fails verification to leave the write count unchanged, so that counts mean confirmed copies.
118. As a user, I want clearing saved data to be refused rather than half-done if any part cannot be removed, so that I am never left in an ambiguous state.
119. As a user, I want the app to explain once, in one place, which things this Reader cannot do, so that I am not shown the same limitation on every page.

## Constraints & Non-Negotiables

**Stack and platform**

- macOS only. No Windows or Linux build, packaging or testing in this work.
- Tauri 2, React 18, TypeScript, Vite, bun, Rust with `hidapi`. No new runtime dependency.
- impeccable is a **development-only** dependency. It must not be present in the shipped bundle, must not be in the runtime dependency graph, and must not introduce a network call into the app. Its first-use engine download is a developer-machine concern only.
- impeccable is Apache-2.0: its `LICENSE` and attribution are retained with the vendored files.
- NDEF encoding and decoding stay implemented in-repo. The supply chain stays small.
- The existing gridline design system remains the incumbent visual world: its tokens, its Space Mono and Outfit pairing, no overscroll, minimum window 900×700. impeccable's own guidance defers to a committed world, so its defaults do not override these tokens.
- impeccable and gridline genuinely conflict in one place. impeccable's craft floor bans monospace used as costume rather than for code, data or measurement; gridline sets Space Mono on headings as well as on data. Gridline wins, and the design detector therefore carries a checked-in allow-list with one entry per rule the incumbent world overrides, each carrying a one-line reason. An allow-list entry without a reason fails the gate — an unexplained suppression is how a rule set dies.
- No control wraps onto a second line at any supported window size. This is a gate, not a review habit.

**Safety invariants (unchanged, not overridable by any setting)**

- Never write without a successful read of the tag in the write position. ADR 0001.
- Never write when the tag in position already presents the target Identity. ADR 0001.
- The 125 kHz write payload is always exactly 24 bytes.
- Every write is preceded by a confirmation naming what will be replaced.
- A write whose read-back fails is reported as *unknown*, never as success and never as a definitive failure.
- The raw console sends only commands that cannot alter a tag, in release builds. ADR 0006. Tools stays a visible destination so that this honesty is not buried.
- **New:** no same-Identity write is ever offered as a diagnostic. See ADR 0007.
- A write that fails verification leaves the write count unchanged, and a refusal of any kind never counts as a confirmed copy. ADR 0004.
- The beep is never the sole report of an outcome, and a beep failure may never convert a success into an error.

**Feedback constraints**

- A signal is never the only channel: every audible outcome has a visible counterpart. A user with the beeper off, or no hearing, loses nothing.
- Signals never gate an operation. A beep failure is swallowed and cannot turn a success into an error.
- The beep frame is fire-and-forget and unacknowledged by the firmware. The app must never claim a beep was heard.
- Signal sequences are serialised; two signals from concurrent operations do not interleave into an unintelligible run.
- The alphabet is count-and-gap only. No pitch or duration is claimed, because the hardware exposes none.

**Data**

- The library remains local plaintext JSON in the app data directory. No cloud sync, no telemetry, no analytics, no network calls.
- Library writes are atomic and pass through one serialisation domain.
- A new persisted key bumps the schema version, and migration is eager on first successful open and preserving of every key. ADR 0005.
- A library file with an unrecognised or newer schema version is never rewritten.
- Clear-all-data resolves exactly two targets: the known library file path and this app's own preference keys. It accepts no path from input, follows no symlink, and refuses rather than partially completing.
- Snapshots and Drafts remain distinct collections with distinct mutability. A Snapshot is never edited except for its name and note.

**Honesty**

- A capability is presented as working only where it is verified. The HF reply layout is now verified by capture and may be presented as measured; the bytes it does not explain stay documented as unexplained.
- The app never offers a check it cannot perform. In particular, 125 kHz writability is stated as unknowable before a write.
- Every claim the app makes about a tag is either measured from the reply or explicitly marked as unavailable.

**Responsiveness**

- Every page's selected mode is reachable in one click with no scrolling at 900×700.
- The library list stays interactive at 500 Snapshots.
- No operation blocks the window for longer than one protocol transaction, and every device operation has a bounded wait.

## Boundaries

**In scope**

- The impeccable skill vendored, referenced from a new repository `AGENTS.md`, with the product and design context it reads written down, and a design check that becomes blocking in the final slice.
- The five-destination shell; Settings as Feedback, Data, About and Diagnostics.
- The outcome seam, the toast system, the four-symbol audible alphabet and the three-way quiet level.
- 125 kHz as a mode-switched page: Read, Write, Reset, Clone, Batch, with Reset's honest framing and its new refusal outcome.
- 13.56 MHz as a mode-switched page: Read, Write, Copy, Erase, Memory.
- The corrected and verified HF reply layout, including 4-, 7- and 10-byte UIDs.
- One-action Read that also fetches the NDEF message.
- Copy of a whole NDEF message between 13.56 MHz tags, with capacity and protected-tag refusal.
- Library as a master-detail surface with Snapshots and Drafts collections; 13.56 MHz Snapshots including Records; schema version 3 with migration.
- Edit-as-Draft from a 13.56 MHz readout.
- Removal of the Drafts destination, the read-a-tag-into-a-draft panel, the password panel, the sidebar beep toggle, the per-page credits footer, and the 125 kHz page's Library pointer section.
- Corrections to `PROTOCOL.md`'s reply-layout table and `GLOSSARY.md`.

**Out of scope**

- Any change to the protocol command set, the frame format, or the write commands.
- MIFARE Classic sector authentication, sector read or write. The protocol exposes no key authentication command; a Classic tag remains unreadable at the block level and the app must say so rather than appear to fail.
- Locking a tag permanently read-only, and formatting a tag to non-NDEF.
- 13.56 MHz password set and remove. The panel is removed and the capability recorded as unavailable.
- Transparent APDU passthrough, and therefore Signature, authenticated NFC counter and password-protection status.
- Writing a T5577 configuration block, and therefore a true factory restore.
- Recovering a tag locked by a previous write or by an unknown password.
- A writability probe of any kind. ADR 0007.
- Windows and Linux targets.
- Any network, sync or multi-device feature.
- Brute force, key recovery or credential cracking.
- Retrofitting a light theme. The use scene is a desk at night; dark stays.

## Implementation Decisions

**Agent-facing artifacts**

The repository gains an `AGENTS.md` at the root that does three things and no more: it names the vendored skill's location and instructs that it be loaded for any UI or UX work; it states the binding constraints that must not be traded away (the gridline tokens above impeccable's defaults, no nested cards, no decorative badges, no copy that restates the obvious, no message announced only by a coloured side bar); and it points at the product and design documents the skill reads. The rule tree itself is not copied into `AGENTS.md`, because a vendored skill is a versioned artifact and duplicating it invites drift.

The product intent and the design contract are written as the two documents the skill reads on every command, so that the vocabulary is applied to this app rather than to a generic one. The design document records the gridline tokens as the committed world and names the specific refusals this app holds itself to.

The design check runs impeccable's deterministic detector over the component sources. It is exposed as a package script, is advisory while the redesign is in progress, and becomes blocking in the final slice. If the detector cannot run — engine missing, download failed, binary absent — the check fails loudly; a tool that is not there is never a pass.

**The outcome seam**

One typed value describes what an operation did, and it is the only input both channels accept. Its discriminator is a small closed set derived from the existing write-outcome vocabulary plus the new Reset refusal, and it carries the message text and an optional structured detail. Severity is a property of the outcome, not of the call site, so a toast and a signal cannot disagree.

`report(outcome)` is the single entry point. Components never invoke the beeper and never construct a toast directly. The seam fans out to the toast store and the signal queue. An outcome that is informational rather than the result of an operation — a stored-preferences announcement — may pass a flag that suppresses the signal, and that is the only way a signal can be absent for a reported outcome.

**The audible alphabet**

| Symbol | Meaning | Emitted for |
|---|---|---|
| 1 chirp | **Done** | operation completed and confirmed good |
| 2 chirps | **Needs you** | completed, result needs checking: unverified write, raw-only decode, a mode waiting for the next step |
| 3 chirps | **Attention** | failed, refused, or the tag will not accept the write; nothing changed |
| silence | **Nothing happened** | no tag latched, nothing to act on — not an error |

Gaps between chirps are a tuned constant, 400 ms, measured by ear on hardware — the 120 ms first written here ran two chirps together, so *needs you* was indistinguishable from *done*; the actual chirp duration is firmware-controlled and unknown to the host. On an Attention signal the LED is turned on for two seconds and then off. Signals are queued and played in order; the queue holds eight, drops the oldest rather than blocking, and coalesces identical adjacent outcomes.

The three silent outcomes are distinct and must not be conflated. A poll that latched nothing produces **silence**, because there was nothing to act on. A poll that latched a tag the decoder then rejected produces **needs you**, because something happened and it needs a look. A read loop signals once, on the reading that completes it, not on every iteration — the iterations are background work, the completion is the operation.

The quiet level is three-way and stored locally: **Off**, **Errors and warnings only**, **All**. The pre-existing boolean preference migrates — on becomes All, off becomes Off. The control is available with the Reader disconnected.

**The toast model**

Toasts carry event outcomes. Inline text keeps conditions: a library that cannot be written to, a migration warning, per-Record validation, form ranges, and every confirmation prompt. That split is the decision — an event can be transient, a condition cannot.

Corner is a stored setting with four positions, default bottom-right. Dismissal is by severity: success and informational clear at four seconds, warnings at eight, and errors persist until dismissed or until the same operation later succeeds. Timings carry a one-second tolerance and are injected in tests rather than waited on. At most three are visible; older ones collapse into a count rather than being silently dropped. Every toast is dismissible from the keyboard, none takes focus, and each is announced politely. Identical outcomes arriving in quick succession coalesce into one with a repeat count.

A refusal caused by the build — the release console's read-only allow-list — and a refusal caused by the tag in position are different messages and must remain distinguishable, as they already are today. One says to change what you are sending; the other says to reseat or replace the tag.

The shell's device-failure strip becomes a toast. The library-lock banner and the migration warning stay inline because they describe a state the user is in, not something that just happened.

**Navigation and page shape**

Five destinations. The two band pages share a segmented-control workspace: one mode visible at a time, the previously selected mode remembered for the session. Library is master-detail: a collection switch for Snapshots and Drafts, a list, and the selected item's detail beside it. Settings is a leaf with four groups. Tools is a single page holding the raw console and nothing else.

The mode order is the work order and is not alphabetical or historical: 125 kHz is Read, Write, Reset, Clone, Batch. 13.56 MHz is Read, Write, Copy, Erase, Memory. The capability limits live in Settings → Diagnostics so that a limitation is stated once rather than repeated per tag.

**The 13.56 MHz memory-dump mode is named `Memory`, not `Diagnostics`.** Round 4 settled the order as Read, Write, Copy, Erase, Diagnostics, and Settings was separately settled to contain a Diagnostics group. Both cannot keep the name: a user told to look in Diagnostics would have two destinations to try, and the capability limits — the thing that answers "why can this Reader not do that" — would be the harder of the two to find. Settings keeps `Diagnostics` because that group already holds the indicator test and the limits. The band mode is named for what it holds.

No page is capped at a single narrow column any more. Prose keeps a readable measure; a collection's list-and-detail and any table use the full content width. The single `max-w-3xl` column that every page inherited is why the pages had nowhere to put a second pane.

**Read on 13.56 MHz**

One action performs a poll and then a records read, and presents one readout. The two transactions are separate and either can fail; the readout always shows what was obtained and states why anything is missing. A tag whose family is not NDEF-capable reports that rather than offering a records read that cannot work. A reply that cannot be decoded shows raw bytes and the reason and offers no records read.

The dependency on capacity and NDEF status resolves the way it does today: capacity from the published table where the pair determines it, otherwise from the Capability Container of the memory read, otherwise stated as not determined. NDEF status comes from the records or memory read, never from the poll.

**The verified HF reply layout**

Two captures from two families refute the previous offsets and establish this layout. The expected ATQA and SAK values below come from the published specifications for those families, which is what makes this a measurement rather than a fit.

```
MIFARE Classic 1K  UID 31 F3 0E 0A
  01 01 31 F3 0E 0A 00 00 00 00 00 00 │04│ 04 00 │08│ 01 10 00
NTAG215            UID 04 43 8A 01 22 09 03
  01 01 04 43 8A 01 22 09 03 1D 00 20 │07│ 44 00 │00│ 02 00 00
```

| Bytes | Meaning | Status |
|---|---|---|
| 0 | `0x01` — a tag is latched; anything else means no tag | verified, two families |
| 1 | `0x01` — constant | verified, two families |
| 2–11 | UID buffer, ten bytes, zero-padded beyond the length | verified, two families |
| 12 | UID length in bytes: `04`, `07`, or `10` | verified, two families |
| 13–14 | ATQA in transmission order; `04 00` → `0x0004`, `44 00` → `0x0044` | verified, two families |
| 15 | SAK; `0x08` → MIFARE Classic 1K, `0x00` → NTAG21x | verified, two families |
| 16 | Cascade level count — `01` for a 4-byte UID, `02` for a 7-byte UID | consistent with both captures, not established |
| 17–18 | Unexplained | documented as unknown |

Bytes 6–11 were previously documented as part of an eight-byte "unconfirmed tail" and are in fact stale buffer residue: the same reader returned different values for them across captures of the same tag, and returned zeros when the buffer was clean. A layout that reads them as tag data will report debris as content.

The length byte is what makes the layout self-describing, and it is why 7- and 10-byte UIDs become decodable rather than falling back to raw. The decode reads ATQA and SAK from fixed positions, which the two families both confirm.

**Nothing outside the decode may claim a family.** The memory-dump surface currently labels a tag `NTAG215` and reports a seven-byte UID of `31 F3 0E 0A 00 00 00` for a MIFARE Classic 1K, because it pads the UID buffer to a width it guessed and takes a family name from a read that failed. A memory dump that cannot read the tag at all — which is the always-case for MIFARE Classic, since its memory needs sector authentication this Reader has no command for — must say that, and must not name a family it has not resolved. The dump's job is evidence, and evidence that volunteers a conclusion is not evidence.

Because the layout is now measured, the prediction in the previous work — that the reply carried a two-byte validity prefix followed by the UID at 2–6 with ATQA at 14–16 and SAK at 17 — is recorded as refuted, and the provisional badge and the section explaining it are deleted rather than moved.

**Reset and writability**

Reset writes the neutral Identity over whatever the tag presents; the existing guard already permits this because the target differs from the current reading. The confirmation states, in plain words and before the write, that the app cannot determine whether a tag will accept a write, that a tag already written once may refuse permanently, and that the attempt is safe only on a tag the user can afford to lose.

A re-read that still finds an Identity produces a distinct outcome — *this tag will not accept writes* — whose message names the likely cause: the chip has already been written, or was never writable. That is separated from the generic failure outcome and from *unverified*, because the three call for different next actions. No confirmed copy is ever counted for any of them.

No writability probe is built. Every candidate probe is a write: one that changes the tag is destructive by definition, and the only one that does not change content writes the tag's own Identity back to it, which is precisely the ordering this project identifies as having permanently locked a T5577. The capability limits state that 125 kHz writability cannot be determined without attempting a write, so the absence is a documented limit rather than a missing feature.

**Copy on 13.56 MHz**

Copy is a first-class 13.56 MHz operation, distinct from Clone. The distinction survives because they verify differently: a Clone is confirmed by comparing an Identity, a Copy by comparing a whole message, and the two have different failure modes.

The flow: read the source tag's NDEF message and hold it; require that the source be removed and observe that no tag is latched; require a destination tag and read its current message; show what will be replaced and how many bytes it is; check the candidate message against the destination's known capacity and refuse before writing if it does not fit; confirm; write; read the message back and compare it against what was written; report the outcome.

The comparison is on the **decoded Records in order**, together with the total encoded length — not on raw bytes. A tag may legitimately re-encode a message it accepts, and a byte comparison would report a correct copy as a failure, which is the one outcome worse than an honest unknown.

Capacity comes from the card-type table where the ATQA/SAK pair determines it, and otherwise from the Capability Container via a memory read performed as part of the flow. If it still cannot be determined, Copy does not refuse outright and does not assume a fit: it states that the fit is unknown, shows the message size, and proceeds only on an explicit acknowledgement. Refusing outright would make Copy unusable on the common NTAG case; assuming a fit is the silent-truncation failure this work exists to remove.

Copy is built and presented as a working capability once it passes the manual checklist. A 10-byte-UID destination is a structural case the decoder supports; it is not claimed as hardware-verified until a 10-byte tag has actually been copied.

Refusals are specific and separate from failures: source not covered by the observed-removal step, destination unreadable, destination read-only, destination password protected, message too large for the destination. Each names which condition fired. Where the hardware cannot distinguish two of those conditions — read-only and password-protected may be indistinguishable while the password commands remain unavailable — the app reports the merged condition and says it cannot tell them apart, rather than picking one.

**Library and collections**

Snapshots and Drafts remain separate collections with separate mutability; they share a page and a layout, not a list. A Snapshot carries an optional 125 kHz Identity or an optional 13.56 MHz reading, and the 13.56 MHz reading now includes its Records. Drafts keep their own collection, reached from the same collection switch.

Writing a Draft to a tag and writing a Snapshot's Records to a tag are the same operation with different provenance, and both go through the same confirmation and verification path.

The read-a-tag-into-a-draft panel is removed. Reading a 13.56 MHz tag produces the message inline, and *Edit as Draft* creates a Draft from it, switches Library to the Drafts collection, and opens that Draft in the detail pane. That is one path in; writing to a tag is one path out. The action does not exist on a readout whose Records could not be fetched, because there is nothing to copy.

**Settings surface**

Feedback holds the quiet level, a beep test, and the toast corner. Data holds the library file's location, export and import, and clear-all-saved-data. About holds the version, the credits, the repository link, the licence, and the Reader's product, manufacturer, serial and firmware. Diagnostics holds the indicator test and the capability limits.

The version has exactly one authoritative source and a test that fails if the other two build manifests disagree with it. Three manifests carry a version today and they happen to match at 0.2.0; "they agree" is not a mechanism and will not survive the next release.

Clear-all-saved-data is gated by typing the word `clear`. It enumerates its two targets explicitly, reports what it removed, and refuses rather than completing partially if any part cannot be removed.

**Slice order**

This work spans six independent subsystems. The slices below are the split: each is shippable and exercisable on its own, and no slice contains work from more than one subsystem except where a shared seam is its whole purpose.

| Slice | Delivers | Blocked by |
|---|---|---|
| 1 Foundation | impeccable vendored, AGENTS.md and the product and design documents, Outcome seam, toast system, signal alphabet, quiet level, Settings, five destinations | — |
| 2 Library | master-detail, Snapshots and Drafts collections, 13.56 MHz Snapshots with Records, schema v3 and migration, read-a-tag-into-a-draft removed, Edit as Draft | 1 |
| 3 125 kHz | mode-switched page, Read, Write, Reset honesty and its new refusal outcome, Clone, Batch, Library pointer removed | 1 |
| 4 13.56 MHz | mode-switched page, verified decode with 4/7/10-byte UIDs, one-action Read with NDEF, Copy, Erase, Memory, password panel removed | 1, 2 |
| 5 Close-out | design check blocking, screenshots of every page at both sizes, manual hardware checklist extended and run | 2, 3, 4 |

Slices 3 and 4 are independent of each other and may land in either order. The hardware captures that settled the reply layout are already in hand, so slice 4 carries no external dependency.

**Removals**

The Drafts destination, the read-a-tag-into-a-draft component, the 13.56 MHz password panel, the sidebar beep toggle, the per-page credits footer, the 125 kHz Library-pointer section, the provisional badge and its explanatory section, and the `onChirp: () => void` shape across every component are all removed. Removal is the decision, not a side effect: each is a surface whose absence is the fix.

Removing the password panel enforces rather than withdraws a promise. Both password commands always refuse because the capability is unimplemented, and the app's own honesty rule says a capability is presented as supported only once it is verified. A panel that exists to explain why it cannot be used is the rule being broken in the most expensive way available.

## Testing Decisions

**Approved seams**

Unchanged: **frame codec and stream reassembly**, **identity codec**, **write guard**, **card type resolver**, **NDEF codec**, **vocabulary guard**.

| Seam | Catches | Misses |
|---|---|---|
| **HF decoder** (extended) | offset regressions, ATQA byte order, UID length, 4/7/10-byte widths, length-mismatch fallback, treating residue bytes as content | a future firmware revision changing the layout — only a fresh capture settles that |
| **Library store** (extended) | v3 migration, key preservation, version stamping, newer-file refusal, atomic replace, both collections round-tripping | crash durability beyond the existing atomic-write coverage |
| **Write outcome classification** (extended) | blanked versus will-not-accept-writes versus unverified versus failed; no confirmed copy on any refusal | *why* the chip refused |
| **Confirmation gates** (extended) | every destructive control still asks, including the new clear-data gate and the Copy confirmation | — |
| **Outcome seam** (new) | an operation with no outcome; toast and signal disagreeing on severity; a signal emitted for a background operation | whether the buzzer physically sounded |
| **Signal vocabulary** (new, pure) | wrong chirp count per outcome, alphabet regressions, interleaving of concurrent sequences, queue bound behaviour | chirp duration and audibility — empirical, tuned on hardware |
| **Toast store** (new) | dismissal timing per severity, error persistence, the three-toast cap, coalescing of identical outcomes, corner setting | honest screen-reader behaviour; jsdom approximates announcements |
| **Copy guard** (new, pure) | source not removed, destination unreadable or identical to the source, message larger than the destination, undetermined capacity treated as sufficient | chip-level lock or password state — only hardware settles that |
| **Clear-data scope** (new) | exactly which paths and keys are resolved, that no path comes from input, that a partial removal refuses, that the report matches what was removed | real filesystem behaviour outside a temporary directory |
| **Visual gate** (new) | design-rule regressions, wrapped controls, layout at the minimum window, mode switching, two-pane structure | taste, and anything the rule set does not encode |

**What a good test looks like here**

Tests assert public behaviour through the seam, with expected values written down independently. For the HF decoder that means the two captured payloads recorded above as fixtures, asserted against ATQA and SAK values taken from the published specifications — not values the implementation produced. For the signal vocabulary that means an outcome in, a chirp sequence out, with the sequence written in the test rather than derived from the mapping under test. For the copy guard that means a decision in, a decision out, with no device involved.

No test mocks an internal collaborator. The pure seams take values and return values; the library store takes a path; the toast store takes outcomes and a clock. Where hardware is required, the test is a scripted probe whose output is treated as a finding — the two captures in this document came from exactly that instrument.

The existing DOM harness is kept and extended: components render with the device boundary stubbed at the invoke boundary, not by mocking internal modules. Every destructive confirmation keeps its pair of proofs — dismissing leaves the target intact, confirming performs the action.

**Prior art**

Rust unit tests against captured frames already cover the frame layout, the checksum and the identity write payload. The probe and capture binaries under the Rust examples are the instrument that produced the two payloads in this document and remain the model for any future measurement. The jsdom component harness already proves seven destructive gates. Extending each of those patterns is preferred over introducing a new one.

**E2E: OPTED-IN**

Browser automation against the Vite dev server, used for visual verification only. The Tauri invoke boundary is stubbed in the browser so every page renders with no Reader; that is sufficient to check layout, density, wrapping, mode switching and the two-pane structure, and it is not sufficient to check any device behaviour. This does not reverse the earlier hardware opt-out, which stands: nothing about a tag, a write or a beep is claimed from a browser.

The stub exists only for the development and verification path. It must be excluded from the production bundle, and a release build must fail rather than degrade if it is reached — a shipped app that silently answers device calls from a fixture would be the single worst outcome this specification could produce.

Critical flows to capture at both 980×760 and the 900×700 minimum:

1. The shell with all five destinations, and a toast in each of the four corner settings.
2. Each of the five 125 kHz modes, including a readout, a confirmation, and the Reset confirmation carrying its new caveats.
3. Each of the five 13.56 MHz modes, including a decoded readout with the Records table, a raw-only fallback, and the Copy confirmation.
4. Library in both collections, with nothing selected and with an item open in the detail pane.
5. Settings, all four groups.
6. Tools.
7. A long-label sweep: every control at the minimum width, asserting nothing wraps.

The manual hardware checklist stays and grows by four items:

8. Read a MIFARE Classic 1K and confirm it reports MIFARE Classic 1K with a 4-byte UID, and that the memory dump does not claim a family it cannot support.
9. Read a 7-byte-UID NTAG and confirm the full UID with no raw fallback.
10. Copy a message between two tags and confirm the read-back comparison, plus a refusal on a destination that is too small.
11. Reset a fresh T5577: it reports *Blanked*, one chirp, and counts no copy. Then Reset the same tag again: it refuses **before transmitting**, reporting that the tag already carries no Identity — that is *nothing to blank*, three chirps, and it is a different outcome from *will not accept writes*. The *will not accept writes* outcome needs a chip that refuses a transmitted write while still reading an Identity back, and no tag has produced one yet; it stays unobserved until one does. **Measured 2026-11-22:** the all-zero blank payload leaves a T5577 locked — still latched and modulating, still refusing data — so Reset destroys rather than clears. See `docs/PROTOCOL.md` and `docs/tickets/studio-redesign-followups/clearing-a-tag-must-leave-it-usable.md`.

## Migration & Rollback

**Schema.** The library file moves from version 2 to version 3 because Snapshots gain the Records of a 13.56 MHz read. Per ADR 0005 the bump is mandatory: a new persisted key is a schema change and a schema change bumps the version. Migration runs eagerly on the first successful open and preserves every key, so the file's stated version agrees with its contents immediately rather than at the next save. A v2 file opened by this build becomes v3 in place. A v3 file opened by any older build is refused, not rewritten. A file that fails to parse is reported and left untouched; a failed migration write is reported and the app continues with the migrated library in memory.

**Preferences.** The existing boolean beep preference migrates to the quiet level — on becomes *All*, off becomes *Off* — and the old key is not reused for the new shape. The toast corner is new and defaults to bottom-right. No preference is read before it is migrated, so a first launch under the new build has one defined state.

**Existing library content.** Every existing Snapshot survives unchanged. A 125 kHz Snapshot keeps only its Identity. A 13.56 MHz Snapshot gains an empty Records list rather than a null, so that "no records" and "not fetched" are not confused.

In practice a v2 file contains no 13.56 MHz Snapshots at all, because nothing in the build that wrote v2 could create one — the store exposed only the 125 kHz save path, so the existing `hf` field was never reachable. Migration therefore adds defaults rather than transforming readings. Should a hand-edited v2 file nonetheless contain one, its fields that the new shape expects and the old shape never held are left absent and rendered as unavailable, never filled with a plausible value.

**Rollback.** This is the one place the honest answer is uncomfortable. Reverting the app after a v3 file has been written does **not** work by reinstalling: the older build refuses the file rather than stripping it — which is correct, and is the protection added in ADR 0005 — so it opens with no library at all. A rollback therefore requires exporting the library first under the new build, or deleting the library file to return to an empty one. No safety regression accompanies the rollback: the write guard, the 24-byte payload invariant and the fail-closed ordering are all untouched, and removing the redesign restores the app to exactly the capability and safety posture it had at the baseline. The Reset capability is preserved with better copy; the only capability withdrawn is the password panel, which never functioned.

**Rollback of the design gate.** The design check becoming blocking is the last thing to land. Reverting that single change restores a non-blocking check without touching product behaviour.

## Domain Model

**ADR 0007 — a 125 kHz tag's writability is only discoverable by writing, and the app never offers a probe.** Hard to reverse because it is a commitment not to build something users will ask for repeatedly. Surprising without context because the obvious response to "the blank didn't take" is to check first. A genuine trade-off: writability can be learned in advance, but only by performing a write, and the only write that leaves content unchanged is the same-Identity write this project identifies as the chip-locker. Consequences: Reset is documented as the test; the refusal gets its own outcome; the capability limits state the limit; ADR 0001's same-Identity refusal is unchanged.

**ADR 0008 — every operation reports through one seam that drives both the visible message and the audible signal.** Surprising because the fastest way to add a beep is to call the beeper, which is exactly how the app arrived at nine beeps out of thirty operations with no failure tone anywhere. A real trade-off: ad-hoc calls are more flexible and less coupled; a single seam makes coverage a property of the structure rather than of discipline. Consequences: components no longer receive a chirp callback; an operation that reports nothing is a structural gap; the two channels cannot disagree about severity.

**ADR 0009 — the audible alphabet is one, two, three or silence.** Surprising because "short and long" is the obvious vocabulary and the hardware cannot express it. A real trade-off between a count alphabet, a rhythm alphabet that collapses into the count alphabet, and no alphabet at all. Consequences: the four symbols are fixed, silent means nothing happened, the LED amplifies attention signals, and changing the alphabet later is a breaking change to learned behaviour.

**ADR 0002 is now fully discharged.** The gate it placed on 13.56 MHz writing is cleared by hardware evidence that predates this work; Copy extends an already-permitted surface. Recorded so that the gate is not re-litigated.

**No new ADR for the schema bump.** ADR 0005 already states the rule; this work applies it.

**Glossary changes.**

New terms:

- **Outcome** — what one operation did, as a closed typed value. The single input to both the visible message and the audible signal. _Avoid_: result, status, response, event.
- **Signal** — the audible report of one Outcome: one, two or three chirps, or their absence. _Avoid_: beep, chirp, tone, alarm, sound.
- **Toast** — the transient on-screen report of one Outcome, in a chosen corner. _Avoid_: notification, alert, banner, snackbar, popup.
- **Copy** — moving a whole NDEF message from one 13.56 MHz Tag to another. _Avoid_: clone, duplicate, transfer, backup.
- **Writability** — whether a 125 kHz Tag will accept a write. Not observable by reading and not exposed by the protocol; discoverable only by attempting a write. _Avoid_: blankness, lock state, write protection.
- **UID length** — the byte in the 13.56 MHz poll reply that states how many bytes of the UID buffer are real. _Avoid_: UID size, uid_len, width.
- **Diagnostics** — the read-only inspection surface in Settings: the capability limits and the indicator test. The 13.56 MHz memory-dump mode is not called Diagnostics, so that "look in Diagnostics" has exactly one destination. _Avoid_: tools, debug, advanced, inspect.
- **Collection** — one of the Library's two kinds of saved thing: Snapshots or Drafts. _Avoid_: tab, section, category, type.
- **Quiet level** — the three-way audible feedback preference: off, errors and warnings only, all. _Avoid_: beep toggle, mute, volume.

Amended terms:

- **Reset** gains: Reset is the only way to discover whether a 125 kHz Tag will accept a write; no cheaper test exists. Its _Avoid_ line gains "blank" as a verb.
- **Clone** loses its "out of scope for now" counterpart. Copy is now in scope, and the distinction is recorded as a relationship rather than a boundary.
- **Erase** keeps its 13.56 MHz-only meaning, and now explicitly notes that the word is never used for a 125 kHz operation.

Narrowed:

- "Provisional" was never a glossary term; it was an interface label for a decoded 13.56 MHz reading whose offsets had never been measured. The offsets are now measured against two tag families, so the label and the section explaining it are deleted rather than moved, and the word must not be reused for a claim that is still a guess.
- The flagged ambiguity about "clone" being used for both Identity and message copying is closed by putting both back in scope with distinct names: Clone is Identity, Copy is message.
- A new flagged ambiguity is recorded for "diagnostics", which meant both the 13.56 MHz memory-dump mode and the Settings group. Resolved: the mode is **Memory**, the Settings group is **Diagnostics**.

**Relationships added**

- An **Outcome** reports one operation and produces exactly one **Toast** and at most one **Signal**.
- A **Signal** is made of one to three chirps.
- A **Copy** consumes one 13.56 MHz source Tag's NDEF message and one destination Tag's current message.
- A **Snapshot** may hold one 13.56 MHz reading including its Records, or one Identity, never both.
- A **Collection** holds either Snapshots or Drafts, never both in one list.

## Open Questions

| Question | Owner | Must resolve before |
|---|---|---|
| What bytes 16–18 of the 13.56 MHz poll reply mean. Byte 16 tracks the cascade level count on both captures, which is consistent but not established. | Protocol research with a third tag family, ideally a 10-byte-UID one | Anything is claimed about those bytes. Until then they are documented as unexplained and never interpreted. |
| Whether a 10-byte-UID tag is latched by this Reader at all, and whether its length byte reads `0x0A`. | Hardware capture with such a tag | 10-byte UID support is claimed as tested. The decoder must support the width regardless; only the manual checklist entry is gated. |
| The real duration of one firmware chirp, and therefore the gap constant that makes one, two and three chirps distinguishable by ear. | Tuning on hardware, first hand | The alphabet is signed off as usable. Measured at 400 ms; the nominal 120 ms first recorded here was too short to separate one chirp from two. |
| Whether a 13.56 MHz destination that is password protected can be distinguished from a read-only one, given the password commands are unavailable. | The Copy slice, against hardware | Copy claims to name which condition fired. If it cannot distinguish them, it must report the merged condition rather than guess. |
| Whether the impeccable detector's engine download can be made deterministic in CI, or whether the gate must run only on developer machines. | Maintainer, when the gate becomes blocking | The final slice turns the gate on. If CI cannot fetch the engine, the gate is a documented local pre-merge step instead. |
| Whether the batch-clone per-attempt signal stays intelligible past about ten attempts, or whether coalescing becomes necessary in practice. | Observation during the 125 kHz slice | Sign-off of the Batch mode. The decision is recorded as per-attempt with a coalescing fallback. |

**Process note for the rest of this workstream.** Routine subagents in the planning and orchestration phases use `opencode-go/deepseek-v4.1-flash` rather than the ollama-hosted default, at the user's direction, for this work only. Architecture, trade-offs and this document stayed on the session model.
