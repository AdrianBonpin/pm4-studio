# 18: Write a Draft to a Tag

**What to build:** A Draft's Records are written to a tag as one complete message, read back, and the outcome reported as verified, unverified or refused. The confirmation names what is being replaced, or states the tag appears empty. There is no in-place append: a write replaces the message.

**Blocked by:** 07, 16, 17

**Seams:**
- S7 NDEF codec with S8 Library store — catches the encode-then-verify round trip and outcome classification; misses real tag behaviour beyond the write itself.

**Tracker:** None
**Status:** done — the multi-page write question is answered POSITIVE on hardware

- [x] Writing a Draft lands its Records and a read-back returns them.
      Verified on hardware through the shipping path: a 47-byte Text Record (50 bytes
      of Type 2 TLV, 13 pages) was written in one `0x0082` request and read back byte
      for byte, in the same session and from a separate process.
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

| Pages marked `2` in one request | Message | Result |
|---|---|---|
| 4, 5, 6 | 9-byte Text Record | verified, read back byte for byte |
| 4 … 16 | 47-byte Text Record | verified, read back byte for byte |
| 4 … 16 (over the 47-byte one) | the 9-byte message again | verified; pages 7..16 zeroed |

The third row is the replacing case: the request covers the union of both regions
and the old message's tail is zeroed, confirmed by a read from a separate process.
The transcript is in `docs/PROTOCOL.md` under `0x0082`, and the open problem it
answers is marked solved there.

Unexercised and left unchecked deliberately: a message filling the whole 496 bytes,
and a page reporting state `4` mid-write.
