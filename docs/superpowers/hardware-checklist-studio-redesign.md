# Manual hardware checklist — Studio Redesign

**Ticket:** [20 — Verify the redesign visually and on hardware](../../tickets/studio-redesign/20-verify-the-redesign.md), criteria 3–7
**Spec:** [Studio Redesign](specs/2026-11-22-studio-redesign.md), Testing Decisions → "The manual hardware checklist stays and grows by four items"
**Status: NOT RUN.** No Reader and no tags existed in the environment this
verification was written in, so every item below is unticked. The browser half is
in [`e2e/`](e2e/README.md) and claims nothing about hardware.

This is the runbook, not a report. Each item states the steps, the expected
observation in both channels, and what a failure would look like — so that the
person running it can tell "the app is wrong" from "the app is right and the tag
is odd".

## Before you start

- Reader: the PM4-class 125 kHz / 13.56 MHz reader the app targets, plugged in
  directly (no hub), macOS.
- Launch the **desktop app** (`bun run tauri:dev`, or a built app). **Not the
  verification build** (`e2e.html`) — that one answers from fixtures by design and
  proves nothing here.
- Settings → Feedback → quiet level **All**, so every symbol is audible.
- Settings → About → note the product, serial and firmware. Write them into the
  sign-off table; a result without the firmware revision it was taken on is worth
  less than one with it.
- The four symbols you are listening for (ADR 0009):

| Symbol | Count | Meaning |
|---|---|---|
| done | **1 chirp** | completed and confirmed good |
| needs you | **2 chirps** | completed, result needs checking |
| attention | **3 chirps**, then the **LED held on for two seconds** | failed or refused; nothing changed |
| silence | none | nothing happened — no tag latched, nothing to act on |

## 1. A 4-byte-UID MIFARE Classic 1K reads as itself — *(ticket criterion 3, spec item 8)*

**You need:** a MIFARE Classic 1K tag (4-byte UID; ATQA `04 00`, SAK `08`).

**Steps**

1. Go to **13.56 MHz → Read**.
2. Put the Classic on the Reader, flat and centred.
3. Click **Read tag**. Wait for the readout.
4. Then go to **13.56 MHz → Memory**, put the same tag on, click **Read memory**.
5. Then open **Settings → Diagnostics → Capability limits** and read the
   *MIFARE Classic sectors* entry.

**Expected observation**

- The UID is **four bytes** and is reported as itself (e.g. `XX XX XX XX`), not
  padded to seven or ten, and there is **no** "Not decoded" badge.
- Card type names a MIFARE Classic, not an Ultralight or an NTAG.
- **1 chirp** on the read (done). A tag whose memory could not be read is still a
  successful read of what the reply carried.
- Memory mode says it **cannot read the memory**, because sector access needs key
  authentication this protocol has no command for, and names **no family** in the
  dump — no "NTAG215", no invented 7-byte UID.
- The Capability limits *MIFARE Classic sectors* entry agrees with what you just
  saw.

**A failure looks like:** a seven- or ten-byte UID; a Classic reported as an NTAG;
the memory dump naming a family it cannot have resolved; a seven-byte UID built
from padding; or the read reporting "Not decoded" for a pair that is in the
published table.

| Result | ( ) pass ( ) fail — notes: |
|---|---|

## 2. A 7-byte-UID NTAG reads its full UID with no raw fallback — *(ticket criterion 3, spec item 9)*

**You need:** an NTAG21x tag (7-byte UID; ATQA `44 00`, SAK `00`).

**Steps**

1. **13.56 MHz → Read**, put the NTAG on, click **Read tag**.
2. Read the readout top to bottom, including the Records table.

**Expected observation**

- Seven UID bytes, all of them, no trailing `00 00 00` padding and no raw
  fallback.
- Card type names the **range** the ATQA/SAK pair covers (MIFARE Ultralight /
  NTAG21x), because that pair does not distinguish members. Naming a single member
  would be a guess, and a guess is a failure of this item.
- Capacity and NDEF status come from the memory read, stated as measured facts.
- If the tag holds a message: the Records table lists kind · summary · size ·
  valid, with a byte count. **1 chirp** (done).
- If the tag holds no message: the readout says the tag is formatted and empty,
  and **2 chirps** (needs you), because a raw/partial result is not a plain
  success.
- If the message could not be read: the UID is still shown, the reason is named,
  and the symbol is **2 chirps**, not 1 and not 3.

**A failure looks like:** a raw-only readout for an NTAG; a truncated UID; a
single member named for a shared pair; silence on a partial result; or a read
that reports success for a readout that says "could not be read".

| Result | ( ) pass ( ) fail — notes: |
|---|---|

## 3. Copy between two tags verifies — *(ticket criterion 4, spec item 10, first half)*

**You need:** two NDEF-capable tags, both empty or holding different messages.

**Steps**

1. **13.56 MHz → Copy**. Put the **source** on, click **Read source tag**. Note
   the message it held and how many Records.
2. Take the source **off**. Click **Check the field** and confirm it reports
   nothing latched. (If it complains the source is still there, that is the guard
   working; take the tag off and check again.)
3. Put the **destination** on. Click **Read destination tag**.
4. Read the confirmation: the destination, what it holds now, and the fit against
   its capacity. Confirm with **Copy to this tag**.
5. Wait for the result.

**Expected observation**

- The confirmation names the destination's current message and how many bytes it
  is, and how many of the destination's bytes the new message needs.
- On confirm: **1 chirp** (done), and a result that says the copy was verified by
  reading the whole message back and comparing the **Records in order** with the
  total encoded length.
- Re-reading the destination shows exactly the source's Records, in order.
- Silence is wrong here: nothing about this flow's completion is silent.

**Also, inside this item:** put the source back on and confirm the flow **refuses**
before anything is written, naming that the source is in the write position or was
not observed removed. A refusal is **3 chirps** with the held LED.

**A failure looks like:** a copy reported as verified whose read-back differs; a
"verified" that compared raw bytes and so fails on a tag that re-encodes; the
source being writable at any point; or a refusal that says "failed" instead of
naming the condition.

| Result | ( ) pass ( ) fail — notes: |
|---|---|

## 4. A copy onto an oversize destination is refused before anything is written — *(ticket criterion 4, spec item 10, second half)*

**You need:** a source message that is larger than a second tag's user memory —
e.g. a full NTAG215 message copied onto an NTAG213 (496 vs 144 bytes), or the
smallest tag you own.

**Steps**

1. **13.56 MHz → Copy**, read the source as above, remove it, check the field.
2. Put the **smaller** tag on and click **Read destination tag**.
3. Read the refusal and **do not** confirm anything.
4. Re-read the destination afterwards.

**Expected observation**

- The flow **refuses before writing**, names both numbers (what the message needs,
  what the tag has), and says nothing was written.
- **3 chirps** and the LED held for two seconds — a refusal is an attention signal,
  not a needs-you.
- The destination's message is unchanged when you read it again.
- **If the capacity genuinely cannot be determined**, the flow must not refuse
  outright and must not assume a fit: it states that the fit is unknown, shows the
  message size, and proceeds only on an explicit acknowledgement. Record which of
  the two behaviours your tag produced — they are different, and both are correct
  in their own case.

**A failure looks like:** any write reaching the tag; a partial write; a refusal
that does not name the sizes; a silent refusal; or an assumed fit reported as
verified.

| Result | ( ) pass ( ) fail — notes: |
|---|---|

## 5. A never-written tag resets; the same tag refuses the second time — *(ticket criterion 5, spec item 11)*

**You need:** a **fresh T5577** you can afford to lose, and patience. Read this
whole item before starting: the second half destroys the first half's evidence.

**Steps**

1. **125 kHz → Reset**. Put the fresh tag on, click **Read the tag to blank**.
2. Read the confirmation: it must state all three caveats — that this Reader
   cannot tell whether a tag will accept a write, that a tag already written once
   may refuse forever, that the attempt is safe only on a tag you can afford to
   lose.
3. Confirm. Watch and listen.
4. Re-read the tag (Read mode).
5. Put the **same** tag back on, Reset it again, confirm again. Watch and listen.
6. Re-read the tag once more.

**Expected observation**

- **First reset:** the tag reads as empty afterwards (no Identity). The outcome is
  worded as **blanked**, never as "verified". **1 chirp** (done) — and note that
  it is *one*, because nothing about this is uncertain.
- **Second reset:** *this tag will not accept writes*, with the likely cause
  named — the chip has already been written, or was never writable. **3 chirps**
  and the **LED held on for two seconds**. The tag is unchanged, and the app does
  not claim a copy.
- **A re-read after the refusal** shows the same Identity the tag had before the
  attempt at the second reset.

**A failure looks like:** the second reset reported as "failed" (which reads as
though the app broke rather than the chip refusing); as "unknown" (which invites
discarding a tag that may be fine); or as "blanked" (a lie); one chirp for the
refusal; no LED hold; or the app assigning the blame to the payload.

| First reset | ( ) blanked, 1 chirp ( ) other: |
|---|---|
| Second reset | ( ) will-not-accept-writes, 3 chirps + 2 s LED ( ) other: |
| Tag after the refusal | ( ) unchanged ( ) changed: |

## 6. A clone, a batch over several Blanks, and an authored Identity each report their own outcomes — *(ticket criterion 6)*

**You need:** one written 125 kHz source tag, and **three** Blank T5577s (or as
many as you can spare; two is a usable minimum).

**Steps — the guided Clone**

1. **125 kHz → Clone → Start clone.** Tap the source. Confirm the reading is the
   source's Identity. **1 chirp**, message names the original.
2. Remove the source. Tap a Blank. **1 chirp** for the reading of the write
   position, and the confirmation names **both** Identities: what will be
   replaced, and with what.
3. Confirm. Read back.

**Expected:** the write verifies and reads back as the source's Identity — **1
chirp**. Save to library if you want the copy counted.

**Steps — the Batch**

4. **125 kHz → Batch → Read the tag to copy.** Tap the source once. **1 chirp.**
5. For each Blank: put it on the Reader, click **Write the blank on the reader**,
   then take it off. Watch and listen **per attempt**.

**Expected per attempt:**

| What you did | Expected message | Expected symbol |
|---|---|---|
| A fresh Blank | verified, count rises | **1 chirp** |
| The same tag left on | skipped, nothing written, count does not rise | **2 chirps** |
| Nothing readable on the Reader | refused, nothing written | **3 chirps**, LED held 2 s |
| A tag that takes nothing | failed or unknown, count does not rise | **3 chirps** (failed) / **2 chirps** (unknown) |

Nothing about an attempt is silent: every attempt is a user-started operation.

**Steps — an authored Identity**

6. **125 kHz → Write.** Type customer `85`, facility `132`, card `33298`. Click
   **Preview the Identity**.
7. Confirm the preview shows `55 00 84 82 12`, facility 132, card 33298 — the
   bit layout is the Rust codec's, and the form must not re-derive it.
8. Click **Read the tag, then write**, put a Blank on, confirm, write.

**Expected:** the write verifies, the read-back is shown as the evidence, **1
chirp**. If the tag in the write position already presents that Identity, the
button is **disabled** and the app says "Refused: the tag already carries
55 00 84 82 12" — ADR 0001's guard, running before any confirmation exists. That
state is a pre-emptive guard rather than a started operation, so expect **no
sound**; if you hear one, record it, because a symbol for something the user never
started is its own defect.

**A failure looks like:** a batch attempt with no message and no sound; two
attempts coalescing into one line; the writer at the end of a batch rejoining the
confirmation for a tag that is no longer there; a write that reports "verified"
without a read-back; or a count that rises for a skip.

| Clone | ( ) pass ( ) fail: |
|---|---|
| Batch, 3 Blanks | attempts: __ verified, __ skipped, __ refused — notes: |
| Authored Identity | ( ) pass ( ) fail: |

## 7. The four symbols are distinguishable by ear, and the gap is recorded — *(ticket criterion 7)*

**You need:** a quiet room, the beeper audible, and nothing else to do for five
minutes.

**Steps**

1. **Settings → Diagnostics → Beep `0x53`.** Press it five times, spaced out. This
   is one chirp and nothing else — learn its length.
2. Produce a **2-chirp** symbol: a 13.56 MHz poll that decodes to nothing (put an
   unlisted tag on, or a tag the decoder rejects) — the readout says "Not decoded"
   and the symbol is needs-you. Alternatively a write reported as unknown.
3. Produce a **3-chirp** symbol: a refused Reset (item 5). Watch the LED.
4. Alternate 1, 2 and 3 at least ten times, from memory, calling the count before
   looking at the screen.
5. Then judge the **gap**: are two chirps unambiguously two, or does a fast double
   blur into one longer sound? If it blurs, the constant to change is
   `CHIRP_GAP_MS` in `src/lib/chirpSequence.ts` (**currently 120 ms**, nominal, per
   the spec's open question), and the value that works is what this item records.

**Expected observation**

- Twelve out of twelve counts correct, without looking.
- 1 and 2 clearly different; 2 and 3 clearly different; 3 followed by a visible
  two-second LED hold that survives a loud room.
- Silence is recognisable as silence: an empty field produces no sound at all.

**Record here — this is the value the spec's open question asks for:**

| Tuned `CHIRP_GAP_MS` | ______ ms (nominal 120) |
|---|---|
| 1 vs 2 distinguishable | ( ) yes ( ) no |
| 2 vs 3 distinguishable | ( ) yes ( ) no |
| 3 + 2 s LED usable in a loud room | ( ) yes ( ) no |
| 20-attempt batch still intelligible | ( ) yes ( ) no — this is the spec's batch-intelligibility open question |

**A failure looks like:** 2 and 3 merging into one burst; a beep that arrives
after the screen has already told you the result by more than a moment; a symbol
that sounds for a background operation (connect, firmware query, autosave, the
poll loop) — any of those is a bug, since silence means nothing happened; or an
attention signal with no LED hold.

## Sign-off

Fill this in only with what you observed. An unticked item is worth more than a
guessed tick: the whole point of this checklist is that no test in the repository
can answer it.

| Item | Result | Reader firmware | Date | Initials |
|---|---|---|---|---|
| 1. Classic 1K, 4-byte UID, memory dump names no family | not run | | | |
| 2. NTAG, 7-byte UID, no raw fallback | not run | | | |
| 3. Copy verifies by Records comparison | not run | | | |
| 4. Oversize destination refused before writing | not run | | | |
| 5. Fresh reset blanks; second reset refuses (3 chirps + LED) | not run | | | |
| 6. Clone, batch, authored Identity report their own outcomes | not run | | | |
| 7. Four symbols distinguishable; `CHIRP_GAP_MS` recorded | not run | | | |

## What a completed checklist then licenses

Only what it observed. A pass on item 1 does not license 13.56 MHz Copy on a tag
family nobody tried; the spec's open questions stay open until a tag settles them:

- whether a 10-byte-UID tag is latched at all, and whether its length byte reads
  `0x0A` (the decoder supports the width; the *claim* needs a tag);
- whether a password-protected 13.56 MHz destination can be told from a read-only
  one — Copy must report the merged condition until a tag proves otherwise;
- the real duration of one firmware chirp, and therefore the final `CHIRP_GAP_MS`;
- whether a per-attempt batch signal stays intelligible past about ten attempts.
