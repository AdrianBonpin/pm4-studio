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
A Tag that carries no Identity. Blankness is a state, not a product category — a
Tag becomes Blank again only by being written to. A Blank is not necessarily a
Tag that will take a write: that is **Writability**, which cannot be observed
before trying, and a **Destroy** leaves a Tag Blank and permanently unable to
accept data. A **Clear** leaves a Tag carrying the **Cleared** placeholder, which
is *not* Blank — it reads as an Identity, which is what keeps it writable.

This is the only survivor of the family of "blank" words in the interface: it is
a noun for a state a Tag can be in, and it is never a verb. The operation that
produces the state is **Destroy**, and the operation a user reaches for is
**Clear**.
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
Identity as the source. A Clone is confirmed by comparing an Identity.
_Avoid_: copy, duplicate, backup, backup tag

**Copy**:
Moving a whole NDEF message from one 13.56 MHz Tag to another. Confirmed by
comparing the decoded Records in order, not the bytes, because a Tag may
legitimately re-encode a message it accepts.
_Avoid_: clone, duplicate, transfer, backup

**Outcome**:
What one operation did, as a closed typed value. The single input to both the
visible message and the audible signal, so the two can never disagree.
_Avoid_: result, status, response, event

**Signal**:
The audible report of one Outcome: one, two or three chirps, or their absence.
Made of chirps, and never the only report of anything.
_Avoid_: beep, chirp, tone, alarm, sound

**Toast**:
The transient on-screen report of one Outcome, in the corner the user chose.
Announces an event, never a condition.
_Avoid_: notification, alert, banner, snackbar, popup

**Quiet level**:
The three-way audible-feedback preference: off, errors and warnings only, all.
_Avoid_: beep toggle, mute, volume

**Switcher**:
The interface's one control for choosing exactly one of a handful of options in place:
band modes, Collections, Settings groups, Quiet level, the Toast corner. It is a group
of toggle buttons carrying `aria-pressed`, and it is deliberately **not** a tab strip —
it owns no panel, hides nothing from find-in-page, and needs no arrow-key roving focus.
_Avoid_: chip, tab, tab strip, segmented control, pill

**Search**:
The affordance that narrows a list by what the user types: a case-insensitive substring
over the fact text of each item, with whitespace compacted before comparing, and the
list returned untouched when nothing is typed. One rule serves both of Library's
Collections; a Snapshot's facts and a Draft's facts differ, the comparison does not.
It is a plain substring, not a fuzzy or ranked match, and it never reorders.
_Avoid_: filter, find, quick-find, fuzzy search, ranking

**Writability**:
Whether a 125 kHz Tag will accept a write. Not observable by reading and not
exposed by the protocol; discoverable only by attempting a write.
_Avoid_: blankness, lock state, write protection

**UID length**:
The byte in the 13.56 MHz poll reply that states how many bytes of the UID buffer
are real, and therefore what the UID is. Distinct from the UID itself.
_Avoid_: UID size, uid_len, width

**Collection**:
One of the Library's two kinds of saved thing: Snapshots or Drafts. They share a
page and a layout, never a list.
_Avoid_: tab, section, category, type

**Diagnostics**:
The read-only inspection surface in Settings: the capability limits and the
indicator test. The 13.56 MHz memory-dump mode is named Memory, so that "look in
Diagnostics" has exactly one destination.
_Avoid_: tools, debug, advanced, inspect

**Clear**:
Overwriting a Tag's Identity with the **Cleared** placeholder, so the Tag stops
being a working credential and stays a live, rewritable chip. Clear is the
everyday operation and the name of the 125 kHz mode that offers it. It does
**not** restore a factory configuration, it does **not** unlock a locked Tag, and
it does **not** destroy the Tag: a Cleared Tag reads back as an Identity, so a
Clone or an authored Identity can be written onto it afterwards. It *is* a write,
which is why it is also the only way to find out whether a Tag will accept one:
no cheaper test exists (ADR 0007), and the attempt can fail.
_Avoid_: wipe, erase, format, factory reset, restore, reset, blank (as a verb)

**Cleared**:
The state a **Clear** leaves: the Tag carries the placeholder Identity —
customer `0x00`, facility `0xFF`, card `0xFFFF` — which no building system issues,
so it opens nothing, and which is non-zero, so the Tag keeps reading and keeps
accepting writes. The placeholder is defined once, in `Identity::CLEARED`
(`src-tauri/src/identity.rs`), with the reasoning that chose it.

**Destroy**:
Overwriting a Tag's Identity with the neutral one — customer `0x00`, data32
`0x00000000` — which on a T5577 leaves the Tag **permanently disabled**: it keeps
latching and modulating, so every reader still reaches it, and it refuses all
further data. Measured three times on 2026-11-22, once after a field re-seat, and
explained by the chip's per-block lock bit (see `docs/PROTOCOL.md`, open problem
7). Destroy is deliberate, destructive and never the default; it cannot be
recovered, reused or unlocked, and there is no factory restore in this protocol.
_Avoid_: wipe, erase, format, factory reset, restore, reset, recover, reuse

**Reset**:
**Not used in the interface.** The word named the single destructive operation
this app used to offer as its routine one, and it invited exactly the factory-restore
reading the hardware cannot satisfy. The operation it named is now **Clear**
(routine, reversible) and **Destroy** (deliberate, destructive), and the interface
says those words. The word survives only in historical documents — this glossary's
own history, ADRs and hardware run reports — where it names the operation that
came before the split.
_Avoid_: using it for either current operation

**Erase**:
Clearing a 13.56 MHz Tag's NDEF content by writing an empty NDEF TLV (`03 00 FE`)
over the message area. An erased Tag is still a Tag: it keeps its UID, its
Capability Container and its format, and carries no Records. Erase is not a
format, not a Clear and not a Destroy, and does not lock or password-protect
anything.
_Avoid_: format, wipe, reset, blank, unlock

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

- A **Snapshot** holds one **Identity** (125 kHz) or one **UID** plus one **NDEF message** (13.56 MHz), never both
- A **Snapshot**'s 13.56 MHz half carries its **Records**, so a saved read is reviewable with no Reader attached
- A **Draft** holds zero or more **Records**
- A **Collection** holds either **Snapshots** or **Drafts**, never both in one list
- A **Clone** consumes one **Blank** and the **Identity** from one **Snapshot**
- A **Copy** consumes one 13.56 MHz Tag's **NDEF message** and replaces another Tag's
- A **Clear** consumes one non-**Blank** Tag and leaves it **Cleared**: still a Tag, still writable, carrying a placeholder no system issues
- A **Destroy** consumes one non-**Blank** Tag and leaves it **Blank** and permanently unable to accept data
- An **Erase** leaves a **Tag** present with no **Records**; it is neither a
  **Clear** nor a **Destroy**, and it does not make the Tag **Blank**
- A **Frame** carries exactly one **Command**
- A **Slice** may be gated on a **Spike**
- An **Outcome** reports one operation and produces exactly one **Toast** and at most one **Signal**
- A **Signal** is made of one to three chirps
- A **Quiet level** governs which **Signals** are emitted
- A **Switcher** holds a fixed set of options and exactly one is current
- A **Switcher** chooses a mode, a Collection, a group or a corner; a button performs an operation and is never dressed as one
- A **Search** narrows **Snapshots** or **Drafts** and never reorders them

## Flagged ambiguities

- "badge" was used for both the user's building credential and any arbitrary tag.
  Resolved: the object is a **Tag**; "badge" is no longer used.
- "reset" was used for three different operations — restoring a factory
  configuration, overwriting an Identity with the neutral one, and unlocking a chip
  that refuses writes. Resolved: the word is retired from the interface. The second
  operation split into **Clear** (writes a placeholder; the Tag stays usable) and
  **Destroy** (writes the neutral Identity; the Tag is permanently disabled), and
  the other two are not possible over this protocol.
- "record" was used for both a library entry and an NDEF record. Resolved: a
  library entry is a **Snapshot**; an NDEF record is a **Record**.
- "clone" was used for both copying an Identity and copying an NDEF message.
  Resolved: **Clone** is Identity copying on 125 kHz; **Copy** is whole-message
  copying on 13.56 MHz. Both are in scope, and the distinction survives because
  the two verify differently.
- "blank" was used as both a noun for a product you buy and a state a Tag is in.
  Resolved: **Blank** is a state. It is never a verb, and it is not a word the
  Clear/Destroy panel uses at all — the operations are **Clear** and **Destroy**.
- "diagnostics" meant both the 13.56 MHz memory-dump mode and the Settings group
  holding the capability limits. Resolved: the mode is **Memory**; the Settings
  group is **Diagnostics**.
- "beep", "notification" and "alert" were used interchangeably for three
  different things. Resolved: a **Signal** is audible, a **Toast** is on screen,
  and an **Outcome** is neither — it is what both are derived from.
- "provisional" appeared in the interface for a decoded 13.56 MHz reading whose
  byte offsets had never been measured. Resolved: the offsets are now measured
  against two tag families, so the interface no longer claims provisionality and
  the word must not be reused for a claim that is still a guess.
- "chip" named three different things: the control that switches a band page between
  Read, Write, Clear, Clone and Batch, the two-way pair that chooses how an Identity is
  entered, and the row of console presets. Resolved: the control is a **Switcher**; the
  console presets are buttons that fill a field and are drawn as buttons; the Identity
  pair is the same **Switcher** as everywhere else. "Chip" no longer names any of them.
- a **UID** was previously taken at a fixed width that padded a short UID with
  zeros, which made a MIFARE Classic 1K read as a seven-byte NTAG215. Resolved:
  the reply states its own **UID length**, and no surface names a family it has
  not resolved.
