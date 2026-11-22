# NFC-PM4 USB HID protocol

Reverse-engineered from USB HID captures of the vendor Windows application
talking to hardware we own. This document records what is **verified** and
explicitly marks what is **not**.

The work here builds directly on two upstream projects:
[vicrodh/cyb-nfc](https://github.com/vicrodh/cyb-nfc) (frame layout + checksum)
and [journeyman846/nfcx-tool](https://github.com/journeyman846/nfcx-tool)
(endpoints + 125 kHz response layout). Their findings are reproduced and
cross-checked here, not claimed as original.

> **Reproducing these frames — a development build.** Every frame below was
> found by typing it into the app's raw console and reading the reply, and that
> is still the instrument. In a **release** build the console sends only the
> commands that cannot change a Tag — the wake and select, the version query,
> the poll, the two reads, the NTAG info and the Reader's beep and LED — so
> every write documented here is refused there, deliberately. Writes are
> reproducible from a **development** build (`cargo run` from the repository),
> which sends anything. See ADR 0006.

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

### `0x0053` — chirp, and LED on

Confirmed on hardware: chirps once and drives the LED **off → on** as a side
effect. Fire-and-forget — the firmware sends **no reply**, so do not wait for one
and do not read silence as "unsupported".

```
OUT  55 00 53 00 00 FF 00
```

An earlier build of this app had `0x0055` wired to the beeper, so the beep never
fired and only the LED reacted. `0x0055` is the LED-off frame (below), not a
beep.

### `0x0054` — firmware version — VERIFIED

Confirmed on this hardware by probing every id in the `0x0040..=0x008A` range
with an empty payload and a 900 ms wait. The reply is a 17-byte payload: an
ASCII revision, NUL padding, then a trailing `0x01`.

```
OUT  55 00 54 00 00 FF 00
IN   55 00 54 00 11 48 30 30 53 30 37 00 00 00 00 00 00 00 00 00 00 01 <cksum>
```

The revision is `48 30 30 53 30 37` = **`H00S07`**. The payload length is `0x11`
(17) and the checksum verified. Everything from the first NUL on is padding, so
the string is read up to that byte; a payload with no printable bytes is
treated as unreadable rather than displayed.

The trailing `0x01` is unexplained. It is not a terminator — the string is
already NUL-terminated — so it may be a flag or a second, numeric part of the
version. Do not read it as part of the revision.

This is the frame to quote in a bug report. The app surfaces the revision in
the sidebar once the Reader is open.

### `0x0055` — LED off

Confirmed on hardware. Turns the status LED off. **Not a beep.**

```
OUT  55 00 55 00 00 FF 00
```

No LED-on-only command has been found; `0x0053` lights it but always beeps too.

### `0x0069` — 13.56 MHz poll (ISO14443-A) — VERIFIED, two families

```
OUT  55 00 69 00 00 FF 00
IN   55 00 69 00 13 ST 01 [UID buffer (10)] LEN ATQA(2) SAK CASCADE ??
```

- payload length `0x13` (19), in one USB report, so nothing needs reassembling
- `ST` = validity flag: `0x01` card latched, `0x00` nothing (everything after it
  is then garbage and must be ignored)

Two captures from this Reader, one MIFARE Classic 1K and one NTAG215, establish
the layout below. Their ATQA and SAK values agree with the published NXP
assignments for those families, which is what makes this a measurement rather
than a fit:

```
MIFARE Classic 1K  UID 31 F3 0E 0A
  01 01 31 F3 0E 0A 00 00 00 00 00 00 |04| 04 00 |08| 01 10 00
NTAG215            UID 04 43 8A 01 22 09 03
  01 01 04 43 8A 01 22 09 03 1D 00 20 |07| 44 00 |00| 02 00 00
```

| Payload offset | Meaning | Status |
|---|---|---|
| 0 | validity flag (`0x01` latched) — the byte right after the header | verified, two families |
| 1 | constant `0x01`, carries nothing | verified, two families |
| 2..12 | UID buffer, ten bytes; only the first `LEN` are the UID | verified, two families |
| 12 | UID length in bytes: `04`, `07` or `10` | verified, two families |
| 13..15 | ATQA in **transmission order** (LSByte first): `04 00` = 0x0004, `44 00` = 0x0044 | verified, two families |
| 15 | SAK of the last cascade level: `08` = MIFARE Classic 1K, `00` = NTAG21x | verified, two families |
| 16 | cascade level count: `01` for a 4-byte UID, `02` for a 7-byte UID | consistent with both captures, **not established** |
| 17..19 | **unexplained** | documented as unknown |

**The UID length byte is what makes the layout self-describing.** The UID is the
first `LEN` bytes of the ten-byte buffer, so 4-, 7- and 10-byte UIDs all decode
and no width is ever inferred from ATQA bits. Bytes between the UID and `LEN` are
**stale buffer residue**, not Tag data: the same Reader returned different values
for them across captures of one Tag, and zeros when the buffer was clean. The
NTAG215 capture's `1D 00 20` are such residue and must never be presented as part
of the UID or as content.

Nothing else is decoded. Byte 16 is recorded because it agrees with both
captures, but nothing is read out of it; bytes 17..18 have no meaning assigned,
and none is invented for them.

The app decodes this layout in `src/lib/hfDecoder.ts`. A reply of a different
length, a UID length byte other than 4, 7 or 10, an ATQA/SAK pair no published
table assigns, and an all-zero UID each fall back to raw bytes with their own
reason shown — no card type, no capacity, no UID split.

Earlier app code read a 4-byte UID at 2..6 with ATQA at 14..16 and SAK at 17.
That table was one byte off, which is why a real MIFARE Classic 1K capture
matched no published pair. Earlier app code also read the validity flag from
payload byte 1 instead of byte 0, which is why it reported no tag for a latched
reply. `hf_card_from_payload` in `src-tauri/src/reader.rs` reads byte 0 and hands
the raw payload to the frontend undecoded.

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

#### Two payloads for two purposes — Clear and Destroy — IMPLEMENTED, ONE HARDWARE-CONFIRMED

The app writes **the same `0x0073` frame with two different data payloads**, for
two different operations. They are not interchangeable, and which is which is the
whole of the split:

| Operation | customer | facility | card | data32 | What it leaves |
|---|---|---|---|---|---|
| **Clear** | `0x00` | `0xFF` | `0xFFFF` | `0x00FF_FFFF` | A live, rewritable Tag carrying a placeholder no system issues |
| **Destroy** | `0x00` | — | — | `0x00000000` | A Tag that answers every reader and refuses all further data |

Both are 24-byte payloads with the firmware's `00 01 01` enable flags, and both
are **not** a factory reset and **not** an unlock; neither is reachable over this
protocol. The two values are defined once each, in `Identity::CLEARED` and
`Identity::BLANK` (`src-tauri/src/identity.rs`), with the reasoning that chose
them.

**Clear's safety argument is the payload's shape, not its value.** Clear's payload
is *clone-shaped*: customer at `[8]` and `[12]`, data32 at `[16..20]`, exactly the
layout every routine clone write uses — and clone writes have never locked a chip.
The all-zero payload is the one payload no clone ever writes, and it is the one
that locked chips. That is stronger evidence than "the value is non-zero" and still
weaker than a hardware confirmation: no fresh T5577 has been cleared and then
written again, because none is left (see the follow-up ticket).

#### Destroy — writing no Identity — MEASURED: IT PERMANENTLY DISABLES A T5577

Destroy writes the neutral Identity: customer `0x00`, data32 `0x00000000`, in the
usual 24-byte `0x0073` payload (`00 01 01` then all zeros).

**Measured 2026-11-22, three instances — this payload disables the chip.** On a
factory T5577 the write lands: the tag stops presenting an Identity, which is why
the app reports *destroyed*. The chip then **locks**. It still latches and
modulates, so every reader reaches it, but it accepts no further data. Two
`0x0073` writes were acknowledged by the device and ignored by the chip, the second
one after lifting the tag off the Reader and re-presenting it to force a re-latch.
Presence came back as `TagPresence::Blank` before and after both attempts. The
same happened on two further chips.

The consequence is not the one this section used to describe. A destroyed T5577 is
not "empty"; it is a tag that reads as nothing, forever, while looking alive to
every reader it meets. **"The tag went dead" is the wrong diagnosis** in any future
bug report: a Tag that still answers the field is exactly what a destroyed one
looks like, and a reply is not evidence of life.

The read path cannot confirm it the way a clone is confirmed. An all-zero data
field decodes as "no reading", so a Tag that has been destroyed reads as **empty**
— the same as no Tag at all to the combined decoder. That is why the app reports
`destroyed` rather than `verified` (ADR 0003): the success condition of a destroying
write is the absence of an Identity. The presence-aware decode
(`TagPresence::from_read_payload`) keeps that apart from a genuinely empty field:
the destroyed Tag **is latched**, it simply carries an empty data field.

**Observed on hardware, 2026-11-22.** `0x0073` with the neutral payload reports
`destroyed`, and the Tag afterwards reads as `tag present, NO identity (data field
empty)` — latched and modulating, with a zero data field, which is what
`clearprobe -- read` prints. So the neutral write does land, and what follows it is
permanent.

Probe: `cargo run --example clearprobe -- read` (reads only),
`cargo run --example clearprobe -- clear` (writes the placeholder to the Tag on the
Reader) and `cargo run --example clearprobe -- destroy` (writes the neutral
Identity, permanently disabling the Tag). It uses the shipping guard and verdict,
so what it prints is what the app does.

#### Clear — writing the placeholder — IMPLEMENTED, NOT HARDWARE-CONFIRMED

Clear writes customer `0x00`, facility `0xFF`, card `0xFFFF` — data32
`0x00FF_FFFF` — and the re-read is expected to present exactly that value. Unlike
Destroy, its success condition is **positive**: the read-back carries the
placeholder, so the Tag is visible as an object and remains a legal write position
for the next Clone or authored Identity.

**Not yet confirmed on hardware.** The placeholder has never been written to a
fresh T5577, because no fresh T5577 is left. What is known: the payload is
clone-shaped, and clone-shaped writes have never locked a chip; the value is
non-zero and reads back as an Identity rather than as an empty field. What is not
known: whether `0x00FF_FFFF` is accepted and left rewritable by this chip family.
Until a fresh tag is cleared and then written again, that is the one open claim —
see `docs/tickets/studio-redesign-followups/clearing-a-tag-must-leave-it-usable.md`,
whose hardware criterion is deliberately unticked.

### Multi-report frames — VERIFIED (spike 16, 2026-11-21)

Everything above fits in one 64-byte report. Frames that do not are real, in
both directions, and this is how they behave.

**A frame is a continuous byte stream across reports.** Each report carries the
next 64 bytes of that stream. Frames are not framed or padded per report — the
only guide to a frame boundary is the declared length. Zero padding exists, but it
is frame-level padding on short frames, not per-report padding.

Three shapes were observed on hardware against a real NTAG215.

**A reply that overflows by a few bytes** — the `0x0083` body is 64 bytes, so the
71-byte frame splits, and the second report opens mid-payload:

```
OUT  55 00 83 00 06 01 01 00 00 00 00 FF 00
IN   55 00 83 00 40 04 00 00 00 05 00 00 00 00 87 E3 … FF FF FF      (report 1, 64 bytes)
IN   FF FF FF FF FF 24 DB 00 00 …                                    (report 2, 64 bytes)
```

The first report carries the 5-byte header plus 59 payload bytes; the second
carries payload bytes 59..63 and then the `24 DB` checksum, followed by zeros. A
parser that expects `0x55` at the start of every report never sees this frame.
The checksum over `payload[..64 & 0xFF]` recomputes to `24 DB` **only after the
two reports are concatenated**.

**A reply that overflows by a lot** — the `0x0081` read reply is 1284 payload
bytes, a 1291-byte frame, delivered as **21 reports**: 20 full reports and a last
report of 9 payload bytes plus the `FF 00` checksum. A checksum of `FF 00` means
the XOR of `payload[..1284 & 0xFF]` — the first four bytes, the status dword
`00 00 00 00` — is zero.

**A command that overflows** — a `0x0082` write payload is 1328 bytes, a
1335-byte frame, sent as **21 reports of 64 bytes**, and the firmware accepts it:

```
OUT  report 1 starts 55 00 82 05 30 FF FF FF FF FF FF FF FF 05 00 00 00 01 00 00 00 …
     … 20 further reports, the last zero-padded …
```

Inter-report pacing matters for outbound frames. A 5 ms gap between the 21
reports works. A 64 ms gap produces **no reply at all** — the firmware gives up on
the frame. Nothing wedges; the next command works normally.

Practical rule for a reassembler: accumulate every report into one buffer and
parse frames out of the buffer by `5 + LEN + 2` from the `0x55` magic, keeping any
incomplete tail for the next read. Never parse a single report as a frame.

### Checksum for large payloads

The `len & 0xFF` truncation described at the top of this document is not just a
curiosity at the 1328-byte size, and it was confirmed by getting it wrong. For the
write frame, `1328 & 0xFF = 0x30 = 48`, so the checksum covers only the 48 header
bytes (token, type, flag and the 32-byte field at `0x10..0x30`) and **not one byte
of the page data**:

```
checksum over payload[..48]      -> FB 04   parsed by the firmware, answered
checksum over all 1328 bytes     -> DB 24   no reply at all
```

So a checksum computed over the whole payload is silently ignored, not diagnosed.
Generate it the vendor's way.

## NTAG command family — VERIFIED (spike 16, 2026-11-21)

Read and write both work end to end on hardware. A page was written and then
observed on a later read from a separate process.

Status is a little-endian `u32` at payload offset 0 of the reply.

| Status | Meaning |
|---|---|
| `0` | success — read completed, or write carried out |
| `1` | nothing to operate on — no NTAG latched |
| `4` | NTAG ready, info complete |
| `32` | request refused for a bad parameter (see the write section) |

### `0x0083` — NTAG info — VERIFIED

```
OUT  55 00 83 00 06 01 01 00 00 00 00 FF 00
```

Request payload is 6 bytes: `01` count, `01` short flag, then a `u32` little
endian page index (`00 00 00 00`).

Reply with a tag present, 2 reports as shown above, `LEN 0x40`:

| Payload offset | Meaning |
|---|---|
| 0..4 | status `u32` LE — `04 00 00 00` = ready, `01 00 00 00` = no tag |
| 4..8 | tag type `u32` LE — `5` = NTAG215, `0` when no tag. **Not** the value `0x0082` wants; see the write section |
| 9..0x29 | 32 stable bytes, purpose unknown; identical across sessions, so not a session token |
| 0x29 | `01`, purpose unknown |
| 0x2A..0x31 | the tag's **7-byte UID**, low byte first: `04 43 8A 01 22 09 03` |
| 0x31 | `03`, purpose unknown |
| 0x38..0x40 | `FF FF FF FF FF FF FF FF` — upstream calls this the read token; the read works when it is sent back unchanged |

**`LEN 0x40` does not mean data arrived.** The no-tag reply is already a full
64-byte body, so length alone distinguishes nothing; only the status dword does.

### `0x0081` — NTAG read — VERIFIED

```
OUT  55 00 81 00 10 FF FF FF FF FF FF FF FF 05 00 00 00 00 00 00 00 <cksum>
```

Request payload is 16 bytes: the 8-byte token from `0x0083`, the 1-byte tag type,
then 7 zero bytes.

The reply is a stream of `0x0085` page frames followed by one final `0x0081`
frame. Both are covered by the multi-report rules above.

`0x0085` page frame, 6-byte payload, one 13-byte frame per report:

| Offset | Meaning |
|---|---|
| 0 | page number |
| 1 | state — `1` = read ok, `3` = page outside the tag's memory |
| 2..6 | the page's 4 bytes |

Final `0x0081` frame, `LEN 0x504` (1284), **21 reports**:

| Offset | Meaning |
|---|---|
| 0..4 | status `u32` LE — `00 00 00 00` = read completed |
| 4..0x404 | page data, 256 pages × 4 bytes |
| 0x404..0x504 | page states, 256 bytes, same codes as the `0x0085` frames |

**Cross-checks against independently known values.** These are what make the read
a fact rather than a plausible-looking buffer.

The `0x0069` poll returns the full 7-byte UID at `payload[2..9]` —
`04 43 8A 01 22 09 03` — and ISO14443-A says the tag's own anticollision bytes
must agree with it:

| Claim | Expected from the poll UID | Memory read | |
|---|---|---|---|
| page 0 = UID0..UID2 + BCC0 | `04 43 8A` + `0x88^04^43^8A` = `45` | `04 43 8A 45` | ✓ |
| page 1 = UID3..UID6 | `01 22 09 03` | `01 22 09 03` | ✓ |
| page 2[0] = BCC1 | `01^22^09^03` = `29` | `29 48 00 00` | ✓ |

The NFC Forum Type 2 Capability Container is a published constant, not something
the firmware invents:

```
page 3 = E1 10 3E 00
  0xE1  magic, 0x10 = version 1.0, 0x3E = 62 × 8 = 496 bytes of user memory
  ⇒ NTAG215
```

And the user area holds a message that decodes to something readable:

```
pages 4..8: 03 11 D1 01 0D 55 04 64 65 76 67 6F 2E 73 74 75 64 69 6F FE
  TLV 0x03 (NDEF) length 0x11
  NDEF: D1 01 0D 55 04 "devgo.studio"
        short record, well known, type 'U', prefix 0x04 = https://
  ⇒ https://devgo.studio
```

The dump also shows four pages where an NTAG's configuration block would sit. The
field names below are upstream's labels for that layout, and an earlier round of
this spike read them at face value — **do not**, and do not treat them as an
explanation for any write outcome. See open problem 5: the block is identical on
two different chips and is a firmware artifact, not per-tag configuration.

```
page 130: 00 00 00 BD
page 131: 04 00 00 FF     upstream labels: AUTH0 / ACCESS / VCTID / RFUI — NOT real config
page 132: 00 05 00 00
page 133: 00 00 00 00     upstream label: PWD
page 134: 00 00 00 00     upstream label: PACK
```

### `0x0082` — NTAG write — CONFIRMED, single and multi-page (verbatim bytes recorded)

Request payload is exactly **1328 bytes** (`0x530`), sent as 21 reports:

| Offset | Meaning |
|---|---|
| 0..8 | session token from `0x0083` (`FF`×8 on this firmware) |
| 8..12 | **write-path tag selector**, `u32` LE — must be `0..4`; see the warning below |
| 12..16 | `01 00 00 00` — flag |
| 0x10..0x30 | 32 bytes, purpose unknown; zero works |
| 0x30..0x430 | page data, 256 pages × 4 bytes |
| 0x430..0x530 | page states — `2` = write this page, `1` = ok, `4` = failed |

The data table carries the tag's **whole** current image, not just the pages being
written; the state table is what selects pages. Only pages marked `2` are changed.

**Working write of page 4 on a factory-blank NTAG215 (UID
`04 43 7B 01 CC 09 03`).** Request header, then the reply, then the progress
frame, all captured verbatim:

```
OUT  55 00 82 05 30 FF FF FF FF FF FF FF FF 03 00 00 00 01 00 00 00 …   21 reports
     0x30 + 4*4 = CA FE F0 0D        (page 4, the value to write)
     0x430 + 4  = 02                 (state: write page 4)
IN   55 00 82 01 04 00 00 00 00 00 00 00 00 01 00 00 00 …                5 reports
     status dword = 0, page-state table entry page 4 = 0x01
IN   55 00 85 00 06 04 01 CA FE F0 0D 33 CC                              progress frame
```

Read-back, in a **separate process**, i.e. a fresh session and a fresh token:

```
IN   55 00 85 00 06 04 01 CA FE F0 0D 33 CC      page 4 = CA FE F0 0D
```

The same frame writes the page back to its previous contents, and the tag is left
byte-identical to how it started (`03 00 FE 00`, an empty NDEF TLV):

```
IN   55 00 85 00 06 04 01 03 00 FE 00 07 F8      page 4 = 03 00 FE 00, status 0
```

**The tag selector is not the value `0x0083` reports.** This is the single trap in
the command, and it cost a false negative the first time round:

| Value at payload 8..12 | Result |
|---|---|
| `0`, `1`, `2`, `3`, `4` | write accepted, status `0`, page written |
| `5` (what `0x0083` reports for this NTAG215) | **status `32`, nothing written** |
| `6`, `7` | status `32`, nothing written |

Values 3 and 4 produce byte-identical replies for a page-4 write, so what the
field selects is not observable from a single-page write — only that the accepted
range is `0..4` and that `0x0083`'s numbering does not carry over into it. Do not
copy the info reply's tag type into the write request.

**Status `32` means refused, and a refusal is distinguishable without the status
dword.** A refused write returns 256 bytes of uninitialised memory where the page
state table belongs — random values on almost every page — and no `0x0085` page
frames at all. An accepted write returns a clean table with only the requested
pages set to `1`, plus one `0x0085` frame per page.

Values that were tried and do **not** matter, established while the selector was
still wrong: the flag dword (`0`, `1`, `20`), the page-state byte (`0`, `1`, `2`,
`4`), a 400 ms or 1500 ms settle after the read, echoing the info reply's 32-byte
block into `0x10..0x30`, the `0x0083` request's page index and flags, and closing
the read cycle first with the `0x0051` payload-`00` variant. Only the selector
mattered.

**The state table is not limited to one page — CONFIRMED, 2026-11-22.** A single
request marking 13 consecutive pages `2` wrote all 13, and the reply carried one
`0x0085` progress frame per page. The request and reply are recorded verbatim in
the multi-page section below, so this is auditable rather than merely observed.

**Multi-page write — CONFIRMED with verbatim bytes, 2026-11-22.** The earlier
PROVISIONAL label on this section is now withdrawn: a multi-page request and its
replies were recorded frame by frame with the Reader's wire tap, and the read-back
came from a fresh session (device dropped and reopened, not an echo in the same
one). The verbatim transcript is reproduced below the table.

The original three requests (2026-11-21) on the NTAG215 above
(`04 43 7B 01 CC 09 03`, CC `E1 10 3E 00`), sent through the shipping path
(`src-tauri/src/ntag.rs`, probe
`cargo run --example ndefwrite -- --yes-disposable`):

| Request (NDEF message inside a Type 2 TLV) | Pages marked `2` | Reply | Read-back |
|---|---|---|---|
| `03 09 D1 01 54 05 02 65 6E 68 69 FE` — a 9-byte Text message | 4, 5, 6 | status `0`, one `0x0085` frame per page | the 9 bytes, byte for byte |
| `03 2F D1 01 54 2B … FE` — a 47-byte Text message | 4 … 16 | status `0`, 13 `0x0085` frames | the 47 bytes, byte for byte |
| the 9-byte message again, written over the 47-byte one | 4 … 16 | status `0`, 13 `0x0085` frames | the 9 bytes, then zeros |

The third row is the replacing case, which is what an NDEF write is: the request
covers the union of the new message's pages and the pages the previous message
occupied, and everything after the new terminator is zero. A **separate process**
read that tag afterwards and saw pages 4..6 = `03 09 D1 01 / 54 05 02 65 /
6E 68 69 FE` and pages 7..16 all `00 00 00 00`.

Pages 0..3 read identically before and after every request — `04 43 7B B4 /
01 CC 09 03 / C7 48 00 00 / E1 10 3E 00` — so a multi-page write leaves the UID,
the BCC bytes, the static lock bytes and the Capability Container alone.

A message larger than the CC's capacity was refused before any write frame
existed: 500 message bytes, i.e. 505 bytes of TLV, against 496. The tag was
unchanged afterwards, so capacity is enforced by reading the CC rather than by
asking the firmware and hoping.

What is still not exercised: a message that fills the whole 496 bytes (124
pages), and a write in which one page reports state `4` while its neighbours
succeed. Neither is needed to write a normal message; both are recorded here so
the gap is visible rather than assumed away.

The frame that makes this section auditable was recorded on 2026-11-22 with the
Reader's wire tap:

```
cd src-tauri && cargo run --example ndefwrite -- --yes-disposable --record
```

The tap copies what `write_frame_paced` hands the device and what `read_one`
receives; it is observation only, and with `--record` absent the probe's output is
unchanged. Frame bytes below are tapped, not reconstructed. Checksum validity,
report counts and the payload field layout are derived from those tapped bytes and
are labelled as derived.

The message written was a 47-byte Text record (`PM4 Studio NDEF write probe,
multi-page.`) inside a Type 2 TLV — `03 2F D1 01 54 2B 02 65 6E … FE`, 50 TLV
bytes, which is 13 pages.

Outbound request — one `0x0082`, 1335 bytes, sent as **21 reports** of 64 bytes:

```
OUT 0x0082  len=0x0530  cksum=FD 02 ok   total=1335 bytes  21 reports
  frame: 55 00 82 05 30 FF FF FF FF FF FF FF FF 03 00 00 00 01 00 00 …
```

Payload laid out by field:

```
  header          : 55 00 82 05 30 (magic, cmd, declared length)
  token           : FF FF FF FF FF FF FF FF
  selector        : 3 (0x00000003) — 0..4 is accepted; 5 is what 0x0083 reports
                    and 0x0082 refuses
  flag dword      : 01 00 00 00 = 1 (payload 12..16, little endian)
  first data page : 4 (page n sits at 0x30 + 4n; 0x30..0x430 is the carried image)
  pages marked 2  : 13 — the state table at 0x430..0x530 selects them
    page   4 : 03 2F D1 01   page  11 : 74 65 20 70
    page   5 : 54 2B 02 65   page  12 : 72 6F 62 65
    page   6 : 6E 50 4D 34   page  13 : 2C 20 6D 75
    page   7 : 20 53 74 75   page  14 : 6C 74 69 2D
    page   8 : 64 69 6F 20   page  15 : 70 61 67 65
    page   9 : 4E 44 45 46   page  16 : 2E FE 00 00
    page  10 : 20 77 72 69
  state table, non-zero entries: 4:2 5:2 6:2 7:2 8:2 9:2 10:2 11:2 12:2 13:2 14:2 15:2 16:2
  state bytes 0..17 : 00 00 00 00 02 02 02 02 02 02 02 02 02 02 02 02 02
  pages 0..3      : state 0 0 0 0  — UID, lock bytes and CC, never marked
  pages 0..3 carry: 04 73 6E 91 01 B0 09 03 BB 48 00 00 E1 10 3E 00
```

Reply — status `0`, and one `0x0085` progress frame per written page (13 of them),
each naming its page, its state and the four bytes it carried:

```
IN  0x0082  len=0x0004  cksum=… ok   total=11 bytes  1 report
IN  0x0085  len=0x0006  cksum=76 89 ok   total=13 bytes  1 report
IN  0x0085  len=0x0006  cksum=44 BB ok   total=13 bytes  1 report
   … 13 in total, one per page 4..16 …
```

Read-back — taken in a **fresh session**: the probe drops the handle and reopens
the Reader before reading, so the bytes come from the Tag and not from a buffer in
the process that wrote it:

```
# the user memory that fresh read returned, page by page
    page   0 : 04 73 6E 91
    page   1 : 01 B0 09 03
    page   2 : BB 48 00 00
    page   3 : E1 10 3E 00
    page   4 : 03 2F D1 01   (matches the TLV that was written)
    page   5 : 54 2B 02 65   (matches the TLV that was written)
    …
    page  16 : 2E FE 00 00   (matches the TLV that was written)
# the fresh read carries the message that was written: true
```

The probe's own verdict for that run:

```
outcome             : verified
pages asked for     : [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
pages firmware wrote: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
RESULT: MULTI-PAGE WRITE VERIFIED — 13 page(s) written in one 0x0082 request and
read back as the message that was sent.
```

So: one request, two pages would have been enough to show it, but 13 were marked
and all 13 landed; the state table selected exactly those 13 and left pages 0..3 at
state `0`, which is why the UID, the BCC bytes, the static lock bytes and the CC
were untouched. What the earlier record could not show — the request bytes — is now
shown.

Still not exercised, and unchanged by this capture: a message that fills the whole
496 bytes (124 pages), and a write in which one page reports state `4` while its
neighbours succeed. A `--record` read that `drain()` discards as a stale echo is not
logged, because the transport throws it away; resets are marked in the transcript so
a discarded reply can never be spliced onto the next frame.

One later multi-page request *was* recorded byte for byte: the 14-page erase
below has its request header, its state table, its status reply and its read-back
in full, which is why erase is stated as verified on its own evidence. That is one
run of one shape — an empty NDEF TLV over existing content — and it does not make
the three NDEF-write requests above auditable.

The capacity refusal below does **not** depend on the missing frames: it happened
before any write frame existed, so "nothing was written" is the whole claim.

**Correction (ticket 20), about the bytes rather than the write.** The 9-byte
message in the first row is recorded as bytes only. `D1 01 54 05 …` puts the type
byte `54` where the payload length belongs (NDEF orders these TYPE LENGTH,
PAYLOAD LENGTH, TYPE, PAYLOAD), so it is not a well-formed NDEF Text record: the
shipping codec refuses to decode it. The write itself landed — page states and
read-back were as recorded — but a Tag holding those bytes carries a message no
NDEF reader can name. For an erase probe ticket 20 wrote a well-formed Text
record instead (`D1 01 2E 54 02 65 6E …`, 50 message bytes).

### Erasing NDEF content — VERIFIED (ticket 20, 2026-11-21)

There is no separate erase command. Erasing writes an **empty NDEF TLV**
(`03 00 FE`) over the message area with `0x0082`, exactly as a write replaces a
message. It is not a format, not a zeroing of user memory, and not a write to
pages 0..3: the UID, the static lock bytes and the Capability Container stay
byte-identical, so the Tag keeps its size and its NDEF format and becomes a Tag
that carries no Records.

The request covers the union of the new empty TLV and the region the old message
occupied, so an old message's tail cannot stay readable behind the new
terminator. Only user pages from page 4 are marked `2`, through the same page
guard a write uses.

**Recorded run — a 14-page message erased in one request.** The Tag held a
50-byte Text message (`D1 01 2E 54 02 65 6E …`), i.e. a 53-byte TLV written and
read back by the shipping path. Probe:
`cargo run --example ndeferase -- --yes-disposable`.

Request, 1335 bytes over 21 reports — header as sent, then the carried image and
the state table:

```
OUT  55 00 82 05 30 FF FF FF FF FF FF FF FF 03 00 00 00 01 00 00 00   21 reports
     [0x10..0x30] 32 × 00                                  (unknown block, ignored)
     [0x30..0x44] 04 43 7B B4 01 CC 09 03 C7 48 00 00 E1 10 3E 00 03 00 FE 00
                  pages 0..4: UID/BCC/lock/CC carried unchanged, page 4 = 03 00 FE 00
     [0x430..0x43E] 02 × 14                                 (pages 4..17 marked to write)
     tail FD 02    (payload[..0x30]: 0xFF×8 = 0, ^0x03, ^0x01 = 0x02)
```

Reply payloads, verbatim (`0x0085` progress frames then the final `0x0082`):

```
IN   55 00 85 00 06 04 01 03 00 FE 00           page 4 = 03 00 FE 00, state 1
IN   55 00 85 00 06 05 01 00 00 00 00           … one frame per page, 5 through 17
IN   55 00 82 01 04 00 00 00 00 00 …            status dword 0; page-state table 1 for 4..17
```

Read-back pages, verbatim:

```
page 0: 04 43 7B B4    page 1: 01 CC 09 03    page 2: C7 48 00 00    page 3: E1 10 3E 00
page 4: 03 00 FE 00    pages 5..: 00 00 00 00
```

Pages 0..3 are byte-identical to what they were before the erase, page 4 holds
the empty NDEF TLV, and a separate process (`cargo run --example dumpread`) reads
the Tag as an NTAG215 with 496 bytes and no Records. 53 bytes of NDEF content
across 14 pages were cleared.

Run again on the already-erased Tag, the same probe is refused before any frame
exists: *"the tag already carries an empty NDEF message, so there is nothing to
erase"*. That is deliberate: writing `03 00 FE` into memory that holds no NDEF
TLV would be a format, and rewriting an already-empty Tag buys nothing on a risk
that is one-way.

The app reports the outcome as `erased`, which is **not** `verified`: clearing
content places no copy, so no Snapshot's confirmed-copy count moves. A read-back
that still shows content, or pages 0..3 that changed, is a failure on a Tag that
is still readable; a Tag that cannot be read back at all is reported as unknown.

### `0x0084` — format — NOT ATTEMPTED

Destructive and out of scope for this app. Request is the 8-byte session token.

## Password protection (`AUTH0` / `PWD` / `PACK`) — NOT ACHIEVABLE

Password protection on an NTAG21x is three configuration pages: `AUTH0` on page
131, `PWD` on 133, `PACK` on 134. Writing them is how protection is switched on.
**This Reader cannot switch it off again, and cannot even read whether it is on.**

**No authentication command exists.** The command family above is complete: no
`PWD_AUTH`, no MIFARE key authentication, no APDU passthrough. So a password set
through `0x0082` could never be presented at the Tag, and the write that would
put `AUTH0` back to `0xFF` is itself behind the protection it clears. Setting one
is one-way.

**The configuration-area read is not the Tag's configuration.** Pages ≥ 130
return an identical block on two different UIDs (open problem 5). Ticket 21 adds
the argument that settles it — the reported `AUTH0` is contradicted by the same
dump:

```
page   3   E1 10 3E 00       CC, 496 bytes of user memory
page   4   03 09 D1 01 54    the NDEF message, state 1 (read ok)
page 130   00 00 00 BD
page 131   04 00 00 FF       reported AUTH0 = 0x04
page 132   00 05 00 00
page 133   00 00 00 00       reported PWD
page 134   00 00 00 00       reported PACK
page 135   (state 3 — outside the tag's memory)
```

An `AUTH0` of `0x04` would put every access from page 4 onwards behind
`PWD_AUTH`. Pages 4..16 of that same reply read back in full with state `1`. Both
cannot be true, so page 131 is not `AUTH0`: the firmware does not read the
configuration block. `AUTH0 = 0x04` must not be read as "this Tag is protected" —
it was that misreading that made the `status 32` write refusals look like a
hardware limit (open problem 3 has the real cause).

Consequences for the app: protection status is reported as *cannot be
determined*, never as "off"; a Tag whose password is unknown is never presented
as recoverable; and neither setting nor removing a password is offered
(`src-tauri/src/password.rs`, ticket 21).

## `0x0069` payloads, for the record

**Nothing latched.** The poll still returns `LEN 0x13`, and every byte after the
validity flag is unstable garbage — two different payloads inside one second, 54
polls over 40 seconds all `st=0x00`:

```
IN   55 00 69 00 13 00 01 00 08 DB 96 00 08 90 1D 00 20 00 26 00 20 00 00 00 <cksum>
IN   55 00 69 00 13 00 01 00 00 DB 96 00 08 90 1D 00 20 00 27 00 20 00 00 00 <cksum>
```

That is the strongest available confirmation that `ST = 0x00` means "ignore the
rest": the values drift between polls while no tag is present.

**Tag latched.** `ST = 0x01` at payload offset 0, and the reply is
self-describing: the ten-byte UID buffer at offsets 2..11 holds the UID, and
offset 12 says how many of those bytes are real.

NTAG215, 7-byte UID:

```
IN   55 00 69 00 13 01 01 04 43 8A 01 22 09 03 1D 00 20 07 44 00 00 02 00 00 67 98
     [0]=01 ST  [2..9]=04 43 8A 01 22 09 03 UID  [9..12]=1D 00 20 residue
     [12]=07 UID length  [13..14]=44 00 ATQA 0x0044  [15]=00 SAK
     [16]=02 cascade count  [17..18]=00 00 unexplained
```

MIFARE Classic 1K, 4-byte UID:

```
IN   55 00 69 00 13 01 01 31 F3 0E 0A 00 00 00 00 00 00 04 04 00 08 01 10 00 ..
     [0]=01 ST  [2..6]=31 F3 0E 0A UID  [6..12]=00 00 00 00 00 00 residue
     [12]=04 UID length  [13..14]=04 00 ATQA 0x0004  [15]=08 SAK
     [16]=01 cascade count  [17..18]=10 00 unexplained
```

The `1D 00 20` after the NTAG215's UID and the zeros after the Classic's are
buffer residue, not Tag data — repeat captures of one Tag returned different
residue across captures, and the Classic capture above shows the buffer clean.
`0x0044` / `0x00` is the NTAG21x pair and `0x0004` / `0x08` the MIFARE Classic 1K
pair, both per NXP AN10833 Tables 3-4 and the NTAG213/215/216 data sheet Tables
24-25.

### The residue holds whatever the buffer held last — measured 2026-11-22

A later capture of the **same** MIFARE Classic 1K, on a Reader reporting firmware
`H00S07`, returned the same UID, ATQA, SAK, length byte and cascade count with
different residue:

```
IN   ... 01 01 31 F3 0E 0A 30 53 30 37 00 00 04 04 00 08 01 10 00
                             └──────────┘
                             [6..11] residue = "0S07" + two NULs
```

`30 53 30 37` is ASCII `0S07` — the last four characters of the firmware string
`H00S07` that the `0x0053`-family identification reports. The bytes between the
UID and the length byte are therefore a stale copy of whatever the Reader last
wrote into that buffer, not tag data and not random.

This is the clearest evidence for the rule the app follows: **it is why those
bytes must never be presented as UID or as content.** Residue that happens to be
printable ASCII is indistinguishable from data by inspection, so the decoder
never reads them at all — the UID is exactly the first `LEN` bytes of the buffer
and nothing else. A decoder that guessed "ASCII after the UID is a name field"
would have shown `0S07` as part of a bank card.

## Open problems

1. **HF poll bytes 16..18.** The offsets are now measured (see `0x0069` above),
   but byte 16 tracks the cascade level count only by agreement with a 4-byte and
   a 7-byte capture, and bytes 17..18 still have no assigned meaning. A capture
   from a 10-byte-UID Tag would settle byte 16; nothing should be decoded from it
   until one exists.
2. **Multi-page writes — CONFIRMED 2026-11-22.** Ticket 18 marked up to 13 consecutive
   pages in one request and a separate process read every byte back, but the
   request and reply frames were not recorded, so the observation cannot be
   audited from this document the way the single-page write can. See the
   `0x0082` section for exactly what is missing. Unexercised: filling the whole
   496 bytes, and a page that fails mid-write.
3. **What the write-path tag selector means.** `0x0082` accepts `0..4` and rejects
   `5` and above, while `0x0083` reports `5` for the same NTAG215. Values 3 and 4
   are indistinguishable on a single-page write, so the selector's meaning is
   unknown — only its accepted range.
4. **The 32-byte field at info offset 9..0x29** and its echo area at write
   `0x10..0x30`. Stable per tag, unknown purpose, not required for a write.
5. **Pages ≥ 130 do not look like real configuration.** Both tags tested — two
   different UIDs — returned the identical block
   `00 00 00 BD / 04 00 00 FF / 00 05 00 00 / 00 00 00 00`, including for
   `AUTH0`, which cannot plausibly be identical on two different chips. Treat the
   dump's tail as unreliable until a known-good reference tag settles it. It is
   certainly **not** a write blocker: `AUTH0` read `0x04` on the tag that wrote
   successfully.
6. **`C8 42`** meaning in the LF read payload.
7. **What sets the T5577 lock bit.** One write locked a chip; another did not.
   Understanding which payloads are safe would remove the main hazard of the
   `0x0073` path. Destroy's all-zero payload is the one that has locked chips;
   `clearprobe` is the probe that would settle whether Clear's does.

   **The chip mechanism is now documented, and it is a lock rather than wear.**
   From the T5577/ATA5577C/ATA5577M1330C datasheets:

   - The part is rated for **100,000 erase/write cycles**. Rewriting is its
     designed purpose; it is not a single-use part, so the three chips this app
     consumed were not worn out.
   - It has 11 blocks of (32 data bits + **1 lock bit**), and *"once locked, the
     block (including the lock bit itself) is not re-programmable via the RF
     field."*
   - The lock bit travels in **the same command as the data**: *"standard write
     needs the opcode, the lock bit, 32 data bits and the 3-bit address (38 bits
     total)."*
   - There is also an OTP bit that makes every block behave as if locked, and, with
     master key 6, a mode of operation that locks the part forever.

   That last point is the measured behaviour exactly: a locked chip still latches
   and modulates, so every reader reaches it, while it refuses all data — which is
   what the three chips do.

   **The measured correlation on this hardware** is payload *shape*, not payload
   value: the **all-zero** payload locks (three instances, one after a field
   re-seat), while **clone-shaped** payloads — customer at `[8]` and `[12]`, data32
   at `[16..20]`, as every routine Clone writes — have never locked one. Which of
   the 24 payload bytes carries the lock bit is still unknown.

   **The consequence for this app:** a locked chip is alive and visible to every
   reader and permanently refuses data, so "the tag went dead" is the wrong
   diagnosis in any future bug report.

   **The standing task:** if the lock-bit position in the `0x0073` payload is ever
   identified, **Destroy** should set it deliberately — one command, a certain
   result — and **Clear** must then be proven to leave it clear. Until then this
   app must not claim it sets the lock bit, because it does not know which byte
   would.

Solved: **125 kHz write/clone** — command `0x0073`, see above.
Solved: **multi-report reassembly** — verified in both directions, with real
boundaries, see "Multi-report frames".
Solved: **NTAG read** — `0x0081`, verified against the poll UID, the tag's own
BCC bytes, the Type 2 CC and a decoded NDEF record.
Solved: **NTAG write** — `0x0082`, both single-page and multi-page, each read back
from a separate process, see the write section.
Solved: **multi-page NTAG write** — 13 consecutive pages marked `2` in one
1335-byte request sent as 21 reports, 13 `0x0085` progress frames, and a
fresh-session read-back carrying the message. The request and reply frames are
recorded verbatim in the write section, so this is auditable rather than observed.

## Spike 16 finding — NTAG viability

Probe: `src-tauri/examples/ntagspike.rs` (`check`, `wait`, `info`, `read`,
`write`, `transport`). Throwaway, per ADR 0002 — not part of the shipping path.

**The question was whether this Reader can read and write NTAG memory. It can do
both, and both were observed on hardware.**

**Read — verified.** `0x0081` returns a 1284-byte page dump across 21 reports,
preceded by one `0x0085` frame per page, and the contents agree with four things
they were not derived from: the 7-byte UID from the independent `0x0069` poll, the
tag's two ISO14443-A anticollision BCC bytes, the NFC Forum Type 2 Capability
Container, and a decoded NDEF URI. The tag read was an NTAG215 with 496 bytes of
user memory.

**Write — verified.** `0x0082` wrote `CA FE F0 0D` into page 4 of a factory-blank
NTAG215 and reported `status 0` with a single `page 4 = state 1` entry and a
matching `0x0085` progress frame. A subsequent read from a **separate process**
returned `CA FE F0 0D` on page 4. The same command then restored the page to its
original `03 00 FE 00`, and the tag finished byte-identical to how it started.

**Two dead ends worth remembering, because both produced convincing false
negatives.** The first tag available was password-protected as far as its config
dump claimed (`AUTH0 = 0x04`), and every write was refused with `status 32` — that
looked like a hardware limit. It was not: that same `AUTH0` byte appears on two
different tags, so the dump's tail is not real configuration. The actual blocker
was the **write-path tag selector**: `0x0082` refuses the tag type `5` that
`0x0083` reports, and accepts `0..4` instead. With the selector corrected, the
write landed on the very same class of tag.

**The ADR 0002 gate is therefore cleared.** A write was observed to land and was
confirmed by a later read, which is exactly what the ADR required. Slices that
depend on writing 13.56 MHz tags — tickets 18 to 22 — may begin. Ticket 18 has
since reported that several pages marked `2` in one request are written and read
back. An earlier note here called that report PROVISIONAL because its request and
reply frames were not captured; that gap has since been closed — the `0x0082`
section now carries the verbatim 21-report request, its `0x0085` progress frames and
a fresh-session read-back for a 13-page write.

## Legal

This documents a protocol for interoperability with hardware we own. Do not use it
to clone credentials you are not authorised to duplicate.
