# 22: Load a Tag's Records into a Draft

**What to build:** Reading a tag that already holds Records loads them into a Draft, which can be edited and written back as a whole message. This is the read-edit-rewrite loop, and it is the only way content is modified — there is no in-place append.

**Blocked by:** 07, 19

**Seams:**
- S7 NDEF codec — catches decoding of real tag-formatted messages and order preservation; misses tag-specific quirks in how content was originally written.

**Tracker:** None
**Status:** done

- [x] Reading a tag with Records produces a Draft containing the same Records in the same order.
- [x] The Draft can be edited and written back whole.
- [x] A tag whose Records cannot be decoded falls back to a raw view rather than a half-populated Draft.
- [x] Loading into a Draft never modifies the tag by itself.
- [x] Loading a tag that already exists as a Snapshot does not overwrite that Snapshot.

## Notes

Evidence is `src-tauri/src/tag_records.rs` and `src/lib/tagRecords.ts` (+ their 15 Rust and 15
vitest tests), against the recorded NTAG215 in `docs/PROTOCOL.md`: pages 4..8 hold
`03 11 D1 01 0D 55 04 64 65 76 67 6F 2E 73 74 75 64 69 6F FE`, which the TLV reader yields as exactly
`D1 01 0D 55 04 "devgo.studio"` and which the webview codec decodes to one URL Record naming
https://devgo.studio.

- **Order and sameness.** The outer layer reports the message bytes; decoding is the existing
  `decodeRecords`, so a Record read and a Record written share one codec. A two-Record message
  (URL then Text) comes back as URL then Text in both layers, and re-encoding the loaded Records
  through ticket 18's `draftMessageHex` reproduces the tag's own bytes.
- **Written back whole, one writer only.** No write command exists in this ticket's paths. The
  loaded Draft is selected (`onLoaded` -> `setSelectedId`), so the existing editor and
  `WriteDraftToTag` (`hf_ndef_preview` / `hf_ndef_write`, ticket 18) operate on it. Prove by
  inspection: there is no second writer, and a `0x0082` frame cannot be built from these files.
- **No half-populated Draft.** `decodeNdefMessage` is all-or-throw: it rejects a chunked Record, a
  clear MB on the first Record, a set MB inside the message, TNF_UNCHANGED, a truncated payload and
  a message that claims to end before its data does (`the message claims to end N bytes before the
  data does`). Any such failure yields `kind: "undecodable"` with `records: []` and `raw: true`, so
  a URL this build can read followed by one it cannot produces no Draft at all.
- **Distinct edge outcomes, not one "failed".** `notFormatted` (page 3 is not a Type 2 CC),
  `missing` (formatted, no 0x03 TLV), `empty` (`03 00`, a message of zero bytes), `unreadable`
  (TLV does not parse, or claims more bytes than the tag holds) and `zeroRecords` (a message that
  decodes to no Records) are separate kinds with separate sentences.
- **Page layout.** The parser skips the 4-byte status dword and starts user memory at page 4
  (`PAGE_DATA_START + USER_FIRST_PAGE * PAGE_LEN == 4 + 4 * 4`), asserted directly; the extended
  length form `03 FF <hi> <lo>` is exercised by a real 307-byte message.
- **Read-only.** The new command sends `0x0083` and `0x0081` only; `0x0082` appears nowhere in this
  ticket's paths. Loading creates a Draft and only a Draft. No hardware run: the Reader was held by
  another process, so read-only is evidenced by the command constants rather than by a capture.
- **Snapshot untouched.** Proven in Rust against a `Library` that already holds a Snapshot of the
  same UID: after loading, the Snapshot is byte-identical and still `write_count == 0`.
