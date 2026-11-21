# 19: Read memory dump and export

**What to build:** A tag's memory is read as a page or block dump showing offsets, hex and an ASCII view, and exported to a file the user chooses. This is the diagnostic floor for tags the decoder does not recognise.

**Blocked by:** 16, 17

**Seams:**
- S2 Report stream reassembler with the dump formatter — catches reassembly and dump layout; misses tag semantics, which the dump deliberately does not interpret.

**Tracker:** None
**Status:** done

- [x] A dump shows offsets, hex and ASCII.
- [x] The dump matches an independently known value for at least one tag.
- [x] The dump exports to a file the user chooses.
- [x] Reading memory from a tag that does not respond reports failure without wedging the app.
- [x] The dump states which tag it came from, so two exports can be told apart.

## Implementation note — read-only memory dump

The seam is split in two so the recorded bytes can prove it without hardware:

- `src-tauri/src/memory_dump.rs` is pure. `MemoryDump::parse` turns the verified
  1284-byte `0x0081` payload into 64 rows of four pages: status dword, 256 × 4
  page bytes, 256 page-state bytes (docs/PROTOCOL.md, "`0x0081` — NTAG read —
  VERIFIED"). `to_text` renders the file an export writes, and
  `suggested_file_name` names it after the tag's UID and the read time.
- `src-tauri/src/ntag.rs` is the two-command exchange. `0x0083` info
  (`01 01 00 00 00 00`) must report status `4`; its reply gives the tag type,
  the 7-byte UID at `0x2A..0x31` and the read token at `0x38..0x40`. `0x0081`
  then sends the verified 16-byte request — token, tag type, seven zeros — and
  waits for the final `0x0081` frame, skipping the `0x0085` per-page progress
  frames. Reassembly is `stream::ReportStream`'s through `Reader::read_one`;
  nothing here reads reports or truncates a payload to 64 bytes.

The dump interprets nothing — no capability container, no NDEF, no config
block — because for an unrecognised tag a guessed field is worse than a byte
string. The only named facts are the tag type, the UID and the timestamp.

**What proves the parser.** The unit tests build the payload from the real
NTAG215 read recorded in docs/PROTOCOL.md: page 0 `04 43 8A 45` (UID0–2 + BCC0),
page 1 `01 22 09 03`, page 2 `29 48 00 00` (BCC1 first), page 3 `E1 10 3E 00`
(the published Type 2 Capability Container), the NDEF TLV on pages 4–8 that
spells `devgo.studio` in the ASCII view, and the config-shaped block on pages
130–134. The BCC bytes are recomputed from the independent `0x0069` poll UID, so
the dump has to agree with a value it was not built from. The seam test then
encodes the same payload as a 1291-byte `0x0081` frame, splits it into the
verified 21 USB reports, reassembles it through `ReportStream`, and asserts the
dump is identical.

Export reuses the library plumbing: the save dialog is opened from Rust with the
already-registered `tauri-plugin-dialog` (no second dialog dependency and no new
webview capability), and the file is written by `library_io::write_text`, which
stages beside the target and renames into place like a library export does.

A tag that does not answer is reported, not parsed: info status `1` says no tag
is on the Reader, a status other than `4` says it was not read, and a truncated
or failed-checksum read is refused. `with_reader` drops the Reader handle on any
error, so the next attempt re-enumerates instead of leaving the page waiting.

## Hardware check

`cargo run --example dumpread` in `src-tauri/` calls this shipping path and
nothing else (`0x0083` then `0x0081`, read-only). It read a real NTAG215 on the
Reader: 1284 payload bytes, 135 readable pages, UID `04 43 7B 01 CC 09 03`,
page 0 `04 43 7B B4` (BCC0 recomputes from the UID), page 2 `C7 48 00 00` (BCC1
recomputes), page 3 `E1 10 3E 00`, page 4 `03 00 FE 00` — the empty NDEF TLV
docs/PROTOCOL.md recorded for this same tag after its write test. A second run
was refused with `0xE00002C5` because another process held the Reader; nothing
was killed, and the recorded bytes in the unit tests are what the formatter is
proven against without hardware.
