# 18: Write a Draft to a Tag

**What to build:** A Draft's Records are written to a tag as one complete message, read back, and the outcome reported as verified, unverified or refused. The confirmation names what is being replaced, or states the tag appears empty. There is no in-place append: a write replaces the message.

**Blocked by:** 07, 16, 17

**Seams:**
- S7 NDEF codec with S8 Library store — catches the encode-then-verify round trip and outcome classification; misses real tag behaviour beyond the write itself.

**Tracker:** None
**Status:** done — verified on hardware on 2026-11-22 with the request and reply
recorded verbatim

- [x] Writing a Draft lands its Records and a read-back returns them.
      VERIFIED 2026-11-22. At integration this was left unchecked because the run
      recorded what each request did but not the request bytes themselves, and a
      claim without bytes is an illustration, not evidence. The gap is now closed:
      the Reader's wire tap records what `write_frame_paced` hands the device and
      what `read_one` receives, and a 13-page write was captured frame by frame. One
      `0x0082` of 1335 bytes sent as 21 reports, the payload laid out by field
      (token, selector `3`, flag dword, first data page `4`, 13 pages marked state
      `2`, pages 0..3 at state `0`), 13 `0x0085` progress frames, and a read-back
      taken in a fresh session — device dropped and reopened — returning the message
      that was sent. The probe's own verdict: `MULTI-PAGE WRITE VERIFIED`. The
      transcript is in `docs/PROTOCOL.md` under `0x0082`.
- [x] The confirmation names the existing content being replaced, or states the tag appears empty.
      `replacementSentence` in `src/lib/tagWrite.ts`: "The tag appears empty, so nothing is
      being replaced", or "Writing replaces what the tag holds now: 1 Record: URL
      https://devgo.studio". The probe printed the same facts before each write.
- [x] A write that transmits but cannot be read back is reported as unverified with instructions, not as a failure.
      `write_outcome::JudgedEvidence::Readback(None)` / `Some(false)` → `Unverified`, and
      `writeNotice` words it as "Unknown" with instructions to re-read the tag. Proven by
      unit tests on both sides of the boundary; not induced on hardware, because the read
      path kept working.
- [x] A write that cannot transmit is reported as failed.
      A frame that `write_frame_paced` cannot send is `Failed`, and so is a firmware
      status `32` refusal (nothing written). Unit-tested in `write_outcome`.
- [x] An empty Draft is refused before anything is sent.
      `ntag::write_message` returns `Refused` before the first device call, the command
      layer refuses an empty message hex, and the Drafts page disables the action. Tested
      with no hardware.
- [x] A Draft larger than the tag's capacity is refused before anything is sent.
      Capacity is read from the Type 2 CC (`E1 10 3E 00` = 496 bytes), never guessed. On
      hardware a 500-byte message (505 bytes of TLV) was refused with "needs 505 bytes and
      the Tag holds 496" and the tag read back unchanged.
- [x] Polling is suspended for the duration of the write.
      `src/lib/deviceLock.ts` is held for the whole preview and write, and `useLfPoller`
      skips its tick while it is held. Tested with no hardware.

## Implementation note

**Rust.** `src-tauri/src/ntag.rs` owns the Tag's memory layout. The pure half — TLV
wrapping and reading, the Type 2 CC, the 1284-byte read reply, the 1328-byte write
payload and page-state table, and the page guard — is unit-tested against the bytes
recorded in `docs/PROTOCOL.md` (the `03 11 … FE` user area of the NTAG215 the spike
read, and the page-4 write frame it captured). The device half is `read_tag`,
`preview` and `write_message`; it uses ticket 17's outbound chunking with the 5 ms
inter-report pacing the spike proved, and reads the tag back after every write.

**Guards.** No write can mark a page below 4 or past the CC's user memory:
`guard_write_page` refuses both, and `write_payload` checks it for every page before
a payload exists. Pages 0..3 were byte-identical after every hardware write.

**Outcome vocabulary.** `write_outcome::classify_evidence` is the single place a
read-back becomes an outcome, shared with the 125 kHz path. Only `verified` is a
confirmed copy; nothing in this ticket increments a Snapshot's count.

**Frontend.** `src/lib/tagWrite.ts` turns Draft Records into the message hex (via the
existing NDEF codec — no encoding was changed here) and the backend's answer into
sentences. `src/components/WriteDraftToTag.tsx` is the two-step flow: check the tag,
then confirm what is being replaced.

## Multi-page evidence

The spike proved one page only. Ticket 18 wrote, on NTAG215 `04 43 7B 01 CC 09 03`:

| Pages marked `2` in one request | Message | Result as recorded |
|---|---|---|
| 4, 5, 6 | 9-byte Text Record | verified, read back byte for byte |
| 4 … 16 | 47-byte Text Record | verified, read back byte for byte |
| 4 … 16 (over the 47-byte one) | the 9-byte message again | verified; pages 7..16 zeroed |

The third row is the replacing case: the request covers the union of both regions
and the old message's tail is zeroed, confirmed by a read from a separate process.
Those three requests are recorded in `docs/PROTOCOL.md` under `0x0082`. They were
labelled PROVISIONAL at integration because the request and reply bytes were not
kept; a later run with the wire tap recorded them, so that label has been withdrawn
and open problem 2 is closed.

Unexercised and left unchecked deliberately: a message filling the whole 496 bytes,
and a page reporting state `4` mid-write.

## Integration note (merger)

This branch forked before tickets 09 and 13 landed, so two files collided with
work that was already on `feat/tag-studio`. Both sides were kept; nothing was
dropped.

- `src-tauri/src/ntag.rs` was created **twice**, independently: ticket 19 (memory
  dump) added a read-only module with `NtagInfo` / `read_info` / `read_payload`,
  and this ticket added a write module. The merged file is this ticket's module
  plus ticket 19's dump read path under a "memory-dump read path" heading, with
  the two colliding constant names separated: `INFO_REPLY_LEN` (0x40, the info
  *reply*) vs `INFO_PAYLOAD_LEN` (6, the info *request*), and
  `INFO_TRANSACT_TIMEOUT_MS` / `READ_TRANSACT_TIMEOUT_MS`. Both test suites are
  present (21 + 7 = 28). The duplication of the `0x0083` reply parser
  (`TagInfo` and `NtagInfo`) is real and should be collapsed by a later ticket.
- `src-tauri/src/write_outcome.rs`: this branch had no `WriteOutcome::Blanked` and
  no `Evidence::ReadbackUnreadable`, both added by ticket 13. `classify` and
  `classify_blank` keep ticket 13's shapes, with `Evidence::Declined` added to
  each (→ `Failed`: the firmware refused to act and nothing was written).
  `JudgedEvidence` / `classify_evidence` are as this ticket wrote them.
- `src/lib/tagWrite.ts`: `writeNotice` gained the `"blanked"` arm the shared
  `WriteOutcome` type now requires; an NDEF write cannot produce it, so it is
  worded as an unexpected outcome rather than a result.

Verification at integration: `tsc --noEmit` clean, `bun run build` clean,
242 vitest (baseline 218) and 228 cargo (baseline 202) passing.
