# PM4 Studio

A small, honest desktop app for the cheap **NFC-PM4 / CYBDZKJ-BSJ** USB RFID reader
that shows up on AliExpress and Shopee as an "IC/ID copier writer duplicator".

The vendor ships a Windows-only, opaque binary and points you at a download page
through a `.url` shortcut on a 21 KB fake USB stick. This is an alternative: a
native **macOS** app (and it builds on Linux/Windows too) that speaks the reader's
actual USB HID protocol directly.

![status](https://img.shields.io/badge/status-alpha-orange)

## What the hardware actually is

```
VID:PID        0483:4343          (STMicro VID + arbitrary PID; 0x4343 = ASCII "CC")
Manufacturer   CYBDZKJ-BSJ
Product        TCC-TSY-TBY
Serial         BEGIN-2025
```

It is a composite USB device with two interfaces:

| Interface | Class | Purpose |
|---|---|---|
| 0 | Mass Storage (SCSI, bulk-only) | 21.5 KB FAT12 volume holding one `.url` file |
| 1 | **HID**, usage page `0xFF00`, 64-byte IN + 64-byte OUT reports | all real traffic |

It is **not PC/SC**, **not CCID**, and **not** a libnfc-supported PN532-USB device.
`pcscd`, `nfc-list`, NFC Tools, `proxmark3` and friends will never see it. The
family it most resembles is [wcopy / PN532-in-HID](https://github.com/mariogiordano96/wcopy-nfc-linux),
but the command set is vendor-specific.

## Features

- **Device inspection** — VID/PID, product, manufacturer, serial
- **125 kHz badge read** (EM4100) — decoded ID, `data32`, facility/card number
- **125 kHz badge write / clone** — writes a scanned badge id onto a blank
  T5577 and verifies by reading it back
- **13.56 MHz poll** (ISO14443-A) — UID
- **Audible signals** — one chirp when an operation is confirmed good, two when
  its result needs checking, three when it fails or is refused, and silence when
  nothing happened; a three-way quiet level (off, errors and warnings only, all)
  persisted between launches
- **Raw command console** — send any hex frame, see the reply and whether the
  checksum verifies

### Deliberately not implemented

- **No NTAG memory read/write.** `0x83`/`0x81`/`0x82` are documented upstream but
  their replies span multiple reports, which needs a reassembly layer.
- **No ATQA/SAK decoding.** Offsets aren't confirmed against a real HF card yet,
  so only the UID is reported and the raw payload is shown for inspection.
- **No guard against locking a T5577.** A write with a bogus payload can
  permanently lock a chip. The app warns before writing and never writes
  automatically, but the chip-level risk is real — use blanks.

## Requirements

- Rust (edition 2021), and [bun](https://bun.sh) for the frontend
- The reader plugged in. No driver, no kext, no VM — macOS talks to it through
  IOKit HID in userspace.

## Build & run

```sh
bun install
bun run tauri:dev      # dev with hot reload
bun run tauri:build    # .app + .dmg in src-tauri/target/release/bundle/
```

Before claiming a change works, run the whole verification battery:

```sh
bun run verify         # design gate, types, tests, Rust tests
```

`bun run build` runs the design check first, so a design-rule violation fails the
build and `verify` alike. The Rust tests are the slow step; `bun run design:check`,
`bun run typecheck` and `bun run test` are the fast ones to run while iterating.

Headless transport check (read-only, safe with a badge on the reader):

```sh
cd src-tauri && cargo run --example probe
```

Protocol unit tests run against real captured frames, no hardware needed:

```sh
cd src-tauri && cargo test
```

## Protocol

Full write-up in [`docs/PROTOCOL.md`](docs/PROTOCOL.md). Short version — every
frame is 64 bytes, zero-padded:

```
[0]      0x55              magic
[1..3]   command           u16 BE
[3..5]   payload length    u16 BE
[5..]    payload
[..+2]   checksum          (x ^ 0xFF, x)   where x = XOR of payload bytes
```

Verified commands:

| Command | Meaning | Request (hex) |
|---|---|---|
| `0x0051` | wake / select (echoes) | `55 00 51 00 01 01 FE 01` |
| `0x0053` | chirp, and LED on (fire-and-forget) | `55 00 53 00 00 FF 00` |
| `0x0055` | LED off (not a beep) | `55 00 55 00 00 FF 00` |
| `0x0069` | 13.56 MHz poll | `55 00 69 00 00 FF 00` |
| `0x0072` | 125 kHz read | `55 00 72 00 02 00 01 FE 01` |
| `0x0073` | **125 kHz write (EM4100)** | 24-byte payload, see `docs/PROTOCOL.md` |

## Credits

The protocol was reverse-engineered by other people first. This project stands on:

- **[vicrodh/cyb-nfc](https://github.com/vicrodh/cyb-nfc)** — identified the
  `55 cmd len payload (x^FF, x)` frame layout and the XOR checksum quirk.
- **[journeyman846/nfcx-tool](https://github.com/journeyman846/nfcx-tool)** —
  documented the vendor HID endpoints (`0x02` out / `0x82` in) and the `0x72`
  125 kHz response layout.

Both independently flagged the same conclusion: this reader is cheap, and the
vendor software is not worth trusting. Buy a PC/SC reader if you need a real one.

## Disclaimer

Use this on hardware and credentials you **own or are explicitly authorised to
access**. Reading your own badge is fine. Cloning someone else's access card,
hotel key or transit card is a criminal offence in most jurisdictions. The author
accepts no liability for misuse.

## License

MIT
