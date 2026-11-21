# PM4 Studio

Desktop reader/writer studio for the NFC-PM4 USB RFID reader (VID:PID `0483:4343`),
covering 125 kHz EM4100/T5577 and 13.56 MHz ISO14443-A tags.

## Language

**Reader**:
The physical NFC-PM4 USB device. One Reader is attached at a time, and only one
process can hold it open.
_Avoid_: writer, scanner, device, dongle, hardware

**Tag**:
A physical RFID transponder, whatever its form factor (card, fob, sticker,
implant). The form factor is never part of the model.
_Avoid_: card, fob, badge, chip, transponder

**Blank**:
A Tag that carries no identity and can accept a write. Blankness is a state, not
a product category — a Tag becomes Blank again only by being written to.
_Avoid_: empty tag, new tag, unwritten tag, virgin tag

**Snapshot**:
An immutable record of one read of one Tag: what it was, what it held, and when
it was read. Snapshots are the library's durable unit and are never edited after
creation except for their name and note.
_Avoid_: saved tag, entry, item, record, capture

**Draft**:
An editable collection of Records that is not yet bound to any Tag. A Draft may
be written many times, producing a Snapshot-quality result on each Tag it lands
on.
_Avoid_: template, payload, package, message

**Record**:
One NDEF record within a message — a single typed value such as a URL, a phone
number, or a Wi-Fi credential.
_Avoid_: entry, item, field, row

**NDEF message**:
The ordered sequence of Records that a Tag holds as a unit. Writing replaces the
message; Records are never appended to a Tag in place.
_Avoid_: payload, content, data

**Identity**:
The value that makes a 125 kHz Tag recognisable to a reader. For EM4100 this is
the customer byte plus a 32-bit data field, of which the high byte decodes as a
facility code and the low two bytes as a card number.
_Avoid_: serial, uid, badge id, number

**UID**:
The factory-burned serial of a 13.56 MHz Tag. Distinct from an Identity, which is
rewritable on 125 kHz and is not factory-burned.
_Avoid_: serial, id, identity

**Clone**:
Copying one Tag's Identity onto a Blank, producing a Tag that presents the same
Identity as the source.
_Avoid_: copy, duplicate, backup, backup tag

**Reset**:
Blanking a Tag's Identity so it carries no assigned value. Reset does **not**
restore a factory configuration, and does **not** unlock a locked Tag.
_Avoid_: wipe, erase, format, factory reset, restore

**Card type**:
The tag family derived from a 13.56 MHz Tag's ATQA and SAK values (for example
MIFARE Classic 1K). A derived label, never a value read directly from the Tag.
_Avoid_: chip type, model, family

**Frame**:
One 64-byte protocol packet exchanged with the Reader: magic byte, command id,
declared payload length, payload, and checksum.
_Avoid_: packet, message, buffer

**Command**:
A protocol operation addressed by a 16-bit id (for example `0x0072` for a
125 kHz read).
_Avoid_: opcode, request, verb

**Spike**:
A throwaway experiment whose only purpose is to settle whether an unverified
protocol capability works on real hardware. A Spike produces a finding, not a
feature.
_Avoid_: prototype, test, proof of concept, experiment

**Slice**:
A vertically complete, shippable unit of work that a user can exercise
end-to-end. Slices are ordered, and a later Slice may be gated on a Spike.
_Avoid_: phase, stage, milestone, epic

## Relationships

- A **Snapshot** holds one **Identity** (125 kHz) or one **UID** plus one **NDEF message** (13.56 MHz)
- A **Draft** holds zero or more **Records**
- A **Clone** consumes one **Blank** and the **Identity** from one **Snapshot**
- A **Reset** consumes one non-**Blank** Tag and leaves a **Blank**
- A **Frame** carries exactly one **Command**
- A **Slice** may be gated on a **Spike**

## Flagged ambiguities

- "badge" was used for both the user's building credential and any arbitrary tag.
  Resolved: the object is a **Tag**; "badge" is no longer used.
- "reset" was used for three different operations — restoring a factory
  configuration, blanking an identity, and unlocking a chip that refuses writes.
  Resolved: **Reset** means blanking the Identity only. The other two are not
  possible over this protocol.
- "record" was used for both a library entry and an NDEF record. Resolved: a
  library entry is a **Snapshot**; an NDEF record is a **Record**.
- "clone" was used for both copying an Identity and copying an NDEF message.
  Resolved: **Clone** is reserved for Identity copying on 125 kHz; copying an
  NDEF message between 13.56 MHz Tags is **Copy** and is out of scope for now.
- "blank" was used as both a noun for a product you buy and a state a Tag is in.
  Resolved: **Blank** is a state.
