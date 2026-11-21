# Full Tag Studio — 125 kHz and 13.56 MHz read, write, and library

**Baseline:** 0441edea74a8e91a7a7160eaa36a71fecc95bdac   **Branch:** feat/tag-studio   **Date:** 2026-11-21

## Problem Statement

The Reader currently does two things well: it reads a 125 kHz identity, and it
clones that identity onto a Blank. Everything else the hardware might do is
either unwired or unknown.

That leaves three gaps the user hits immediately.

**Reading 13.56 MHz tells you almost nothing.** A tap yields a UID and a wall of
raw bytes. The tag family, and therefore anything about memory or capability, is
not shown — not because the Reader refuses to say, but because the byte offsets
that would carry ATQA and SAK have never been confirmed against real hardware.

**Nothing survives the session.** A read is a transient screen. A credential that
took effort to identify, or a Blank that was cloned for a coworker, leaves no
record. The existing saved-tag store lives inside webview storage: it cannot be
exported, inspected, or backed up, and it disappears silently if that storage is
cleared. For a tool whose subject is building-access credentials, that is the
wrong durability.

**Writing is one narrow path.** You can clone a tag you already hold. You cannot
create an identity from scratch, cannot write one identity to several Blanks, and
cannot blank a tag to reuse it.

The ambition is the capability set of NFC Tools, applied to tag families this
Reader can actually reach.

## Solution

PM4 Studio becomes a tag studio organised around what a tag *is*, not around
which radio it uses.

**Two durable objects.** A **Snapshot** is what a tag was when it was read — id,
type, decoded fields, timestamp, note — and is never edited afterwards. A
**Draft** is an editable NDEF message with no tag attached, which may be written
any number of times. Keeping these separate is what makes "clone this to five
Blanks" and "keep a record of every credential I have read" both natural instead
of contending for one object.

**A library that outlives the app.** Snapshots and Drafts live in a local JSON
file in the app data directory, browsable with no Reader attached, exportable in
one action, written atomically so a crash cannot corrupt it.

**13.56 MHz that explains itself.** A tap reports the UID, and — when the
ATQA/SAK pair matches a known tag family — the card type, its memory size, and
whether it is NDEF-formatted. When the pair does not match, the app says so and
shows raw bytes rather than inventing a type.

**125 kHz that finishes the job.** Read, clone, batch-clone one identity to
successive Blanks, author an identity by hand, and blank a tag to reuse it.

**Writing that is honest about risk.** Every write shows what it will replace.
Nothing is written blind. A write whose outcome cannot be confirmed is reported
as *unknown*, never as success.

Delivery is four ordered Slices, the last gated on a hardware Spike.

## User Stories

**Reader and connection**

1. As a user, I want the app to tell me clearly when no Reader is attached, so that I know the problem is the cable and not my tag.
2. As a user, I want the Reader to connect without installing a driver or kernel extension, so that the app works on a clean Mac.
3. As a user, I want a second launch of the app to refuse politely rather than fight the first for the device, so that I never see an opaque USB access error.
4. As a user, I want the reader's firmware version visible somewhere, so that I can report what hardware a bug occurred on.

**125 kHz reading**

5. As a user, I want to tap a 125 kHz tag and see its Identity, facility code, and card number, so that I can confirm which credential I am holding.
6. As a user, I want the raw payload available alongside the decoded values, so that I can verify a decode I do not trust.
7. As a user, I want polling to stop while a write is in progress, so that a stale read is never mistaken for a write result.

**125 kHz cloning and authoring**

8. As a user, I want a guided clone flow that requires the source tag to be removed before a Blank is written, so that I cannot overwrite my source credential by leaving it on the reader.
9. As a user, I want the app to refuse to write when it cannot read the tag currently on the Reader, so that a misplaced tag cannot cause a blind write.
10. As a user, I want the app to refuse to write a tag that already presents the target Identity, so that I am protected from the chip-locking case that has already destroyed one Blank.
11. As a user, I want to hold one source Identity and write successive Blanks without re-reading the source, so that producing fobs for several coworkers is not repetitive.
12. As a user, I want each attempt in a batch to report its own result, so that I can tell which fob succeeded and which did not.
13. As a user, I want to author an Identity by entering customer, facility, and card values, so that I can mint a fresh credential rather than only duplicating one.
14. As a user, I want to enter a raw five-byte Identity too, so that I can reproduce a value I already have in hex.
15. As a user, I want out-of-range entries rejected with the valid range shown, so that I do not write a malformed Identity.
16. As a user, I want to blank a tag's Identity so that the tag carries no assigned value, so that I can retire or reuse a fob.
17. As a user, I want blanking described as blanking, so that I am not misled into expecting a factory reset the hardware cannot perform.
18. As a user, I want to be told that a blanked tag may read as empty, so that I do not mistake an expected outcome for a failure.

**13.56 MHz reading**

19. As a user, I want a tap to report the UID, so that I can identify a card.
20. As a user, I want the card type shown when the ATQA/SAK pair matches a known family, so that I know what I am holding.
21. As a user, I want capacity shown only when the ATQA/SAK pair uniquely determines it, and the family named with capacity marked unavailable when several chips share one pair, so that a missing number reads as a hardware limit rather than an app failure.
22. As a user, I want an unrecognised ATQA/SAK pair to show raw bytes and no type, so that the app never presents a guess as a fact.
23. As a user, I want the technologies a tag supports listed, so that I know what operations are plausible on it.
24. As a user, I want a response whose declared length is not the expected one to fall back to raw display, so that an unexpected tag format does not produce garbage decoded as fields.

**Library and snapshots**

25. As a user, I want to save a read as a Snapshot with a name and note, so that a credential I identified stays identified.
26. As a user, I want to rename a Snapshot, so that I can fix a name I chose in a hurry.
27. As a user, I want to delete a Snapshot, with confirmation, so that stale credentials do not accumulate.
28. As a user, I want to browse, search, and sort Snapshots with no Reader attached, so that the library is useful away from the hardware.
29. As a user, I want each Snapshot to record how many times it has been written, so that I know how many copies exist.
30. As a user, I want to export the whole library to a file and import it back, so that I can back it up or move it to another machine.
31. As a user, I want my library to survive app updates and webview storage being cleared, so that it is not accidentally disposable.
32. As a user, I want to see an empty state that explains what a Snapshot is, so that an empty library is not a blank confusing screen.
33. As a user with hundreds of Snapshots, I want the list to stay responsive, so that the library does not become a liability as it grows.
34. As a user, I want to be told the library is local plaintext and never synced, so that I understand where building credentials are stored.

**Drafts and records**

35. As a user, I want to create a Draft, add Records to it, and save it, so that I can prepare a payload before I have a tag in hand.
36. As a user, I want Drafts to persist between sessions, so that work is not lost when I close the app.
37. As a user, I want Drafts shown separately from Snapshots, so that "my tags" always means tags.
38. As a user, I want to author Text, URL, Custom URI, Phone, Email, Contact, SMS, Location, Wi-Fi, and Bluetooth Records, so that the common cases are forms rather than hex.
39. As a user, I want generic MIME and external-type Records, so that the editor is not a dead end for anything not in the list.
40. As a user, I want to add, edit, reorder, and delete Records within a Draft, so that I can compose a multi-record message.
41. As a user, I want to see each Record's encoded size and the Draft's total, against tag capacity when that capacity is known, so that I know whether it will fit before writing.
42. As a user, I want to read a tag's records back into a Draft and rewrite the whole message, so that I can edit what is already there.
43. As a user, I want the app to never pretend to append in place, so that I understand a write replaces the message.

**13.56 MHz writing (gated)**

44. As a user, I want a write to show exactly what it will replace, so that I consent to losing the existing contents knowingly.
45. As a user, I want to write a Draft to a tag and have the result read back, so that success means observed, not assumed.
46. As a user, I want a read-back that cannot confirm the write reported as unknown rather than failed, so that I do not discard a tag that may in fact be correct.
47. As a user, I want to erase a tag's NDEF content, so that I can reuse it.
48. As a user, I want to read a tag's raw memory as a page or block dump with an ASCII view, so that I can diagnose a tag the decoder does not recognise.
49. As a user, I want to export a memory dump to a file, so that I can compare captures across sessions.
50. As a user, I want password set and remove available only after the hardware path is proven, so that an unverified operation cannot make a tag unrecoverable.
51. As a user, I want setting a password to warn plainly that losing it makes the tag unrecoverable, so that the consequence is not a footnote.

**Error and edge behaviour**

52. As a user, I want a Reader unplugged mid-operation to produce a clear message and a clean state, so that I can replug and continue without restarting.
53. As a user, I want an operation that wedges the firmware to tell me to replug, so that I am not left guessing why nothing responds.
54. As a user, I want a write that fails verification to leave the Snapshot's write count unchanged, so that counts mean confirmed copies.
55. As a user, I want a corrupted or unreadable library file to be reported without being overwritten, so that a recoverable file is never destroyed for a clean start.
56. As a user, I want the app to explain once, in one place, which fields this Reader cannot produce, so that I am not shown disabled rows on every tag.

## Constraints & Non-Negotiables

**Platform and stack**

- macOS only. No Windows or Linux build, packaging, or testing in this work.
- Tauri 2, React 18, TypeScript, Vite, bun, Rust with `hidapi`. No new heavyweight runtime dependency.
- NDEF encoding and decoding are implemented in-repo rather than pulled from a crate, so the record set stays auditable and the supply chain stays small.
- The existing gridline design system is binding: its tokens, its Space Mono and Outfit pairing, no overscroll, minimum window 900×700.
- Impeccable design vocabulary is binding: no cards inside cards, no badges that carry no meaning, no copy that restates the obvious, no flattened hierarchy.

**Safety invariants**

- Never write without a successful read of the tag in the write position. This is ADR 0001 and is not overridable by a user setting.
- Never write when the tag in position already presents the target Identity.
- The 125 kHz write payload is always exactly 24 bytes. Shorter payloads wedge firmware until physical replug.
- Every write is preceded by a confirmation naming what will be replaced.
- A write whose read-back fails is reported as *unknown*, never as success and never as a definitive failure.

**Data**

- The library is local plaintext JSON in the app data directory. No cloud sync, no telemetry, no analytics, no network calls.
- Library writes are atomic; a crash mid-write must not corrupt the file.
- Migration from the existing webview store is additive and non-destructive: the old store is left intact until the new file exists.
- A library file with an unrecognised schema version is never rewritten.

**Responsiveness**

- The library list stays interactive at 500 Snapshots. File reads and writes never block on the UI, and no operation blocks the window for longer than a single protocol transaction.
- Every device operation has a bounded wait and reports its own failure. An operation that wedges the firmware must say so and name the remedy — a physical replug — rather than leaving the UI waiting.

**Protocol honesty**

- A capability is only presented as supported once it is verified on real hardware.
- Any field whose offsets are unconfirmed is either omitted or shown as raw bytes. No field is populated from an unvalidated guess.
- The protocol document must mark verified behaviour and unverified behaviour separately, and must not silently promote a hypothesis to a fact.

## Boundaries

**In scope**

- Reader connection, firmware version display, single-instance behaviour.
- 125 kHz: read, clone, batch clone, manual Identity authoring, blanking.
- 13.56 MHz: read, UID, card type for recognised ATQA/SAK pairs, technologies, memory size and NDEF status where confirmed, raw fallback.
- Library: Snapshots and Drafts in local JSON, offline browsing, search, sort, rename, delete, write counts, export and import.
- NDEF authoring for Text, URL, Custom URI, Phone, Email, Contact, SMS, Location, Wi-Fi, Bluetooth, MIME, and external types.
- Record queue editing: add, edit, reorder, delete, size accounting.
- Gated 13.56 MHz write, read memory with dump export, erase, and password set/remove.
- The documentation of this Reader's capability limits, stated once.

**Out of scope**

- Copying an NDEF message from one 13.56 MHz tag to another as a discrete operation.
- Locking a tag permanently read-only, and formatting a tag to non-NDEF.
- MIFARE Classic sector authentication, sector read, and sector write. The protocol exposes no key authentication command, so this is not achievable with this hardware.
- Transparent APDU passthrough, and therefore Signature, authenticated NFC counter, and password-protection status.
- 7-byte and 10-byte UID handling. Such tags show raw bytes and no UID split.
- Writing a T5577 configuration block, and therefore a true factory restore.
- Recovering a tag locked by a previous write, or by an unknown password.
- Windows and Linux targets.
- Any network, sync, or multi-device feature.
- Brute force, key recovery, or credential cracking of any kind.

## Implementation Decisions

**Module responsibilities**

- *Protocol transport* — frame construction, report exchange, and a buffered stream reassembler that parses frames out of a byte stream so responses spanning multiple reports are reconstructed instead of truncated.
- *Identity codec* — pure functions converting between a 125 kHz payload and an Identity, in both the read layout and the write layout, including the four-byte offset shift between them.
- *Write guard* — the fail-closed decision extracted from the transport as a pure function, so ADR 0001 is testable without hardware.
- *HF decoder* — pure function from a 13.56 MHz payload to a result that is either a decoded reading or an explicit raw-only reading.
- *Card type resolver* — a table from ATQA/SAK to card family and, only where the pair is unambiguous, capacity and NDEF capability. Returns nothing for unknown pairs, and returns family-without-capacity where several chips share a pair.
- *NDEF codec* — pure encode and decode for the supported record set, including TNF and length handling.
- *Library store* — load, save, mutate, migrate, export, and import against a versioned JSON file, with atomic replacement.
- *Command layer* — the Tauri boundary that serialises all of the above to the UI.

**Slice order**

Four ordered Slices. Each is shippable and exercisable on its own.

1. **Library** — the JSON store, Snapshots and Drafts, migration from the webview store, offline browsing, export and import. Lands first because every later Slice writes into it, and because the current store must stop being the thing new work is built against.
2. **13.56 MHz read** — the stream reassembler, the HF decoder, the card type resolver, and the capture that settles the ATQA/SAK offsets. Delivers real decoded readings or honest raw fallback.
3. **125 kHz completion** — blanking, manual Identity authoring, and batch cloning on top of the already-proven read and write path.
4. **13.56 MHz write** — gated on the Spike per ADR 0002: NDEF writing, read memory, erase, and password handling.

The Spike is not a Slice. It produces a finding that decides whether Slice 4 begins.

**Reader ownership and exclusion**

The app enforces a single running instance, so two copies can never contend for the exclusive USB handle and surface an opaque access error.


The Reader is a single mutable resource held by the app. All operations acquire one operation lock. Background polling runs only when no operation holds the lock, so a poll reply can never be consumed as a write's result. This is the fix for the current shared-reader race.

**Data model**

Snapshots and Drafts are separate collections in one file, because they answer different questions and one must never be edited while the other is. The shape that encodes the settlement:

```
Snapshot  { id, name, note, kind: LF | HF, capturedAt, writeCount,
            identity?  (customer, data32, facility, card, raw)
            hf?        (uid, atqa?, sak?, cardType?, technologies,
                        memory?, ndefFormatted?, records?, raw) }
Draft     { id, name, updatedAt, records: Record[] }
Record    { kind, fields, byteLength }
```

`writeCount` is a number, not a list of physical tags — decided deliberately. `identity` and `hf` are optional and mutually exclusive in practice, which is what keeps one collection serving both bands without a discriminated union the UI has to unwrap everywhere.

**Decode policy**

The HF decoder returns decoded values only when the ATQA/SAK pair resolves in the card type table *and* the payload length matches the expected shape. Otherwise it returns a raw-only reading with no card type, no capacity, and no technologies.

Capacity is populated only where the ATQA/SAK pair uniquely determines it, as MIFARE Classic 1K versus 4K. Where several chips share one pair and differ only in capacity — the NTAG21x range is exactly this case, since its capacity requires a command this Reader does not expose — the app names the family and states that capacity is unavailable. A guessed capacity is worse than a missing one, because capacity determines how many bytes a write would send.

**Write result semantics**

A write produces one of four outcomes: refused (guard), written and verified, written but unverified, or failed to transmit. Only the second increments a Snapshot's write count. The third is presented as "unknown", with instructions, not as an error.

**Record composition**

Records are queued in the UI and written as one complete NDEF message. There is no in-place append, matching how the reference product behaves and how the tag families actually work.

## Testing Decisions

**Approved seams**

| Seam | Catches | Misses |
|---|---|---|
| S1 Frame codec — construction, parsing, checksum | Checksum and layout regressions, padding errors | All device state |
| S2 Report stream reassembler | Multi-report reconstruction, partial frames, desync | Whether hardware emits them this way |
| S3 Identity codec — read and write layouts | Facility and card arithmetic, the four-byte write shift, endianness, 24-byte length | Whether the device accepts the payload |
| S4 Write guard — pure decision | Refuse-when-unreadable, refuse-when-source-unchanged | Actual chip locking behaviour |
| S5 HF decoder | Offset handling, ATQA byte order, UID extraction, length-mismatch fallback | **Whether the offsets are correct** — only a hardware capture settles that |
| S6 Card type resolver | Table errors, unknown pairs returning nothing | Vendor-specific SAK variants |
| S7 NDEF codec | Round-trip per record type, TNF and length correctness | Real tag behaviour |
| S8 Library store | Persistence, atomic replace, corruption handling, migration | UI state |

**What a good test looks like here**

Tests assert public behaviour through the seam, with expected values written down independently — a captured frame in the test fixture, not a value the code produced. No test mocks an internal collaborator; the pure seams take bytes and return values, and the library store takes a file path. Where hardware is required, the test is a scripted probe rather than a unit test, and its output is treated as a finding.

**Prior art**

The transport already has Rust unit tests using real captured frames as fixtures, covering checksum, frame layout, and a live no-tag response. The probe and capture binaries under the Rust examples exist for hardware interrogation and are the model for Spike work. Both patterns extend to the new seams.

**E2E: OPTED-OUT**

Browser E2E automation is explicitly not adopted. This is a desktop app whose correctness lives at a hardware boundary that browser automation cannot reach, so automated UI tests would exercise a mocked reader and assert little of value.

Replacing it is a per-Slice manual hardware checklist, run on the real Reader:

1. Read a 125 kHz tag, confirm Identity and facility/card decode against the raw payload.
2. Clone to a Blank, confirm the read-back matches, and confirm the physical credential works at its reader.
3. Attempt a clone with the source tag left in place; confirm refusal, not a write.
4. Batch clone, confirming each attempt reports separately.
5. Blank a tag, confirming the reported outcome matches what a subsequent read shows.
6. Tap a 13.56 MHz tag, confirm the decoded card type against an independent source, or confirm raw-only display for an unknown family.
7. For the gated Slice: read memory, write a Draft, read back, and confirm the records survive round-trip.

## Migration & Rollback

**Migration.** On first launch after this change, the app reads the existing webview saved-tag store and, if the library file does not yet exist, writes those entries as Snapshots into the new file. The old store is left in place and not cleared, so a failed migration loses nothing and the user can re-run it. Entries that cannot be mapped cleanly are preserved as raw-only Snapshots rather than dropped.

**Schema versioning.** The library file carries a version. A file with a newer version than the app understands is never rewritten; the app reports the mismatch and offers an export path. A file that fails to parse is reported and left untouched, never replaced with an empty one.

**Rollback.** The change is additive to a working app. Removing the library file returns the app to an empty library without affecting the Reader. The pre-existing clone path continues to function throughout, so a regression in the new surface does not remove the capability that works today. Because the write guard and the 24-byte payload invariant are preserved unchanged, rollback carries no safety regression.

## Domain Model

**Glossary.** `GLOSSARY.md` is created by this work. Sixteen terms are canonical: Reader, Tag, Blank, Snapshot, Draft, Record, NDEF message, Identity, UID, Clone, Reset, Card type, Frame, Command, Spike, Slice.

Five ambiguities were resolved during this work and are recorded there:

- "badge" meant both the user's building credential and any tag → **Tag**.
- "reset" meant factory restore, identity blanking, and unlocking → **Reset** is blanking only; the other two are impossible here.
- "record" meant both a library entry and an NDEF record → **Snapshot** and **Record**.
- "clone" meant both identity copying and NDEF copying → **Clone** is 125 kHz only.
- "blank" meant both a product category and a state → **Blank** is a state.

**ADRs.**

- `0001` — Refuse to write 125 kHz tags unless the tag can be read first. Records why the fail-closed guard exists and why it must not be removed as a convenience fix.
- `0002` — Gate 13.56 MHz write behind a hardware spike rather than committing to it. Records why the spec contains a conditional Slice and what the documented outcome is if the spike fails.

## Open Questions

| Question | Owner | Must resolve before |
|---|---|---|
| ATQA/SAK offsets at payload 14–16 and 17 — hypothesis only, contradicted by the one redacted frame available | Hardware capture with a real 13.56 MHz tag | HF decode Slice ships. Until then decode is raw-only. |
| Whether 7-byte and 10-byte UIDs change the payload length or tail layout | Hardware capture with an NTAG | Any claim about UID completeness. Out of scope for now: such tags show raw. |
| Whether NTAG commands 0x0081–0x0085 work on this Reader at all | The Spike, per ADR 0002 | Gated write Slice begins. If negative, HF stays read-only and that is the recorded outcome. |
| What sets the T5577 lock bit, and whether a blanking write can trigger it | Protocol research plus careful hardware probes on sacrificial Blanks | Blanking is offered as anything other than destructive-with-warning. |
| How to distinguish two identical Blank tags across batch attempts | Engineering, during the LF Slice | Batch mode claims per-attempt certainty. Until then, results are per-attempt and require re-seating. |
| Meaning of the constant `C8 42` in the 125 kHz read payload | Optional protocol research | Nothing. Recorded for completeness. |
