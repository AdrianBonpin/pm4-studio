# 20: Erase a Tag's NDEF

**What to build:** A tag's NDEF content is cleared so the tag can be reused, behind a confirmation naming what will be lost. The tag remains a tag: erasing clears content, it does not destroy the tag or change its format.

**Blocked by:** 16, 17

**Seams:**
- S7 NDEF codec with S8 Library store — catches the erase payload and outcome classification; misses tags whose format prevents erasure.

**Tracker:** None
**Status:** done

- [x] Erasing clears NDEF content; a subsequent read shows the tag present with no Records.
      Hardware-verified on a disposable NTAG215 (`04 43 7B 01 CC 09 03`, CC
      `E1 10 3E 00`): a 50-byte Text message (53-byte TLV, pages 4..17) was erased
      in one `0x0082` request, all 14 pages reported written, and the read-back
      showed page 4 = `03 00 FE 00` with pages 5.. zero. Pages 0..3 read
      `04 43 7B B4 / 01 CC 09 03 / C7 48 00 00 / E1 10 3E 00` before and after, and
      a separate process (`examples/dumpread`) read the Tag as an NTAG215 with 496
      bytes and no Records. Request and reply payloads are recorded verbatim in
      docs/PROTOCOL.md ("Erasing NDEF content"), unlike ticket 18's multi-page claim.
- [x] Erase requires confirmation naming what will be lost.
      `eraseConfirmation` / `eraseSentence` in `src/lib/eraseTag.ts` name the Records
      the Tag holds ("1 Record: URL https://devgo.studio"), the byte count and the
      pages written, and the UI shows nothing write-capable until "Check tag" has
      read the Tag (`hf_ndef_erase_preview` is read-only). Unit-tested against the
      recorded message bytes.
- [x] Erasing a tag that cannot be read first is refused.
      ADR 0001 applied to a clearing write: `ntag::erase_target` turns "nothing
      latched" and any read error into a refusal before a frame exists, tested with
      no hardware. On hardware the probe refused a Tag whose read showed no content
      to clear, and never sent a frame.
- [x] A failed erase reports failure and leaves the tag readable.
      `write_outcome::classify_erase`: a read-back that still carries a message, or
      whose pages 0..3 changed, is `Failed` on a Tag that just read; only an
      unreadable read-back is `Unverified`. The failure notice says the tag is still
      readable. Unit-tested with no hardware; not induced on hardware, because the
      erase kept working.
- [x] Erase is not presented as a way to make a tag read-only or to remove password protection.
      `ERASE_IS_NOT_READ_ONLY` and `ERASE_IS_NOT_PASSWORD_REMOVAL` are shown in the
      confirmation itself, not in a footnote, and both are asserted by tests.

## Implementation note — what "erase" is, and what it deliberately is not

Erasing is one `0x0082` write carrying the Tag's whole image with only user pages
marked: an empty NDEF TLV `03 00 FE` over page 4, zeros out to the last page the old
message occupied, so no tail of the old message survives behind the new
terminator. There is no new command and no new frame shape.

It is not a format: a Tag with no NDEF TLV at all is refused rather than given one,
and the Capability Container on page 3 is never marked for writing — the page guard
ticket 18 built (`guard_write_page`) is reused, not re-implemented. It is not a
125 kHz **Reset**: the Tag keeps its identity and format, so it is not **Blank**. It
does not lock or unlock anything and does not touch a password.

The outcome has its own word. `WriteOutcome::Erased` ("erased") joins `Blanked` as a
success that is not a copy, and `counts_as_confirmed_copy` stays false for it, so no
Snapshot's count can be raised by clearing a Tag.

## Implementation note — the two `0x0083` parsers are now one

Tickets 18 and 19 each added a parser for the same 64-byte info reply (`TagInfo`
and `NtagInfo`, with duplicate offsets and a duplicate UID hex conversion). They
are unified on `NtagInfo`: `parse` reads any status and keeps the status dword
(the read path needs "nothing latched" as a state, not a parse error), and
`from_payload` refuses anything that is not a ready Tag for the memory-dump path.
`TagRead.info` is that type; `reported_tag_type` in the webview view is its
`tag_type`. Both ticket 19's tests and the read/write/erase tests pass unchanged
apart from the field names.

## Merge note (ticket 20 into feat/tag-studio)

Merged onto feat/tag-studio at `af1b0ab` (merge base `a9b2993`); the only
conflicts were additive. Independently
verified at merge time: `plan_erase` writes `03 00 FE` over the message area and
zeros only the old TLV's tail; the state table marks only pages `4..` occupied by
that region, so pages 0..3 are never marked; `guard_write_page` still rejects
`page >= CONFIG_FIRST_PAGE` (ticket 21) *before* the user-memory check;
`judge_erase_readback` compares pages `0..=3` byte-for-byte and a change is
`Failed`, not `Erased`; `counts_as_confirmed_copy` matches `Verified` only, so
`erased` raises no Snapshot count. Two integration follow-ups the shared
vocabulary forced: an `erased` arm in `batch.rs::counts` (counted as failed, as
`Blanked` is) and in `authorIdentity.ts::authorWriteNotice` (named, not worded).

What is **not** independently reproduced here: the hardware run recorded in
docs/PROTOCOL.md (no Reader in this session), and criterion 4's failure branch,
which was not induced on hardware because the erase kept working. Criterion 4's
code path — `classify_erase` returning `Failed` with a still-readable Tag — is
covered by unit tests.
