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

### `0x0083` / `0x0081` / `0x0082` / `0x0084` — NTAG operations

Documented upstream as NTAG info / read / write / format. **Not implemented
here.** Their replies can report a payload length larger than a single 64-byte
report (`LEN 0x40` observed on `0x0083`), so multiple reports must be reassembled
before the payload is meaningful.

## Open problems

1. **ATQA/SAK offsets** for the HF poll tail. Not yet captured from a real
   13.56 MHz card, so this app reports only the UID plus the raw payload.
2. **Multi-report reassembly** for NTAG responses.
3. **`C8 42`** meaning in the LF read payload.
4. **What sets the T5577 lock bit.** One write locked a chip; another did not.
   Understanding which payloads are safe would remove the main hazard of the
   `0x0073` path.

Solved: **125 kHz write/clone** — command `0x0073`, see above.

Contributions with real captures welcome.

## Legal

This documents a protocol for interoperability with hardware we own. Do not use it
to clone credentials you are not authorised to duplicate.
