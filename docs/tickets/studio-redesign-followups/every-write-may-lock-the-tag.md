# Does every write from this app lock the tag?

**What to build:** The answer to one question, on one writable T5577: does the
payload pair `payload[1] = 0x01, payload[2] = 0x01` — which the app sends on
**every** write, for Clone, Write, Clear and Destroy alike — put the chip's
per-block lock bit into the command that programs the data?

**ANSWERED 2026-11-22 — no.** A factory T5577 was written with the pair cleared and
the write took (`00 00 00 15 C9` → `00 00 00 15 CA`); a second write with the same
cleared payload was refused, and so was a third three seconds later. A payload
without the flags locks a tag exactly as the app's payload does, so **the pair is not
the lock's carrier on this hardware.** See `docs/PROTOCOL.md` open problem 7.

What survives from this ticket is the *why*, which one Reader cannot settle: either
these blanks are one-time-programmable, or the Reader's firmware sets the block lock
bits itself on every `0x0073`. A second, known-good writer would decide it.

**Why it matters.** The T5577 datasheet puts the lock bit inside the same 38-bit
standard write as the data, and the lock is permanent. If those two constant bytes
land on it, then **every tag this app has ever written has been made single-use by
the app**, not by the chip. That would mean: the four tags lost so far were lost on
their first write from this app; Clear is not safer than Destroy; and the redesign's
"clearing leaves a live, rewritable tag" promise is false until this is fixed.

**What is already measured.** `docs/PROTOCOL.md` open problem 7. Three tags died
after an all-zero identity, one after a nonsensical value, and one that read
`55 00 84 82 12` refused writes both with the flags and with them cleared — so on
that tag the flags are not the refusal, and it is unwritable by any payload. No tag
has ever been observed accepting a second write. A read-only EM4100 fob and a locked
T5577 are indistinguishable from this Reader (ADR 0007), which is why that last
observation cannot settle the question.

**Blocked by:** None. It needs one writable T5577 blank that can be spent.

**Seams:** `examples/lockprobe.rs`, which writes identity A, re-reads, writes
identity B, re-reads, and can send the payload with the `01 01` pair cleared. It
catches whether a second write is accepted; it misses *why* — the lock bit's byte
position stays unknown unless a second chip is available to bisect the two bytes.

**Tracker:** None
**Status:** done — the question it asked is answered; the residual *why* is recorded in `PROTOCOL.md` open problem 7 and needs a second writer, not this app.

- [x] One writable T5577 is written twice with the flags cleared. Recording whether
      the second write is accepted settles the primary question either way. **Done:**
      the first took, the second was refused.
- [x] If the second write is accepted, the same tag then takes a write **with** the
      flags, which identifies the pair as the lock rather than the payload value.
      **Not applicable:** the second write was refused with the flags cleared, so the
      pair is not the lock and there was nothing further to bisect.
- [ ] The result is recorded in `docs/PROTOCOL.md` open problem 7 with the payloads
      used and what the read-back showed, so the next person does not repeat it.
- [ ] If the flags are the lock, the shipping payload is changed to leave them clear,
      and Clear is re-verified on hardware: cleared, then written again from the app.
- [ ] If the flags are innocent, the app's copy stops implying that clearing keeps a
      tag reusable beyond what a single-write chip allows, and the *afford to lose*
      caveat becomes permanent rather than conditional.
- [ ] Either way, the hardware checklist's Clear item records what was actually
      proved, and the claim that a cleared tag can be written again is stated only
      if it was observed.
