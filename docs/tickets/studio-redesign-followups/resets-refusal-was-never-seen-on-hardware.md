# Reset's refusal was never seen, and a blanked tag accepts no new Identity

**What to build:** Evidence that the "this tag will not accept writes" outcome
happens on real hardware, and a decision about what blanking should write, now
that writing the all-zero data field has left a T5577 refusing every later write.

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
      blank* (1 chirp, no LED hold), distinctly from *will not accept writes*:
      nothing was transmitted, so no claim about the chip is made.
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
- [ ] The blanking payload question is decided and written down: what `0x0073`
      should carry so a blanked T5577 stays usable, or the finding that this chip
      family cannot be left usable by any blanking write this protocol can send.
      Measured against the tag family's datasheet, not reasoned from it.
- [ ] Whichever way it resolves, `docs/superpowers/hardware-checklist-studio-redesign.md`
      item 5 is re-run and its result recorded, so the claim stops resting on the
      automated suite alone.
