//! Hardware probe: write one whole NDEF message to a 13.56 MHz Tag.
//!
//! This is the probe ticket 18 needs. The spike (ticket 16) proved a *single*
//! page write; an NDEF message spans several pages and needs several page-state
//! entries set in one request, which is open problem 2 in docs/PROTOCOL.md. This
//! runs the shipping code path (`pm4_studio_lib::ntag`) against a real Tag and
//! prints exactly what happened, so the multi-page question is answered by a
//! transcript rather than by assumption.
//!
//! Usage (from src-tauri/):
//!
//!   cargo run --example ndefwrite -- --yes-disposable
//!   cargo run --example ndefwrite -- --yes-disposable --record
//!   cargo run --example ndefwrite -- --yes-disposable --message-hex D1010455...
//!
//! `--yes-disposable` is required: the Tag's existing NDEF message is replaced.
//! Only run this with a Tag you are willing to lose.
//!
//! `--record` adds a verbatim transcript: the frames that actually crossed the
//! USB HID channel, in both directions, plus the read-back from a fresh session.
//! It is off by default, so without it this probe prints exactly what it always
//! printed. The transcript is what docs/PROTOCOL.md needs to promote the
//! multi-page section from PROVISIONAL to verified; see ticket 18.
//!
//! Exits 0 when the read-back matched what was written, 1 when the write was
//! sent but not confirmed, 2 when nothing was written or the probe could not run.

use pm4_studio_lib::ntag::{self, MemoryImage, DEFAULT_TAG_SELECTOR};
use pm4_studio_lib::reader::{hex, Reader, VID, PID};
use pm4_studio_lib::wire_record::{self, Direction, RawFrame, Wire};

/// A multi-page Text Record. `PM4 Studio NDEF write probe, multi-page.` is 41
/// bytes of text, so the record is 43 payload bytes, the message 48 and the TLV
/// 51 — 13 pages, i.e. twelve more than the spike ever wrote in one request.
const PROBE_TEXT: &str = "PM4 Studio NDEF write probe, multi-page.";

/// A well-known Text Record: `D1 01 <len> 'T' <status> "en" <text>`.
///
/// `D1` is MB | ME | SR | TNF 1, i.e. a short, well-known record that is both
/// the first and the last of the message. `status` is the language-code length
/// in its low six bits, with bit 7 clear for UTF-8.
fn text_record(language: &str, text: &str) -> Vec<u8> {
    assert!(language.len() <= 0x3F, "a language code cannot exceed 63 bytes");
    let mut payload = vec![language.len() as u8];
    payload.extend_from_slice(language.as_bytes());
    payload.extend_from_slice(text.as_bytes());
    assert!(payload.len() <= 0xFF, "this probe writes short records only");
    let mut message = vec![0xD1, 0x01, 0x54, payload.len() as u8];
    message.extend_from_slice(&payload);
    message
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if !args.iter().any(|a| a == "--yes-disposable") {
        eprintln!(
            "refusing to write: pass --yes-disposable and only with a Tag you are willing \
             to lose. The Tag's existing NDEF message is replaced."
        );
        std::process::exit(2);
    }

    let message = match args.iter().position(|a| a == "--message-hex") {
        Some(at) => {
            let raw = args.get(at + 1).cloned().unwrap_or_default();
            match pm4_studio_lib::reader::parse_hex(&raw) {
                Ok(bytes) if !bytes.is_empty() => bytes,
                _ => {
                    eprintln!("--message-hex needs an even number of hex digits");
                    std::process::exit(2);
                }
            }
        }
        None => text_record("en", PROBE_TEXT),
    };

    // Off unless asked for: the transcript is observation only, and without it
    // this probe's output is unchanged.
    let record = args.iter().any(|a| a == "--record");

    let reader = match Reader::open() {
        Ok(reader) => reader,
        Err(e) => {
            eprintln!("{e}");
            eprintln!(
                "if this is 0xE00002C5 another process holds the device — quit PM4 Studio \
                 and retry; do not kill anything."
            );
            std::process::exit(2);
        }
    };
    println!("opened {VID:04x}:{PID:04x}");
    println!(
        "message to write: {} bytes  ({} pages of TLV plus overhead)",
        message.len(),
        pm4_studio_lib::ntag::wrap_ndef_message(&message).len().div_ceil(4)
    );
    println!("  message hex : {}", hex(&message));
    println!(
        "  TLV         : {}",
        hex(&pm4_studio_lib::ntag::wrap_ndef_message(&message))
    );
    println!("  tag selector: {DEFAULT_TAG_SELECTOR} (0x0082 refuses the 5 that 0x0083 reports)");

    println!("\n== what the Tag holds now (a read; nothing is written yet) ==");
    let checked = ntag::preview(&reader, &message);
    match &checked.tag {
        Some(tag) => {
            println!("  UID                 : {}", tag.uid);
            println!("  0x0083 tag type     : {}", tag.reported_tag_type);
            println!(
                "  capacity from CC    : {}",
                tag.capacity_bytes
                    .map(|b| format!("{b} bytes"))
                    .unwrap_or_else(|| "unknown (not a Type 2 Capability Container)".into())
            );
            println!("  holds now           : {} state", tag.existing.state);
            if let Some(hex) = &tag.existing.message_hex {
                println!("    message ({} bytes): {hex}", tag.existing.bytes);
            }
            if let Some(reason) = &tag.existing.reason {
                println!("    note: {reason}");
            }
        }
        None => println!("  no Tag read"),
    }
    println!(
        "  message needs       : {} bytes",
        checked.required_bytes
    );
    if let Some(refusal) = &checked.refusal {
        println!("\nRESULT: REFUSED — {refusal}");
        println!("Nothing was written.");
        std::process::exit(2);
    }
    println!("  would write         : pages start at 4, {} page(s)", checked.required_bytes.div_ceil(4));

    println!("\n== writing ==");
    if record {
        // Everything from the write's own read onwards is kept verbatim. The
        // tap copies bytes into a log; it changes nothing that is transmitted.
        reader.start_recording();
    }
    let report = ntag::write_message(&reader, &message);
    let write_wire = reader.recording().unwrap_or_default();
    println!("  outcome             : {}", report.outcome.as_str());
    if let Some(message) = &report.message {
        println!("  detail              : {message}");
    }
    println!("  pages asked for     : {:?}", report.wrote_pages);
    println!("  pages firmware wrote: {:?}", report.accepted_pages);
    if let Some(after) = &report.readback {
        println!("  read-back state     : {}", after.existing.state);
        println!("  read-back bytes     : {}", after.existing.bytes);
        if let Some(hex) = &after.existing.message_hex {
            println!("  read-back message   : {hex}");
            println!(
                "  read-back is the message that was written : {}",
                hex == &message_hex(&message)
            );
        }
    } else {
        println!("  read-back           : the Tag could not be read back");
    }

    // The verdict the ticket is asking for, stated as evidence rather than as a
    // claim: how many pages were in one request, how many the firmware reported
    // writing, and whether the read-back carried the message.
    let pages = report.wrote_pages.len();
    let confirmed = report.outcome == pm4_studio_lib::write_outcome::WriteOutcome::Verified;
    println!("\n== verdict ==");
    println!("  pages in one request: {pages}");
    println!(
        "  firmware reported   : {} page(s) written",
        report.accepted_pages.len()
    );
    if confirmed {
        println!(
            "  RESULT: MULTI-PAGE WRITE VERIFIED — {pages} page(s) written in one 0x0082 \
             request and read back as the message that was sent."
        );
    } else if report.outcome == pm4_studio_lib::write_outcome::WriteOutcome::Unverified {
        println!(
            "  RESULT: MULTI-PAGE WRITE UNVERIFIED — the request was sent and the Tag did \
             not read back as the message; treat the Tag as unknown and re-read it."
        );
    } else if report.outcome == pm4_studio_lib::write_outcome::WriteOutcome::Failed {
        println!("  RESULT: WRITE FAILED — nothing was written.");
    } else {
        println!("  RESULT: REFUSED — nothing was written.");
    }

    // `--record`: the bytes that actually crossed the wire. The write is done, so
    // the device is closed and opened again below and the read-back taken in
    // that fresh session — evidence the Tag retained the message, not an echo in
    // the session that wrote it.
    if record {
        drop(reader);
        let fresh = read_fresh();
        print_transcript(&write_wire, &fresh, &message);
    }

    match report.outcome {
        pm4_studio_lib::write_outcome::WriteOutcome::Verified => std::process::exit(0),
        pm4_studio_lib::write_outcome::WriteOutcome::Unverified => std::process::exit(1),
        _ => std::process::exit(2),
    }
}

fn message_hex(message: &[u8]) -> String {
    hex(message)
}

// ---- the --record transcript ------------------------------------------
//
// Everything below only reads the recording the Reader kept, plus a second
// session's read. No frame is built here: the OUT frames are the bytes the
// writer handed to the device and the IN frames are the reports the device
// returned. What is derived — the checksum verdict, the report arithmetic, the
// field layout — is labelled as derived where it is printed.

/// A second session's read, taken after the device was closed and re-opened.
struct Fresh {
    /// Everything that second session put on the wire.
    wire: Vec<Wire>,
    /// The dump it returned, when it returned one.
    memory: Option<MemoryImage>,
    /// Why there is no dump, when there is none.
    note: Option<String>,
}

/// Close-and-reopen the device, then read the Tag: a clear session boundary.
fn read_fresh() -> Fresh {
    let reader = match Reader::open() {
        Ok(reader) => reader,
        Err(e) => {
            return Fresh {
                wire: Vec::new(),
                memory: None,
                note: Some(format!(
                    "the reader could not be re-opened, so there is no fresh read: {e}"
                )),
            }
        }
    };
    println!("re-opened {VID:04x}:{PID:04x} for a fresh read-back (a separate session)");
    reader.start_recording();
    let read = ntag::read_tag(&reader);
    let wire = reader.recording().unwrap_or_default();
    let (memory, note) = match read {
        Ok(Some(tag)) => (Some(tag.memory), None),
        Ok(None) => (None, Some("no Tag was in the field for the fresh read".to_string())),
        Err(e) => (None, Some(format!("the fresh read failed: {e}"))),
    };
    Fresh { wire, memory, note }
}

/// Print one frame: the summary line, then the frame's bytes verbatim.
fn print_frame(direction: Direction, frame: &RawFrame) {
    println!("{}", wire_record::frame_line(direction, frame));
    if frame.bytes.len() <= 24 {
        print!("  frame: {}", hex(&frame.bytes));
        if let Some(progress) = wire_record::progress(frame) {
            print!(
                "   page {} state={} page-bytes={}",
                progress.page,
                progress.state,
                hex(&progress.bytes)
            );
        }
        println!();
    } else {
        println!(
            "  frame ({} bytes, 16 per line; header 5 bytes, checksum last 2):",
            frame.bytes.len()
        );
        for line in wire_record::hex_lines(&frame.bytes, 16) {
            println!("    {line}");
        }
    }
    if !frame.checksum_ok {
        println!("  ! those checksum bytes do not match the XOR rule over len & 0xFF");
    }
}

/// The frames that travelled one way, in the order they were replayed.
fn frames_travelling(logged: &[wire_record::Logged], way: Direction) -> Vec<&RawFrame> {
    logged
        .iter()
        .filter_map(|entry| match entry {
            wire_record::Logged::Frame { direction, frame } if *direction == way => Some(frame),
            _ => None,
        })
        .collect()
}

/// Bytes the transport threw away at each stream reset in a replay.
fn resets(logged: &[wire_record::Logged]) -> Vec<usize> {
    logged
        .iter()
        .filter_map(|entry| match entry {
            wire_record::Logged::Reset { discarded } => Some(*discarded),
            _ => None,
        })
        .collect()
}

/// The `0x0081` dumps in a recording, in the order they arrived.
fn memory_dumps(logged: &[wire_record::Logged]) -> Vec<MemoryImage> {
    frames_travelling(logged, Direction::In)
        .iter()
        .filter(|frame| frame.cmd == ntag::CMD_NTAG_READ)
        .filter_map(|frame| MemoryImage::from_read_payload(frame.payload()))
        .collect()
}

/// The line that says what a replay's resets discarded, when there were any.
fn reset_note(logged: &[wire_record::Logged]) -> Option<String> {
    let discarded = resets(logged);
    if discarded.is_empty() {
        return None;
    }
    Some(format!(
        "# stream reset(s): {} — bytes discarded at each: {} (a partial frame is never spliced onto the next reply)",
        discarded.len(),
        discarded
            .iter()
            .map(|n| n.to_string())
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

/// Print the whole transcript as one fenced block, ready to paste.
fn print_transcript(write_wire: &[Wire], fresh: &Fresh, message: &[u8]) {
    println!("\n== recording (--record) ==");
    println!(
        "PROVENANCE: TAPPED, not reconstructed. Every OUT line is a frame \
         `Reader::write_frame_paced` handed to the device, byte for byte; every IN \
         line is a report `Reader::read_one` received, cut into frames by the rules \
         `stream::ReportStream` uses. The checksum column is recomputed from those \
         bytes. Reads the code drains and discards before a command (stale echoes) \
         are not in the log, because the transport deliberately throws them away. \
         A long frame is printed whole — header, payload, checksum — so its payload \
         is bytes 5..5+len of that frame."
    );
    println!("\n---8<--- paste from here ---8<---");
    println!("```text");

    let logged = wire_record::replay(write_wire);
    let outs = frames_travelling(&logged, Direction::Out);

    if let Some(note) = reset_note(&logged) {
        println!("{note}");
    }
    println!(
        "# OUT host -> reader, in the order they were written: {} frame(s) — {}",
        outs.len(),
        command_tally(&outs)
    );
    for frame in &outs {
        print_frame(Direction::Out, frame);
    }

    let request = outs.iter().rev().find(|f| f.cmd == ntag::CMD_NTAG_WRITE).copied();
    let structure = request.and_then(|frame| {
        match wire_record::describe_write_payload(frame.payload()) {
            Ok(structure) => Some(structure),
            Err(e) => {
                println!("# the 0x0082 payload cannot be laid out: {e}");
                None
            }
        }
    });
    if let Some(structure) = &structure {
        println!("\n# the 0x0082 payload laid out by field");
        print_write_structure(request.expect("the structure came from a request"), structure);
    }

    let inbound = frames_travelling(&logged, Direction::In);
    println!(
        "\n# IN reader -> host, in the order they arrived: {} frame(s) — {}",
        inbound.len(),
        command_tally(&inbound)
    );
    for frame in &inbound {
        print_frame(Direction::In, frame);
    }

    let dumps = memory_dumps(&logged);
    if dumps.len() >= 2 {
        let marked_last = structure
            .as_ref()
            .and_then(|s| s.marked().last().copied())
            .unwrap_or(USER_FIRST_PAGE_HINT);
        println!("\n# before / after, page by page: the two 0x0081 dumps in this recording");
        print_page_diff(&dumps[0], &dumps[dumps.len() - 1], marked_last);
    } else {
        println!(
            "\n# no before/after page diff: this recording holds {} 0x0081 dump(s)",
            dumps.len()
        );
    }

    println!("\n# a fresh session: the device was closed and re-opened, then read");
    let fresh_wire = wire_record::replay(&fresh.wire);
    if let Some(note) = reset_note(&fresh_wire) {
        println!("{note}");
    }
    let fresh_frames: Vec<&RawFrame> = fresh_wire
        .iter()
        .filter_map(|entry| match entry {
            wire_record::Logged::Frame { frame, .. } => Some(frame),
            _ => None,
        })
        .collect();
    println!(
        "# {} frame(s) from that session: {}",
        fresh_frames.len(),
        command_tally(&fresh_frames)
    );
    for entry in &fresh_wire {
        if let wire_record::Logged::Frame { direction, frame } = entry {
            print_frame(*direction, frame);
        }
    }
    if let Some(note) = &fresh.note {
        println!("# {note}");
    }
    if let Some(memory) = &fresh.memory {
        println!("\n# the user memory that fresh read returned, page by page");
        let tlv = ntag::wrap_ndef_message(message);
        let through = USER_FIRST_PAGE_HINT + tlv.len().div_ceil(4).saturating_sub(1);
        print_pages(memory, through, Some(tlv.as_slice()));
        let user = memory.user_area();
        println!(
            "\n# the fresh read carries the message that was written: {}",
            user.len() >= tlv.len() && user[..tlv.len()] == tlv[..]
        );
    }

    println!("```");
    println!("---8<--- paste to here ---8<---");
}

/// Page 4: the first page a write can mark, always.
const USER_FIRST_PAGE_HINT: usize = 4;

/// How many frames of each command there are, e.g. `0x0085 x13, 0x0082 x1`.
fn command_tally(frames: &[&RawFrame]) -> String {
    let mut counts: Vec<(u16, usize)> = Vec::new();
    for frame in frames {
        match counts.iter_mut().find(|(cmd, _)| *cmd == frame.cmd) {
            Some((_, count)) => *count += 1,
            None => counts.push((frame.cmd, 1)),
        }
    }
    counts.sort_unstable();
    counts
        .iter()
        .map(|(cmd, count)| format!("0x{cmd:04X} x{count}"))
        .collect::<Vec<_>>()
        .join(", ")
}

/// Print the `0x0082` payload by field, so it is obvious which pages it marks.
fn print_write_structure(request: &RawFrame, structure: &wire_record::WriteStructure) {
    let payload = request.payload();
    println!("  header          : {} (magic, cmd, declared length)", hex(&request.bytes[..5]));
    println!("  token           : {}", structure.token_hex);
    println!(
        "  selector        : {} (0x{:08X}) — 0..4 is accepted; 5 is what 0x0083 reports and 0x0082 refuses",
        structure.selector, structure.selector
    );
    println!(
        "  flag dword      : {} = {} (payload 12..16, little endian)",
        hex(&payload[12..16]),
        structure.flag
    );
    println!(
        "  first data page : {} (page n sits at 0x30 + 4n; 0x30..0x430 is the carried image)",
        structure.first_data_page
    );
    println!(
        "  pages marked 2  : {} — the state table at 0x430..0x530 selects them",
        structure.marked().len()
    );
    for entry in &structure.written {
        println!(
            "    page {:>3} : {}   state {}",
            entry.page,
            hex(&entry.bytes),
            entry.state
        );
    }
    let table: Vec<String> = structure
        .states
        .iter()
        .enumerate()
        .filter(|(_, state)| **state != 0)
        .map(|(page, state)| format!("{page}:{state}"))
        .collect();
    println!("  state table, non-zero entries: {}", table.join(" "));
    if let Some(last) = structure.marked().last() {
        let through = (last + 1).min(structure.states.len());
        println!(
            "  state bytes 0..{through} : {} (raw table, so page -> state can be counted)",
            hex(&structure.states[..through])
        );
    }
    println!(
        "  pages 0..3      : state {} {} {} {}  — UID, lock bytes and CC, never marked",
        structure.state_at(0).unwrap_or(0),
        structure.state_at(1).unwrap_or(0),
        structure.state_at(2).unwrap_or(0),
        structure.state_at(3).unwrap_or(0)
    );
    println!("  pages 0..3 carry: {}", hex(&payload[0x30..0x40]));
}

/// Print pages 0..=through of a dump, plus a count of the pages not shown.
fn print_pages(memory: &MemoryImage, through: usize, tlv: Option<&[u8]>) {
    let pages = memory.pages();
    let last = through.min(pages.saturating_sub(1));
    for page in 0..=last {
        let Some(bytes) = memory.page(page) else { continue };
        let note = match tlv {
            Some(tlv) if page >= USER_FIRST_PAGE_HINT => {
                let at = (page - USER_FIRST_PAGE_HINT) * 4;
                let mut expected = [0u8; 4];
                for (offset, slot) in expected.iter_mut().enumerate() {
                    if let Some(&byte) = tlv.get(at + offset) {
                        *slot = byte;
                    }
                }
                if expected == bytes {
                    "   (matches the TLV that was written)"
                } else {
                    ""
                }
            }
            _ => "",
        };
        println!("    page {page:>3} : {}{note}", hex(&bytes));
    }
    if pages > last + 1 {
        println!("    pages {}..{} : {} page(s) not shown", last + 1, pages - 1, pages - last - 1);
    }
}

/// Print the before/after page comparison, changed pages called out.
fn print_page_diff(before: &MemoryImage, after: &MemoryImage, through: usize) {
    let pages = before.pages().min(after.pages());
    if pages == 0 {
        println!("  the dumps carried no pages");
        return;
    }
    let changed: Vec<usize> = (0..pages)
        .filter(|&page| before.page(page) != after.page(page))
        .collect();
    let last = through.max(changed.iter().copied().max().unwrap_or(0)).min(pages - 1);
    println!("    page    before      after");
    for page in 0..=last {
        let (Some(a), Some(b)) = (before.page(page), after.page(page)) else {
            continue;
        };
        println!(
            "    {page:>4}   {}  {}  {}",
            hex(&a),
            hex(&b),
            if a == b { "same" } else { "CHANGED" }
        );
    }
    let rest_changed = changed.iter().filter(|&&page| page > last).count();
    println!(
        "    pages {}..{} : {} page(s), {} changed",
        last + 1,
        pages - 1,
        pages - last - 1,
        rest_changed
    );
}


