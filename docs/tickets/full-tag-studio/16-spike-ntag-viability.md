# 16: Spike — NTAG command viability

**What to build:** A throwaway experiment determines whether this Reader can read and write NTAG memory at all. The deliverable is a written finding, not a feature: either the exact payloads that work, or a clear negative result. Everything in tickets 17 to 22 depends on the answer, and a negative answer means 13.56 MHz stays read-only by design rather than by omission.

**Blocked by:** None (can start immediately)

**Seams:** None. This ticket produces a finding, not an interface.

**Tracker:** None
**Status:** needs-context — probe built and run; no 13.56 MHz tag was available

- [ ] A 13.56 MHz tag's memory is read and the result checked against an independently known value.
      Not done: no 13.56 MHz tag was in the field, so `0x0083` never left status `1` and `0x0081` was never sent.
- [ ] A write is attempted and its effect observed on a subsequent read.
      Not done: same reason. The wire transport for the 1328-byte write frame *was* verified (see below).
- [x] Whether responses span multiple USB reports is observed, or explicitly ruled out.
      Observed, in both directions: replies split at 64-byte report boundaries mid-frame, and a 21-report
      outbound write frame is accepted. Raw bytes in `docs/PROTOCOL.md`, "Multi-report frames".
- [x] The finding is recorded in the protocol document with raw bytes, for either outcome.
      `docs/PROTOCOL.md`: "Multi-report frames", "NTAG command family", "Spike 16 finding".
- [x] A negative finding states plainly that 13.56 MHz remains read-only and that tickets 17 to 22 do not begin.
      Stated, with the qualification that the blocker is missing hardware rather than a hardware refusal.
- [x] Any tag used for write experiments is one the user is willing to lose.
      No write was run. `ntagspike write` refuses without an explicit `--yes-disposable` flag.

## What this spike returned

The question was "can this Reader read and write NTAG memory at all", and it
splits into two parts that got different answers.

**Transport: yes.** Commands `0x0083` (info) and `0x0082` (write) are implemented
by this firmware. `0x0083` parses a 6-byte request and answers with a status dword
and a 64-byte body that genuinely spans two USB reports. `0x0082` accepts a
1335-byte frame — 21 reports — and answers with a 260-byte, 5-report reply. Both
checksums verify after concatenating reports, so reassembly is a solved transport
question, not an open one. Status `1` means "no NTAG"; the no-tag reply also
carries uninitialised firmware memory past the status dword.

**Tag operations: unverified.** No 13.56 MHz tag was available. 54 polls over 40
seconds never latched (`0x0069` returned `ST = 0x00`), so the ready status was
never reached, so no page was read and no page was written. There is no positive
read or write observation, and equally no evidence the Reader refuses.

**Gate: still closed.** 13.56 MHz stays read-only and tickets 17 to 22 do not
begin, per ADR 0002.

## To finish it

From `src-tauri/`, with PM4 Studio quit (it holds the exclusive HID handle):

```
cargo run --example ntagspike -- check
cargo run --example ntagspike -- info
cargo run --example ntagspike -- read
cargo run --example ntagspike -- write 4 deadbeef --yes-disposable
```

`check` should show validity `0x01` and a UID; `info` should show status `4` and a
`tag_type`. Only the last line writes anything — four bytes, one page — and only
on a tag its owner is willing to lose.
