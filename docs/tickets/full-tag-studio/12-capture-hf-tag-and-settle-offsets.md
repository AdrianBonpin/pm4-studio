# 12: Capture a 13.56 MHz tag and settle the offsets

**What to build:** A real capture from a physical tag is recorded as a fixture, the ATQA and SAK offsets are confirmed or corrected against it, and both the protocol documentation and the decoder are updated so decode becomes verified rather than provisional. This ticket requires a human to tap tags; it is not completable by an agent alone.

**Blocked by:** 11

**Seams:**
- S5 HF decoder — the captured fixture becomes the independent expected value the decoder is tested against, replacing the current hypothesis.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/2
**Status:** ready

- [ ] At least one real 13.56 MHz capture is recorded, with its card family identified independently of the app.
- [ ] ATQA and SAK read from the confirmed offsets agree with that independent identification.
- [ ] A second tag of a different family is captured and also decodes correctly.
- [ ] The protocol document marks the offsets verified and cites the capture as evidence.
- [ ] The provisional label is removed from the readout.
- [ ] If the offsets differ from the hypothesis, the decoder is corrected and the old expectation is documented as wrong.
