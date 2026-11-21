# NFC-PM4 USB HID protocol

Reverse-engineered from USB HID captures of the vendor Windows application
talking to hardware we own. This document records what is **verified** and
explicitly marks what is **not**.

The work here builds directly on two upstream projects:
[vicrodh/cyb-nfc](https://github.com/vicrodh/cyb-nfc) (frame layout + checksum)
and [journeyman846/nfcx-tool](https://github.com/journeyman846/nfcx-tool)
(endpoints + 125 kHz response layout). Their findings are reproduced and
cross-checked here, not claimed as original.

## Device

```
VID:PID        0483:4343
Manufacturer   CYBDZKJ-BSJ
Product        TCC-TSY-TBY
Serial         BEGIN-2025
```

Configuration 1, two interfaces, full-speed (12 Mbps).

### Interface 0 — USB Mass Storage

Class 8, subclass 6 (SCSI transparent), protocol `0x50` (bulk-only).
A **21,504-byte FAT12** volume containing a single file:

```
cyb_nfctool.url  →  https://www.camelote.cn/nfctools/
```

That domain resolves to `0.0.0.0` and is a dead end. The live download page is
`http://120.24.245.232/app/download/nfctools.html`. The vendor MSI is itself a
libnfc-based app configured for `pn532_uart:COM4:115200`, which is why it expects
a COM port that this hardware revision does not expose.

### Interface 1 — vendor HID

Class 3, subclass 0, protocol 0. Report descriptor:

```
05 FF        Usage Page (vendor-defined 0xFF00)
09 00        Usage
A1 01        Collection (Application)
  09 01  15 00  26 00 FF  75 08  95 40  81 02    Input  64 × 8-bit
  09 02  15 00  26 00 FF  75 08  95 40  91 02    Output 64 × 8-bit
C0           End Collection
```

No report IDs, no feature reports. Interrupt endpoints (`0x02` OUT / `0x82` IN
per upstream captures). Writes are accepted at any time but the device never
volunteers data — it only answers after a valid command frame.

## Frame format — VERIFIED

All frames are exactly 64 bytes, zero-padded.

```
offset 0        1        2        3        4        5..         end-2  end-1
       0x55     cmd_hi   cmd_lo   len_hi   len_lo   payload...   c0     c1
```

Checksum:

```python
x = 0
for b in payload:
    x ^= b
c0, c1 = x ^ 0xFF, x
```

**Quirk:** the vendor firmware truncates the XOR loop to `len & 0xFF` bytes, so
for payloads of 256 bytes or more not every byte is covered. Every command this
app sends is far below that, so a plain XOR is exact.

Cross-checked against real captures:

| Frame | XOR | Tail | ✓ |
|---|---|---|---|
| `55 00 51 00 01 01 FE 01` | `01` → `(FE, 01)` | `FE 01` | ✓ |
| `55 00 72 00 02 00 01 FE 01` | `00^01=01` → `(FE, 01)` | `FE 01` | ✓ |
| `55 00 69 00 00 FF 00` | empty → `(FF, 00)` | `FF 00` | ✓ |

Response frames use the same layout. A 24-byte LF response was verified
end-to-end: `55 00 72 00 18 … C8 42 00 00 00 00 74 8B` → XOR of the 24 payload
bytes is `0x8B` → `(74, 8B)`. ✓

## Commands

### `0x0051` — wake / select

Sent before any operation. The device echoes the frame verbatim.

```
OUT  55 00 51 00 01 01 FE 01
IN   55 00 51 00 01 01 FE 01
```

### `0x0055` — beep

```
OUT  55 00 55 00 00 FF 00
```

### `0x0053` — beep (and LED on)

Confirmed on hardware: chirps once and drives the LED **off → on** as a side
effect. Fire-and-forget — the firmware sends **no reply**, so do not wait for one
and do not read silence as "unsupported".

```
OUT  55 00 53 00 00 FF 00
```

An earlier build of this app had `0x0055` wired to the beeper, so the beep never
fired and only the LED reacted.

### `0x0055` — LED off

Confirmed on hardware. Turns the status LED off. **Not a beep.**

```
OUT  55 00 55 00 00 FF 00
```

No LED-on-only command has been found; `0x0053` lights it but always beeps too.

### `0x0069` — 13.56 MHz poll (ISO14443-A)

```
OUT  55 00 69 00 00 FF 00
IN   55 00 69 00 13 ST 01 [UID(4)] …tail…
```

- payload length `0x13` (19)
- `ST` = validity flag: `0x01` card latched, `0x00` nothing (UID field is then
  garbage and must be ignored)
- UID at payload offset 2..6

**Not verified:** ATQA/SAK tail offsets. Upstream reports `ATQA 0x0004,
SAK 0x08` (MIFARE Classic 1K) for one card, but we have not reproduced this on
real HF hardware. This app therefore reports only the UID plus the raw payload.

### `0x0072` — 125 kHz read (EM4100)

Only issued when a read is explicitly requested. The reader beeps locally when a
tag enters the field — that beep does **not** mean data was transferred.

```
OUT  55 00 72 00 02 00 01 FE 01
IN   55 00 72 00 18 00 01 01 …   (card present)
IN   55 00 72 00 18 00 01 00 …   (no card)
```

Payload layout (24 bytes, offsets relative to payload start):

| Offset | Meaning |
|---|---|
| 2 | validity: `0x01` = card latched |
| 8 | EM4100 customer / version byte |
| 12..16 | 32-bit data, **little-endian** |
| 18..20 | `C8 42`, constant across all captures, meaning unknown |
| 20 | repeat counter, increments on identical consecutive reads |

Reconstructing the EM4100 identity, for a capture with customer `0x56` and data
`B3 C7 53 00`:

```
data32           = 0x0053C7B3
EM4100 5-byte id = 56 00 53 C7 B3      (customer byte + data32 big-endian)
facility         = (data32 >> 16) & 0xFF = 0x53 = 83
card             = data32 & 0xFFFF       = 0xC7B3 = 51123
```

### `0x0073` — 125 kHz write (EM4100) — CONFIRMED

Discovered by probing and confirmed by writing a badge id to a blank T5577 and
reading it back **byte-identically**. Not documented in any upstream project.

Payload is **exactly 24 bytes**. The write layout is shifted **+4 bytes**
relative to the read layout:

| Offset | Meaning |
|---|---|
| 0 | `0x00` |
| 1 | `0x01` — enable flag, required |
| 2 | `0x01` — enable flag, required |
| 8 | customer byte |
| 12 | customer byte |
| 16..20 | data32, **little-endian** |
| 20..24 | `0x00` |

Working example — cloning badge `55 00 84 82 12` (customer `0x55`, data32
`0x00848212`):

```
OUT  55 00 73 00 18 00 01 01 00 00 00 00 00 55 00 00 00 55 00 00 00 12 82 84 00 00 00 00 00 <cksum>
```

Read-back after that frame:

```
IN   55 00 72 00 18 00 01 01 00 00 00 00 00 55 00 00 00 12 82 84 00 00 00 C8 42 01 00 00 00 <cksum>
```

which decodes to `55 00 84 82 12`, facility 132, card 33298 — identical to the
source badge.

#### Two failure modes worth knowing

1. **A short payload wedges the firmware.** Sending `0x0073` with a 5-byte
   payload was accepted by USB and then the device stopped answering HID reports
   entirely (`IOHIDDeviceSetReport ... I/O Timeout`) until physically replugged.
   Keep the payload at 24 bytes.
2. **A bogus payload can lock the chip.** One test succeeded in writing a
   nonsensical value (customer `0x12`, data32 `0x42C80000`) and that chip then
   refused all further writes while still reading back fine — classic T5577 lock
   behaviour. Treat each blank as single-use until proven otherwise, and never
   experiment on a tag you care about.

## Multi-report frames — VERIFIED (spike 16, 2026-11-21)

Everything above fits in one 64-byte report. Frames that do not are real, in
both directions, and this is how they behave.

**A frame is a continuous byte stream across reports.** A report carries the next
64 bytes of that stream. Frames are not framed or padded per report — the only
guide to a frame boundary is the declared length. Zero padding exists, but it is
frame-level padding on short frames, not per-report padding.

Observed on the info reply, whose body is 64 bytes and therefore does not fit:

```
OUT  55 00 83 00 06 01 01 00 00 00 00 FF 00
IN   55 00 83 00 40 01 00 00 00 00 00 00 … FF FF FF      (report 1, 64 bytes)
IN   FF FF FF FF FF FE 01 00 00 00 … 00 00               (report 2, 64 bytes)
```

Declared `LEN 0x40` (64) → the frame is 5 + 64 + 2 = **71 bytes**: 64 in the first
report, then the remaining 5 payload bytes and the `FE 01` checksum at the start
of the second, followed by zeros. Note the second report opens with payload bytes
59..63, not with a header — a parser that expects `0x55` at the start of every
report will never see this frame. The checksum over `payload[..64 & 0xFF]`
recomputes to `FE 01` **only after the two reports are concatenated**.

Outbound works the same way. A `0x0082` frame with a 1328-byte payload is 1335
bytes and goes out as **21 reports of 64 bytes**, and the firmware accepts it:

```
OUT  report 1 starts 55 00 82 05 30 FF FF FF FF FF FF FF FF 00 00 00 …
     … 20 further reports, the last zero-padded …
```

The reply to that frame is also multi-report: `LEN 0x104` (260) → 267 bytes →
**5 reports**, reassembling with a valid checksum.

Practical rule for a reassembler: accumulate every report into one buffer and
parse frames out of the buffer by `5 + LEN + 2` from the `0x55` magic, keeping any
incomplete tail for the next read. Never parse a single report as a frame.

## NTAG command family — firmware side VERIFIED, tag side UNVERIFIED

Documented upstream as NTAG info / read / write / format. Spike 16 established
that **this firmware implements them**: it parses their payloads, answers them,
and assigns meaningful status codes. What remains unverified is anything that
needs an NTAG in the field, because no 13.56 MHz tag was available.

Status is a little-endian `u32` at payload offset 0 of the reply.

| Status | Meaning |
|---|---|
| `1` | nothing to operate on — no NTAG latched (every reply observed here) |
| `4` | NTAG ready; the value upstream waits for |

### `0x0083` — NTAG info — VERIFIED (no-tag case)

```
OUT  55 00 83 00 06 01 01 00 00 00 00 FF 00
IN   55 00 83 00 40 01 00 00 00 00 …            report 1 of 2
IN   FF FF FF FF FF FE 01 …                     report 2 of 2
```

Request payload is 6 bytes: `01` count, `01` short flag, then a `u32` little
endian page index (`00 00 00 00`).

Reply fields, per upstream and consistent with what came back:

| Payload offset | Meaning |
|---|---|
| 0..4 | status `u32` LE — `01 00 00 00` = no NTAG |
| 4..8 | tag type `u32` LE — `0` when no tag; upstream expects `3`/`4`/`5`/`6` |
| 0x38..0x40 | 8-byte session token — `FF FF FF FF FF FF FF FF` when no tag |

**`LEN 0x40` does not mean data arrived.** The no-tag reply is already a full
64-byte body, so length alone distinguishes nothing; only the status dword does.

### `0x0082` — NTAG write — VERIFIED (transport), untested against a tag

Request payload is exactly **1328 bytes** (`0x530`):

| Offset | Meaning |
|---|---|
| 0..8 | session token from `0x0083` |
| 8..12 | tag type `u32` LE |
| 12..16 | `01 00 00 00` — flag, required |
| 0x30..0x430 | page data, 256 pages × 4 bytes |
| 0x430..0x530 | page states, 256 bytes — `2` = write this page, `1` = ok, `4` = failed |

Sent with an all-zero state table (a request to write **no** page), the firmware
accepts the 21-report frame and answers:

```
IN   55 00 82 01 04 01 00 00 00 80 CD F0 FF FB 03 …      report 1 of 5
IN   …                                                    3 more reports
IN   … 00 F9 07 00 00 FE 01 00 …                          report 5 of 5
```

`LEN 0x104` = 260 bytes: status `u32` (`01 00 00 00` = no NTAG) then the 0x100-byte
page-state table. Checksum verified after reassembly.

Two things worth keeping. The frame was accepted with no tag present and the
device stayed responsive afterwards, so a 21-report command does **not** wedge the
firmware by itself. And everything past the status dword in that reply looked
like uninitialised firmware memory (pointer-shaped values such as `78 0D 00 20`,
`E8 2E 00 20`), so **nothing beyond the status dword should be trusted unless the
status is a success code.**

### `0x0081` — NTAG read — NOT VERIFIED

Upstream shape: request `token(8) | tag_type(1) | 7 zero bytes`. The reply is a
stream of `0x0085` page frames (`page`, `state`, 4 data bytes) followed by a final
`0x0081` frame whose body is status `u32` plus 0x400 bytes of page data (and 0x100
bytes of page states). Body length ≥ `0x404`, so ~17 reports.

Never sent here: it needs status `4` from `0x0083`, which needs a tag. The payload
layouts in this section are **transcription from the upstream client, not a
capture** — a hypothesis until a read is observed.

### `0x0084` — format — NOT ATTEMPTED

Destructive and out of scope for this app. Request is the 8-byte session token.

### `0x0085` — per-page stream — NOT OBSERVED

Appears only in the upstream client, as the streaming reply to reads and writes.
Never seen on this Reader, because every operation stopped at status `1`.

## The `0x0069` no-tag payload, for the record

With nothing in the field the poll still returns `LEN 0x13`, and every byte after
the validity flag is unstable garbage — two different payloads within one second:

```
IN   55 00 69 00 13 00 01 00 08 DB 96 00 08 90 1D 00 20 00 26 00 20 00 00 00 <cksum>
IN   55 00 69 00 13 00 01 00 00 DB 96 00 08 90 1D 00 20 00 27 00 20 00 00 00 <cksum>
```

54 polls over 40 seconds, every one `st=0x00`, nothing latched. This is the
strongest available confirmation that `ST = 0x00` means "ignore the rest": the
values drift between polls while no tag is present.

## Open problems

1. **ATQA/SAK offsets** for the HF poll tail. Not yet captured from a real
   13.56 MHz card, so this app reports only the UID plus the raw payload.
2. **NTAG read and write against a real tag.** Transport, framing, and status
   semantics are verified; whether a tag ever reports status `4`, whether its
   pages read back correctly, and whether a write lands are all unobserved. See
   the spike 16 finding below.
3. **`C8 42`** meaning in the LF read payload.
4. **What sets the T5577 lock bit.** One write locked a chip; another did not.
   Understanding which payloads are safe would remove the main hazard of the
   `0x0073` path.

Solved: **125 kHz write/clone** — command `0x0073`, see above.
Solved: **multi-report reassembly** — the wire rule is verified in both
directions, see "Multi-report frames".

## Spike 16 finding — NTAG viability

Probe: `src-tauri/examples/ntagspike.rs` (`check`, `wait`, `info`, `read`,
`write`, `transport`). Throwaway, per ADR 0002 — not part of the shipping path.

**Established on hardware.** The NTAG command family is real on this firmware.
`0x0083` parses a 6-byte request and answers with a status dword and a 64-byte
body split across two USB reports; `0x0082` accepts a 1328-byte, 21-report request
and answers with a 260-byte, 5-report reply. Checksums verify after reassembly in
both cases. With nothing in the field both report status `1` (no NTAG),
reproducibly, and the Reader stays responsive. So the third-party client that
documents these commands is describing this hardware, and the transport is not the
obstacle it was assumed to be.

**Not established.** No 13.56 MHz tag was available. Over 54 polls in 40 seconds
`0x0069` never latched (`ST = 0x00`), so `0x0083` never returned the ready status,
so `0x0081` was never sent and no tag page was ever read or written. **No positive
read and no positive write exists.**

**Therefore the ADR 0002 gate stays closed.** 13.56 MHz remains read-only by
design, not by omission, and tickets 17 to 22 do not begin. The blocker is missing
hardware rather than a hardware refusal: the negative half of this spike has not
been demonstrated either, and must not be recorded as if it had been.

**To finish it** — place a 13.56 MHz NTAG or MIFARE tag on the Reader and run,
from `src-tauri/`:

```
cargo run --example ntagspike -- check    # expect validity 0x01 and a UID
cargo run --example ntagspike -- info     # expect status 4 and a tag_type
cargo run --example ntagspike -- read     # memory read plus the cross-checks
cargo run --example ntagspike -- write 4 deadbeef --yes-disposable
```

The `write` step overwrites four bytes (one page) of the tag on the Reader and
must only be run on a tag its owner is willing to lose. Quit PM4 Studio first: it
holds the exclusive HID handle and the probe will fail with `0xE00002C5`.

Contributions with real captures welcome.

## Legal

This documents a protocol for interoperability with hardware we own. Do not use it
to clone credentials you are not authorised to duplicate.
