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

### `0x0069` — 13.56 MHz poll (ISO14443-A)

```
OUT  55 00 69 00 00 FF 00
IN   55 00 69 00 13 ST 01 [UID(4)] …tail…
```

- payload length `0x13` (19)
- `ST` = validity flag: `0x01` card latched, `0x00` nothing (UID field is then
  garbage and must be ignored)
- UID at payload offset 2..6

**Not verified — the tail offsets are a hypothesis.** Upstream reports `ATQA
0x0004, SAK 0x08` (MIFARE Classic 1K) for one card, but we have not reproduced
this on real HF hardware. Nothing below is backed by a capture from this
Reader; it comes from third-party client source:

| Payload offset | Meaning (hypothesis) |
|---|---|
| 0 | validity flag (`0x01` latched) — the byte right after the header |
| 1 | constant `0x01`, carries nothing |
| 2..6 | UID, 4 bytes |
| 6..14 | unconfirmed |
| 14..16 | ATQA, byte-swapped relative to how NXP quotes it |
| 16 | unconfirmed |
| 17 | SAK of the last cascade level |
| 18 | unconfirmed |

> **Counter-evidence from a real capture.** A latched NTAG215 was captured — see
> "`0x0069` payloads, for the record" below. Its payload carries a **7-byte UID
> at offsets 2..9**, and the tail after that UID does not resemble ATQA/SAK. For
> that Tag the hypothesis above yields no resolvable ATQA/SAK pair, so the
> readout correctly falls back to raw bytes with the reason shown instead of
> naming a family. This is one more reason the decoded values below stay
> provisional until ticket 12.

The whole reply is 19 bytes in one USB report, so nothing needs reassembling.
The app decodes this layout in `src/lib/hfDecoder.ts` and **labels every decoded
value provisional** until a real capture confirms or corrects it. A reply of a
different length, an ATQA/SAK pair no published table assigns, or a UID field
that cannot hold the announced UID all fall back to raw bytes with the reason
shown — no card type, no capacity, no UID split.

Earlier app code read the validity flag from payload byte 1 instead of byte 0,
which is why it reported no tag for a latched reply. `hf_card_from_payload` in
`src-tauri/src/reader.rs` now reads byte 0 and hands the raw payload to the
frontend undecoded.

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

Read works end to end. Write is refused by the firmware on the tag that was
available, for a reason that is visible in that tag's own configuration.

Status is a little-endian `u32` at payload offset 0 of the reply.

| Status | Meaning |
|---|---|
| `0` | read completed |
| `1` | nothing to operate on — no NTAG latched |
| `4` | NTAG ready, info complete |
| `32` | write refused (see the write section) |

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
| 4..8 | tag type `u32` LE — `5` = NTAG215, `0` when no tag |
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

The dump also shows the tag's configuration pages, which matter for the write
section:

```
page 130: 00 00 00 BD
page 131: 04 00 00 FF     AUTH0 = 0x04, ACCESS = 0x00, VCTID = 0x00, RFUI = 0xFF
page 132: 00 05 00 00
page 133: 00 00 00 00     PWD
page 134: 00 00 00 00     PACK
```

### `0x0082` — NTAG write — REFUSED on the tag tested (status 32)

Request payload is exactly **1328 bytes** (`0x530`), sent as 21 reports:

| Offset | Meaning |
|---|---|
| 0..8 | session token from `0x0083` (`FF`×8 on this firmware) |
| 8..12 | tag type `u32` LE |
| 12..16 | `01 00 00 00` — flag |
| 0x10..0x30 | 32 bytes, purpose unknown; upstream leaves them zero |
| 0x30..0x430 | page data, 256 pages × 4 bytes |
| 0x430..0x530 | page states — `2` = write this page, `1` = ok, `4` = failed |

The firmware answers, `LEN 0x104` (260) over 5 reports:

```
IN   55 00 82 01 04 20 00 00 00 E9 FF FF FF 00 00 00 00 80 00 00 00 …
     status dword = 0x20 = 32
```

`32` arrives with **no `0x0085` page frames at all**, and a read-back shows the
target page unchanged. Everything past the status dword is uninitialised firmware
memory — the 256 "page state" bytes are random and must not be read as states.
The refusal is immediate and happens before any page is attempted.

Twelve variants were tried, all answered `32`:

| Varied | Values tried |
|---|---|
| flag at 12..16 | `0`, `1`, `20` |
| page state byte | `0`, `1`, `2`, `4` |
| settle after read | 400 ms |
| outbound report gap | 5 ms (answered), 64 ms (no reply) |
| 32-byte field at 0x10..0x30 | zeros, and the info reply's 32-byte block from offsets 8 and 9 |
| `0x0083` request | page index 0, page index 20, count 2, flag 0 |
| checksum | `len & 0xFF` (answered), full length (no reply) |

**Why it is refused, and why that is not the end of the story.** The tag's own
configuration says writes from page 4 upward need authentication:

```
page 131 = 04 00 00 FF   ->  AUTH0 = 0x04
page 133 = 00 00 00 00   ->  PWD   = 00000000
```

`AUTH0 = 0x04` with `ACCESS = 0x00` (write protection only) means every page from
4 up refuses a write until `PWD_AUTH` succeeds. This protocol has **no
authentication command** — the same limit that rules out MIFARE Classic sectors.
So on this tag the firmware cannot legitimately write anything: pages 0..3 are the
always-protected header and everything from page 4 needs a password. A
factory-blank NTAG has `AUTH0 = 0xFF` (no protection), and that case is **untested**.

Note that the write handler does run and does look at the field: with no tag in
the field the same frame returns status `1`, not `32`.

### `0x0084` — format — NOT ATTEMPTED

Destructive and out of scope for this app. Request is the 8-byte session token.

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

**Tag latched.** `ST = 0x01` at payload offset 0, and the payload carries the
**full 7-byte UID** at offsets 2..9, not just four bytes:

```
IN   55 00 69 00 13 01 01 04 43 8A 01 22 09 03 1D 00 20 07 44 00 00 02 00 00 67 98
     [0]=01 ST  [2..9]=04 43 8A 01 22 09 03  UID (7 bytes, NTAG215)
```

The tail after the UID (`1D 00 20 07 44 00 00 02 00 00`) does not look like ATQA
and SAK: it contains values shaped like firmware pointers, the same shape the
no-tag payloads contain. ATQA/SAK offsets therefore remain **unconfirmed** for
13.56 MHz, and the app must keep treating that tail as raw bytes.

## Open problems

1. **ATQA/SAK offsets** for the HF poll tail. A latched NTAG215 poll was captured
   (above) and its tail does not resemble ATQA/SAK, so ticket 12's capture still
   has to settle where those fields are — or that they are not transmitted. Until
   it does, the app decodes the hypothesised layout in `src/lib/hfDecoder.ts` and
   marks every decoded value provisional; a reply whose pair does not resolve
   falls back to raw bytes.
2. **Writing to a factory-blank NTAG.** The one tag available was password
   protected (`AUTH0 = 0x04`), so the write path was refused with status `32`
   before any page was attempted. Whether `0x0082` writes on an unprotected tag is
   the single open question in the NTAG family.
3. **The 32-byte field at info offset 9..0x29** and its echo area at write
   `0x10..0x30`. Stable per tag, unknown purpose.
4. **`C8 42`** meaning in the LF read payload.
5. **What sets the T5577 lock bit.** One write locked a chip; another did not.
   Understanding which payloads are safe would remove the main hazard of the
   `0x0073` path.
6. **The trailing `0x01`** in the `0x0054` version payload, and whether the
   revision string ever carries a second component.

Solved: **125 kHz write/clone** — command `0x0073`, see above.
Solved: **multi-report reassembly** — verified in both directions, with real
boundaries, see "Multi-report frames".
Solved: **NTAG read** — `0x0081`, verified against the poll UID, the tag's own
BCC bytes, the Type 2 CC and a decoded NDEF record.

## Spike 16 finding — NTAG viability

Probe: `src-tauri/examples/ntagspike.rs` (`check`, `wait`, `info`, `read`,
`write`, `transport`). Throwaway, per ADR 0002 — not part of the shipping path.

**Reading 13.56 MHz memory works.** `0x0081` returns a full 1284-byte page dump
across 21 reports, and its contents agree with four things they were not derived
from: the 7-byte UID from the independent `0x0069` poll, the tag's two ISO14443-A
anticollision BCC bytes, the NFC Forum Type 2 Capability Container, and a
human-readable NDEF URL. The tag on the Reader was identified as an **NTAG215**
with 496 bytes of user memory. Memory dump, NDEF read-back and page-level access
are all viable — tickets 19 and 22 have a working foundation.

**Writing memory is refused on the tag tested.** `0x0082` is accepted as a frame
and answered with status `32` before any page is attempted, across twelve
parameter variants, and nothing in memory changes. The cause is visible in the
tag: `AUTH0 = 0x04` with `PWD = 00000000`, i.e. writes to every user page require
a `PWD_AUTH` that this protocol does not implement. **That is a tag-configuration
limit, not a demonstrated hardware refusal.** A factory-blank NTAG (`AUTH0 =
0xFF`) has never been tried here.

**Therefore the ADR 0002 gate stays closed.** No write was observed to land, so
13.56 MHz stays read-only and tickets 17 to 22 do not begin. What this spike
changed is the *reason*: reads are proven and the transport is proven, so the
gate now rests on one narrow, answerable question — does `0x0082` write on an
unprotected tag? — rather than on whether the command family exists at all.

**To answer it** — with PM4 Studio quit, place a **factory-blank NTAG213/215**
(never written, `AUTH0 = 0xFF`) on the Reader and run, from `src-tauri/`:

```
cargo run --example ntagspike -- check    # validity 0x01 plus a 7-byte UID
cargo run --example ntagspike -- info     # status 4, tag_type 3/4/5/6
cargo run --example ntagspike -- read     # page table; check page 131 reads FF 00 00 FF
cargo run --example ntagspike -- write 4 deadbeef --yes-disposable
```

The write targets one page (four bytes), carries the tag's whole current image so
no other page can change, and restores the page afterwards. Only run it on a tag
its owner is willing to lose.
Contributions with real captures welcome.

## Legal

This documents a protocol for interoperability with hardware we own. Do not use it
to clone credentials you are not authorised to duplicate.
