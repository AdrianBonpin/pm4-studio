# 16: Spike — NTAG command viability

**What to build:** A throwaway experiment determines whether this Reader can read and write NTAG memory at all. The deliverable is a written finding, not a feature: either the exact payloads that work, or a clear negative result. Everything in tickets 17 to 22 depends on the answer, and a negative answer means 13.56 MHz stays read-only by design rather than by omission.

**Blocked by:** None (can start immediately)

**Seams:** None. This ticket produces a finding, not an interface.

**Tracker:** None
**Status:** done — POSITIVE. Read and write both verified on hardware; the ADR 0002 gate is cleared

- [x] A 13.56 MHz tag's memory is read and the result checked against an independently known value.
      NTAG215 page dump read via `0x0081` (1284 bytes over 21 reports) and checked against four
      independent facts: the 7-byte UID from `0x0069`, the tag's own BCC0/BCC1 anticollision bytes,
      the NFC Forum Type 2 CC, and a decoded NDEF URL. All agree. Raw bytes in `docs/PROTOCOL.md`.
- [x] A write is attempted and its effect observed on a subsequent read.
      `0x0082` wrote `CA FE F0 0D` to page 4, returned status `0` with `page 4 = state 1` and a
      matching `0x0085` progress frame, and a **separate process** read back `CA FE F0 0D`. The page
      was then restored to `03 00 FE 00` and the tag left byte-identical to how it started.
- [x] Whether responses span multiple USB reports is observed, or explicitly ruled out.
      Observed in both directions: replies split mid-frame at 64-byte boundaries, and a 21-report
      outbound write frame is accepted. Exact boundaries in `docs/PROTOCOL.md`,
      "Multi-report frames".
- [x] The finding is recorded in the protocol document with raw bytes, for either outcome.
      `docs/PROTOCOL.md`: "Multi-report frames", "NTAG command family", "Spike 16 finding", with raw
      frames for the read, the landed write, the read-back and the restore.
- [x] A negative finding states plainly that 13.56 MHz remains read-only and that tickets 17 to 22 do not begin.
      Not applicable — the finding is positive. 13.56 MHz write is **not** read-only, and tickets 18
      to 22 are no longer gated by this spike. (They remain subject to their own dependencies and to
      the untested multi-page case.)
- [x] Any tag used for write experiments is one the user is willing to lose.
      Met on both tags used. The first carried an NDEF URL, so only a free page (20) was touched and
      restored each time. The second was supplied by the user as factory-blank and explicitly
      authorised for writing; page 4 was written, verified, and restored, leaving the tag byte-identical
      to its factory state (`03 00 FE 00`, empty NDEF TLV).

## The finding

**Read: works.** `0x0083` reports status `4` and `tag_type 5` (NTAG215); `0x0081` returns a
1284-byte page dump across 21 USB reports plus one `0x0085` frame per page. The dump agrees with
the poll UID, the tag's BCC bytes, the Type 2 CC (`E1 10 3E 00`, 496 user bytes) and a decoded
NDEF URI.

**Write: works.** `0x0082` wrote one page and the value was observed on a later read from a
separate process.

**The trap, and the reason this took two attempts.** The write request's tag selector must be
`0..4`; `5`, which is exactly what `0x0083` reports for the same NTAG215, is refused with status
`32` and nothing written. Every earlier "write is refused" observation was that parameter error.
A second misleading signal: the dump's config tail reads `AUTH0 = 0x04` on both tags tested, two
different UIDs, which cannot be real configuration — it looked like password protection and was
not.

**ADR 0002 gate: cleared.** A write landed and was confirmed by a later read, which is the
condition the ADR set. Tickets 18 to 22 may begin.

**Still untested:** multi-page writes (an NDEF message spans several pages and needs several
state-table entries at once). Nothing else in the write path is in doubt.
