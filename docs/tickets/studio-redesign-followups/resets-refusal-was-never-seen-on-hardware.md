# The refusal was never seen, and a zeroed tag accepts no new Identity

> **Naming note (2026-11-22).** This ticket was written when the operation was one
> destructive write called **Reset**. The payload question it raised has since been
> answered by splitting the operation: the all-zero write is now **Destroy** (its
> own gate, permanent), and the everyday **Clear** writes a non-zero, clone-shaped
> placeholder so the tag stays usable. Where this ticket says "blanking" or
> "Reset", read the overwrite write — the destructive half of it is Destroy. The
> criteria below are kept as written, with the outcome of each recorded.

**What to build:** Evidence that the "this tag will not accept writes" outcome
happens on real hardware, and a decision about what the overwrite write should
carry, now that writing the all-zero data field has left a T5577 refusing every
later write.

**Cause.** Ticket 12's whole point is a blanking write producing its own
outcome — three chirps, the LED held on, "the tag will not accept writes", with
the likely cause named. The 2026-11-22 hardware run never reached it. Blanking
succeeded and was reported honestly as *Blanked* with no copy counted, but the
tag then appeared not to read either, so there was no tag left to attempt a
second Reset against.

Two separate things were wrong, and they are now separated:

1. **The tag was never unreadable.** `cargo run --example blankprobe -- read`
   reports `tag present, NO identity (data field empty)`. The chip latches and
   modulates, with an empty data field. The app called that "no tag" because the
   combined read folds "no Tag" and "a Tag with no Identity" into `None`, and its
   write guard refused every write to a Tag it had itself blanked. Fixed on the
   `fix/blank-tag-recoverable` branch: `write_guard::decide` takes the
   presence-aware reading, so a Tag that is present with no Identity is a legal
   write position (ADR 0001 unchanged: nothing latched, or a reply too short to
   decode, still refuses).
2. **The refusal expectation was wrong.** A second Reset of a freshly blanked Tag
   cannot report *will not accept writes*: it is refused before anything is sent,
   because the Tag already carries no Identity
   (`BlankDecision::RefuseNothingToBlank`, reported as `Refused`, no write
   transmitted). *Will not accept writes* requires a blanking write that **was**
   sent and whose re-read still found an Identity, so it is evidence about the
   chip and the other one is not.

**New measurement, same tag, after the fix.** `lf_write` transmits successfully
and the Tag never takes a new Identity: two attempts, including one after lifting
the Tag off the Reader and re-presenting it to force a re-latch. The Tag still
latches and reads as carrying no Identity, and accepts no data. So writing the
all-zero data field appears to have left this T5577 permanently refusing writes.

That makes the blanking **payload** an open product question rather than a settled
decision: what a Reset should write so that the Tag remains usable (if anything
can) has not been decided, and the current all-zero payload was deliberately left
unchanged while that is decided. Choosing a replacement payload is the user's
decision, not something to settle inside a defect fix — and a "cleared" Identity
that looks plausible is actively dangerous, because a Tag carrying it could open
something that uses that number.

**Blocked by:** None

**Seams:** Write outcome classification (extended), the presence-aware write
guard, and the blanking payload. The classifier catches a refusal reported as
failure or as unverified; it cannot tell "the chip refused" from "the chip stopped
accepting data after a zero write", which only the payload decision and a fresh
tag settle.

**Tracker:** None
**Status:** ready

- [ ] A second Reset of a freshly blanked T5577 reports *refused — nothing to
      blank* **as a refusal: three chirps and the two-second LED hold**, and
      distinctly from *will not accept writes*: nothing was transmitted, so no
      claim about the chip is made.
      *Corrected: this criterion said "1 chirp, no LED hold". That was wrong twice
      over. The spec's alphabet table gives three chirps and the LED hold to
      "failed, refused, or the tag will not accept the write; nothing changed", and
      the spec's hardware item 11 already says *nothing to blank* is three chirps;
      and a refusal that sounds like *done* is the exact defect the audible
      alphabet exists to remove. What makes this outcome its own is its words and
      its kind (`refused`, with "nothing to blank" in the reason), not a quieter
      sound. Verified in the tree: `BlankResult.outcome === "refused"` →
      `blankKind` → kind `refused` → severity `error` → `attention` → 3 chirps +
      `ATTENTION_LED_HOLD_MS` (`src/lib/severity.ts`, `src/lib/blankTag.ts`,
      `src/lib/chirpSequence.ts`).*
- [ ] A blanking write that **was** sent to a chip that keeps its Identity reports
      *will not accept writes*: three chirps, the LED held for two seconds, no
      copy counted.
- [ ] A blanked tag's readout is compared with what the app promises. The app now
      says the Identity is gone and that whether the chip takes a new one depends
      on the chip; if the readout still shows "no tag" for a Tag that is latched
      and empty, that is corrected to the measured state.
- [ ] A blanked tag that will not take a new Identity produces its own
      distinguishable report — not "the reader is absent", not a generic failure,
      and not *blanked* (which describes the first write, not the second).
- [x] The payload question is decided and written down: what `0x0073` should carry
      so a tag stays usable, or the finding that this chip family cannot be left
      usable by any write this protocol can send. Measured against the tag family's
      datasheet, not reasoned from it.
      *Decided:* two payloads, two operations. **Destroy** keeps the all-zero write
      (measured to disable the chip); **Clear** writes customer `0x00`, facility
      `0xFF`, card `0xFFFF` (data32 `0x00FF_FFFF`), chosen because the payload is
      *clone-shaped* — the same layout every routine Clone writes, and clone writes
      have never locked a chip. Defined once, with the reasoning, in
      `Identity::CLEARED` (`src-tauri/src/identity.rs`); recorded in
      `docs/PROTOCOL.md`. The datasheet evidence is in `docs/PROTOCOL.md`, open
      problem 7: 100,000 erase/write cycles, a per-block lock bit carried in the
      same 38-bit standard write, and an OTP mode — so the three consumed chips were
      **locked, not worn out**, which is why they still latch and modulate.
- [ ] **Still open, and the reason this stays unticked:** no fresh T5577 is left, so
      a cleared tag has never been written again. `docs/superpowers/hardware-checklist-studio-redesign.md`
      item 5 has been rewritten for Clear and Destroy with its expected observations,
      and it has **not been run**. The Clear payload's safety rests on the shape of
      the payload and on the datasheet, not on a hardware confirmation.
- [ ] A write the chip refused, on a still-readable tag, has still not been observed
      producing *will not accept writes*. It stays unobserved until a tag produces it.
