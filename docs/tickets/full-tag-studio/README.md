# Full Tag Studio

**Spec:** docs/superpowers/specs/2026-11-21-full-tag-studio.md
**Baseline:** 0441edea74a8e91a7a7160eaa36a71fecc95bdac
**Branch:** feat/tag-studio

## Graph

| Ticket | Blocked by | Delivers |
|---|---|---|
| 01 Extract the Identity codec and write guard | None | The fail-closed guard becomes provable without hardware; read and clone behaviour unchanged |
| 02 Reader identity: single instance, firmware, stated limits | None | A second launch refuses instead of fighting for the USB handle; firmware visible; limits stated once |
| 03 Snapshots persist to a library file, browse offline | 01 | Read, save, quit, reopen with no Reader and still see it |
| 04 Manage Snapshots: rename, note, delete, search, sort | 03 | A library of 500 stays usable |
| 05 Export and import the library | 03 | Back the library up or move it in one action |
| 06 Migrate existing saved reads | 03 | Current saved reads appear as Snapshots, non-destructively |
| 07 Drafts and the NDEF record queue | 03 | Compose a Draft with Text/URL Records and keep it across restarts |
| 08 Remaining Record types and size accounting | 07 | Phone, Email, Contact, SMS, Location, Wi-Fi, Bluetooth, MIME, external, with byte totals |
| 09 Write counts on Snapshots | 03 | Confirmed copies counted; nothing else increments |
| 10 Card type resolver | None | Known ATQA/SAK pairs resolve; unknown pairs return nothing |
| 11 HF decoder and decode-aware readout | 10 | Tap → family, technologies, capacity-or-unavailable, raw fallback |
| 12 Capture a 13.56 MHz tag and settle the offsets | 11 | A real fixture replaces the hypothesis; decode becomes verified |
| 13 Reset: blank a Tag's Identity | 01 | A tag carries no assigned Identity, labelled as blanking |
| 14 Author an Identity by hand | 01, 03 | Enter customer/facility/card or raw hex, write it, keep it |
| 15 Batch Clone | 01, 03, 09 | One source, successive Blanks, per-attempt results |
| 16 Spike: NTAG command viability | None | A finding that decides whether 17–22 begin |
| 17 Report stream reassembler | 16 | Multi-report responses reconstructed |
| 18 Write a Draft to a Tag | 07, 16, 17 | Records land, read back, outcome classified |
| 19 Read memory dump and export | 16, 17 | Page/block dump with ASCII, exported |
| 20 Erase a Tag's NDEF | 16, 17 | Content cleared, tag reusable |
| 21 Password set and remove | 16, 17 | Gated, with the unrecoverable warning |
| 22 Load a Tag's Records into a Draft | 07, 19 | Read, edit, rewrite the whole message |

**Initial frontier:** `01`, `02`, `10`, `16` — four tickets with no blockers. They touch
disjoint areas, so all four can run in parallel.

## Slice mapping

| Spec slice | Tickets |
|---|---|
| Prefactor | 01 |
| 1 — Library | 02, 03, 04, 05, 06, 07, 08, 09 |
| 2 — 13.56 MHz read | 10, 11, 12 |
| 3 — 125 kHz completion | 13, 14, 15 |
| 4 — 13.56 MHz write (gated) | 16, 17, 18, 19, 20, 21, 22 |

## Deviations from the spec's slice composition

These were reviewed and approved during planning.

1. **The reassembler moved from Slice 2 to the gated slice (17).** The 13.56 MHz poll is a
   single report, so the reassembler changes nothing observable until NTAG commands exist.
   Building it inside Slice 2 would have been a horizontal infrastructure ticket.
2. **The capture is its own ticket (12), after the decoder.** Decode ships degrading to
   raw-only, so Slice 2 does not block on a human tapping a card, and the capture later
   promotes decode from provisional to verified.
3. **Drafts and the record editor land before the Spike (07, 08).** Authoring Records is
   pure codec work that touches no hardware. Only writing to a tag (18) is gated.
4. **Ticket 02 was added.** The spec's stories for single-instance behaviour and firmware
   visibility had no home in any slice, and no single-instance plugin exists today.

## Open questions

| Question | Owner | Must resolve before |
|---|---|---|
| Does a set password need to be stored by the app so it can be removed later? The spec does not say. | User | Ticket 21 |
| How should two physically identical Blanks be distinguished across batch attempts? | Engineering | Ticket 15 |
| If the Spike is negative, do 17–22 stay written as deferred, or get deleted? | User | Ticket 16 completes |
