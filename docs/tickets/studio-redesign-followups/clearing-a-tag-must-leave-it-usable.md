# Clearing a tag must leave it usable; destroying it must be its own action

**What to build:** Two different actions where there is one today. **Clear** gives a
tag no usable identity and leaves it a live, rewritable chip. **Destroy** is the
current all-zero write, kept for tags you genuinely want gone, behind its own
harder gate and described for what it does.

**Naming, decided during implementation:** the mode and the everyday action are
**Clear**; "Reset" is retired from the interface entirely. The mode is not called
Clear while its action is called something else — one name, on the pill, the panel
heading, the buttons and the outcome.

**Cause, measured on hardware 2026-11-22.** The current Reset writes the neutral
Identity — customer `0x00`, data32 `0x00000000`. On a factory T5577 that write
lands (the tag stops presenting an identity, which is why the app reports *Blanked*)
and then the chip **locks**: it still latches and modulates, so every reader sees
it, but it refuses all further data. Two `0x0073` writes, one of them after lifting
the tag off the Reader and re-presenting it to force a re-latch, were both
acknowledged by the device and both ignored by the chip.

So Reset does not clear a tag, it consumes one, and leaves an object that looks
alive to every reader it meets. `docs/PROTOCOL.md` warned that "a bogus payload can
lock the chip"; this is the same failure with the payload the app ships.

**Why not just keep zeroes and warn.** Because the two things a person wants are
genuinely different, and one of them is routine. "This fob should stop opening the
door, and I want the tag back" is the everyday case; "this fob must never open
anything again" is rare and destructive. One operation cannot be both, and the
current one is the rare destructive one presented as the routine one.

**The cleared value must not be zero.** Zero is the value that locks the chip, so
the cleared state is a **non-zero placeholder identity** — the tag keeps an Identity,
the chip keeps working, and no system issued that number. The value must be chosen
with the collision reasoning written down: a cleared tag is still a token, and the
placeholder must be one a building system will reject rather than one that might
match a real credential.

**Chosen: customer `0x00`, facility `0xFF`, card `0xFFFF` (data32 `0x00FF_FFFF`,
reading as `00 00 FF FF FF`).** Defined once, with its reasoning, in
`Identity::CLEARED` (`src-tauri/src/identity.rs`):
not zero, because zero is the locking payload; not card 1 or facility 1, because a
cleared tag still modulates and a small round number is one a building system
plausibly issued; the top of both fields, because card numbers are allocated from 1
upward so no system issues the maximum of both; in range for the codec, so it
encodes and reads back as a normal Identity.

**The safety argument is the payload's shape, not its value.** Clear's payload is
*clone-shaped*: customer at `[8]` and `[12]`, data32 at `[16..20]`, in the same
24-byte layout every routine Clone writes — and clone writes have never locked a
chip. The all-zero payload is the one payload no clone ever writes, and it is the
one that locked three. That is stronger than "non-zero therefore fine" and still
weaker than a hardware confirmation.

**The mechanism is now documented, and it is a lock rather than wear.** The
T5577/ATA5577C datasheets rate the part for 100,000 erase/write cycles, give it 11
blocks of (32 data bits + 1 lock bit), and put that lock bit **in the same 38-bit
standard write as the data**: once locked, the block is not re-programmable over
the RF field. There is also an OTP bit that makes every block behave as locked. So
the three chips are **locked, not worn out** — which is exactly why they still
latch and modulate while refusing all data. Recorded in `docs/PROTOCOL.md`, open
problem 7. Which of the 24 payload bytes carries the lock bit is still unknown, so
the app must not claim it sets it.

**Blocked by:** the presence-aware write guard (a cleared tag must remain a legal
write position, or Clear leaves a tag that cannot be reprogrammed). That fix is in
flight; this ticket lands after it.

**Seams:** Write outcome classification (the result of each action, and what it may
claim); the Identity codec (the placeholder value and its encoding); confirmation
gates (Destroy needs a gate Clear does not). The classification catches an action
reported as the other, or a claim of recoverability that was never observed; it
misses whether a particular chip actually accepts the next write, which only
hardware settles.

**Tracker:** None
**Status:** implemented; hardware criterion open

- [x] **Clear** writes a non-zero placeholder Identity and reports what the tag now
      carries, in words that make clear it is not a working credential.
      *Evidence:* `Identity::CLEARED` with its reasoning, and
      `identity::tests::the_cleared_placeholder_*` proving it is in range,
      non-zero, not blank, encodes clone-shaped and reads back as `Identified`;
      `clear::tests::a_clear_whose_readback_presents_the_placeholder_is_cleared`;
      `clearTag.test.ts` → "reports a clear as cleared … not a working credential"
      and "says the tag is not a working credential, and does not claim a later
      write". The value is reported by the backend (`ClearResult.presents`) rather
      than spelled out in the interface, so there is one definition.
- [x] A cleared tag can be written again from inside the app — clone onto it, and
      author an Identity onto it — with no read-before-write refusal, and the
      write subscribes to the same confirmation and read-back as any other.
      *Evidence, at the two pure seams plus the interface:*
      `write_guard::tests::a_cleared_tag_is_a_legal_write_position_for_a_new_identity`
      and `::a_cleared_tag_is_not_the_blank_case_either` prove the guard proceeds
      and raises no refusal cause; `clear::tests::a_cleared_tag_can_be_rewritten_and_cleared_again_from_the_app`
      proves the same tag can be cleared again **and** carry a new Identity;
      `ClearTag.test.tsx` → "a cleared tag can be rewritten from this app" drives
      the flow twice through the panel. Nothing in Clone, Batch or Write changed:
      a cleared tag is an ordinary `Identified` reading to them.
- [x] The placeholder value is recorded in one place with the reason it was chosen,
      including why it is not zero and why it is not a small round number.
      *Evidence:* `src-tauri/src/identity.rs`, `Identity::CLEARED`, with the
      collision reasoning, the range argument and the payload-shape argument.
      `identity::tests::the_cleared_placeholder_sits_at_the_top_of_both_fields`
      fails if a later edit picks card 1.
- [x] **Destroy** is a separate action, is not the default, and its confirmation
      states plainly that it permanently disables the tag — not that it "may refuse
      further writes".
      *Evidence:* `ClearTag.tsx` puts Destroy behind its own control on the panel's
      first screen, with its own read and its own confirmation; `DESTROY_ACTION_LABEL`
      is "Destroy this tag permanently"; `DESTROY_FACTS` says "This permanently
      disables the tag" and "It cannot be recovered or reused"; `clearTag.test.ts`
      asserts the wording and that the phrase "may … refuse" is absent. A test
      proves Clear's confirmation holds exactly two buttons, neither of them
      Destroy, so repeating the everyday action cannot reach it.
- [x] Destroy reports the outcome it actually produced, and never claims the tag can
      be recovered or reused.
      *Evidence:* `WriteOutcome::Destroyed` is produced only by
      `classify_destroy(Evidence::Readback(None))`; the notice says "will never
      accept data again" and "cannot be recovered or reused", and
      `clearTag.test.ts` asserts it never says "cleared", "written again",
      "reusable" or "may refuse". It also keeps the caveat that every reader still
      sees the tag, so a reply is not read as life.
- [x] Both actions are distinguishable in the outcome vocabulary, in the audible
      symbol and in the message, and a test proves neither can be reported as the
      other.
      *Evidence:* `OutcomeKind` `cleared` (severity success → one chirp) and
      `destroyed` (warning → two chirps) replace `blanked`; `clearKind` is the one
      place either is chosen. `write_outcome::tests::neither_classifier_can_produce_the_other_outcome`,
      `clear::tests::neither_operation_can_be_judged_as_the_other`,
      `outcome.test.ts` → "cannot report a clear and a destroy as each other", and
      `clearTag.test.ts` → "neither operation can be reported as the other"
      (outcome, echoed operation, severity and wording) all prove it.
      *Why those severities:* ADR 0009 gives one chirp to "completed and confirmed
      good" and two to "completed, result needs checking". Clear's placeholder is a
      positive read-back, so it is *done*. A Destroy the user asked for is
      completed — never *attention*, which means nothing completed — but its only
      evidence is an absence that cannot be told from a tag lifted off the reader,
      so it is *needs you*; that is also what makes the two distinguishable by ear.
- [x] `GLOSSARY.md` is corrected: **Reset** currently means "overwrite a Tag's
      Identity with nothing", which is the operation that destroys. The term is
      either retired in favour of Clear and Destroy or redefined to name which one
      it is, and no user-facing string still says "Reset" for the destructive one.
      *Evidence:* the Reset entry is retired from the interface; **Clear**,
      **Cleared** and **Destroy** are separate entries; the Blank entry says Blank
      is a state and never a verb; the flagged-ambiguity note records why the word
      went. `grep -rn "Reset" src/` returns only historical comments, and
      `clearTag.test.ts` asserts no mode label and no panel string says "Reset".
- [x] `docs/PROTOCOL.md`'s blanking section records the measurement: writing
      data32 = 0 on a T5577 leaves it readable with no identity and permanently
      refusing data, observed twice with a re-seat between.
      *Evidence:* the section is now "Two payloads for two purposes — Clear and
      Destroy", with the measured destroy behaviour (three instances, one after a
      re-seat), the datasheet mechanism, and a separate Clear subsection that says
      plainly what is and is not hardware-confirmed. Open problem 7 carries the
      datasheet evidence and the standing task.
- [ ] **Verified on hardware: NOT RUN, and it stays unticked.** A factory tag
      cleared, then written again from the app and reading back as the new Identity,
      has never been observed — **there is no fresh T5577 left**, so the one thing
      that would confirm the placeholder does not lock the chip cannot be tested.
      The Destroy half *is* measured (three chips: visible to the Reader with no
      Identity, refusing all writes), but it is recorded as measured, not as this
      criterion's run. `docs/superpowers/hardware-checklist-studio-redesign.md`
      item 5 has been rewritten with the expected observations and chirps for both
      operations, and it is unrun.
