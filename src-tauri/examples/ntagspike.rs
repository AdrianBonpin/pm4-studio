//! SPIKE — can this Reader read and write NTAG memory at all?
//!
//! Throwaway probe written for ADR 0002 (docs/adr/0002-gate-hf-write-behind-hardware-spike.md).
//! It answers three questions on real hardware and then stops being useful:
//!
//!   1. Do the NTAG commands `0x0083` (info), `0x0081` (read), `0x0082` (write)
//!      work on this firmware revision at all?
//!   2. Does a read of NTAG memory agree with an independently known value
//!      (the UID from the `0x0069` poll, and the Type 2 Capability Container)?
//!   3. Do responses span more than one 64-byte USB report?
//!
//! It is deliberately not an abstraction: one command per run, raw bytes printed,
//! no UI, no library surface. Payload layouts come from the upstream client
//! (vicrodh/cyb-nfc `cyb_nfc_probe.py`), which is the only place they are written
//! down; they are unverified against this Reader until this probe says otherwise.
//!
//! Usage (run from src-tauri/):
//!
//!   cargo run --example ntagspike -- check
//!   cargo run --example ntagspike -- info
//!   cargo run --example ntagspike -- read
//!   cargo run --example ntagspike -- write <page> <4-byte-hex> --yes-disposable
//!
//! `check` is read-only and safe with any tag. `info` and `read` are read-only.
//! `write` DESTROYS the contents of the tag on the reader and refuses to run
//! without `--yes-disposable`.

use hidapi::{HidApi, HidDevice};
use pm4_studio_lib::reader::{hex, xor_checksum, MAGIC, PID, REPORT_LEN, VID};

use std::thread::sleep;
use std::time::{Duration, Instant};

const CMD_WAKE: u16 = 0x0051;
const CMD_HF_POLL: u16 = 0x0069;
const CMD_LF_READ: u16 = 0x0072;
const CMD_NTAG_READ: u16 = 0x0081;
const CMD_NTAG_WRITE: u16 = 0x0082;
const CMD_NTAG_INFO: u16 = 0x0083;
/// Per-page streaming reply emitted while a read or write runs. Not in any
/// document we had before this spike; observed in the upstream client.
const CMD_NTAG_PAGE: u16 = 0x0085;

/// Size of the NTAG write payload, per the upstream client: 8-byte session
/// token, 4-byte tag type, 4-byte flag, 0x400 bytes of page data, 0x100 bytes
/// of per-page state. 1328 bytes = 21 USB reports.
const NTAG_WRITE_PAYLOAD: usize = 0x530;

// ---- transport --------------------------------------------------------

#[derive(Debug)]
struct RawFrame {
    cmd: u16,
    payload: Vec<u8>,
    declared_len: usize,
    checksum_ok: bool,
}

/// A frame is *only* a complete frame once `declared_len` payload bytes plus the
/// two checksum bytes have all arrived. Anything less stays in the buffer, which
/// is the whole point of this spike: responses can straddle reports.
fn parse_stream(buf: &mut Vec<u8>) -> Vec<RawFrame> {
    let mut out = Vec::new();
    loop {
        // Resync on the magic byte.
        if let Some(pos) = buf.iter().position(|&b| b == MAGIC) {
            if pos > 0 {
                buf.drain(..pos);
            }
        } else {
            buf.clear();
            return out;
        }
        if buf.len() < 5 {
            return out;
        }
        let cmd = ((buf[1] as u16) << 8) | buf[2] as u16;
        let len = (((buf[3] as u16) << 8) | buf[4] as u16) as usize;
        let total = 5 + len + 2;
        if buf.len() < total {
            return out;
        }
        let payload = buf[5..5 + len].to_vec();
        let (c0, c1) = xor_checksum(&payload, Some(len & 0xFF));
        let checksum_ok = buf[5 + len] == c0 && buf[6 + len] == c1;
        out.push(RawFrame {
            cmd,
            payload,
            declared_len: len,
            checksum_ok,
        });
        buf.drain(..total);
        if buf.is_empty() {
            return out;
        }
    }
}

struct Dev {
    dev: HidDevice,
    rx: Vec<u8>,
    reports_in: u32,
    reports_out: u32,
}

impl Dev {
    fn open() -> Result<Dev, String> {
        let api = HidApi::new().map_err(|e| format!("HID init failed: {e}"))?;
        let dev = api.open(VID, PID).map_err(|e| {
            format!(
                "cannot open reader {VID:04x}:{PID:04x}: {e}\n\
                 if this is 0xE00002C5 the device is already claimed — quit PM4 Studio and retry"
            )
        })?;
        Ok(Dev {
            dev,
            rx: Vec::new(),
            reports_in: 0,
            reports_out: 0,
        })
    }

    /// Read one raw 64-byte report, printing it verbatim so multi-report
    /// splitting is visible in the transcript.
    fn report(&mut self, timeout_ms: i32) -> Result<bool, String> {
        let mut buf = [0u8; REPORT_LEN];
        let n = self
            .dev
            .read_timeout(&mut buf, timeout_ms)
            .map_err(|e| format!("USB read failed: {e}"))?;
        if n == 0 {
            return Ok(false);
        }
        self.reports_in += 1;
        println!("  IN  #{:<2} len={:<2} {}", self.reports_in, n, hex(&buf[..n]));
        self.rx.extend_from_slice(&buf[..n]);
        Ok(true)
    }

    fn drain(&mut self) -> usize {
        let mut n = 0;
        while let Ok(true) = self.report(0) {
            n += 1;
            if n > 64 {
                break;
            }
        }
        self.rx.clear();
        n
    }

    /// Send one frame. The frame is built without padding; payloads longer than
    /// 57 bytes are split across as many 64-byte reports as needed, which is how
    /// the 1328-byte NTAG write payload gets on the wire.
    fn send(&mut self, cmd: u16, payload: &[u8]) -> Result<(), String> {
        self.send_full(cmd, payload, false, 5)
    }

    fn send_full(
        &mut self,
        cmd: u16,
        payload: &[u8],
        full_checksum: bool,
        gap_ms: u64,
    ) -> Result<(), String> {
        let mut frame = Vec::with_capacity(5 + payload.len() + 2);
        frame.push(MAGIC);
        frame.push((cmd >> 8) as u8);
        frame.push((cmd & 0xFF) as u8);
        frame.push(((payload.len() >> 8) & 0xFF) as u8);
        frame.push((payload.len() & 0xFF) as u8);
        frame.extend_from_slice(payload);
        let ck_len = if full_checksum {
            payload.len()
        } else {
            payload.len() & 0xFF
        };
        let (c0, c1) = xor_checksum(payload, Some(ck_len));
        frame.push(c0);
        frame.push(c1);

        println!(
            "  OUT cmd=0x{cmd:04X} payload_len={} frame_len={} reports={}",
            payload.len(),
            frame.len(),
            frame.len().div_ceil(REPORT_LEN)
        );
        println!("       frame: {}", hex(&frame[..frame.len().min(16)]).to_owned() + if frame.len() > 16 { " …" } else { "" });
        if payload.len() > 16 {
            println!("       payload[0..16] : {}", hex(&payload[..16]));
            if payload.len() > 32 {
                println!(
                    "       payload[end-8..]: {}",
                    hex(&payload[payload.len() - 8..])
                );
            }
        }

        for (i, chunk) in frame.chunks(REPORT_LEN).enumerate() {
            // hidapi on macOS wants the report id as byte 0; this device has no
            // report ids, so it is 0 and the report body follows.
            let mut buf = [0u8; REPORT_LEN + 1];
            buf[1..1 + chunk.len()].copy_from_slice(chunk);
            self.dev
                .write(&buf)
                .map_err(|e| format!("USB write failed on report {i}: {e}"))?;
            self.reports_out += 1;
            if frame.len() > REPORT_LEN && gap_ms > 0 {
                sleep(Duration::from_millis(gap_ms));
            }
        }
        Ok(())
    }

    /// Read reports until `stop` accepts a parsed frame or the deadline passes.
    fn collect(
        &mut self,
        timeout_ms: u64,
        stop: &dyn Fn(&RawFrame) -> bool,
    ) -> Result<Vec<RawFrame>, String> {
        let deadline = Instant::now() + Duration::from_millis(timeout_ms);
        let mut frames = Vec::new();
        let mut announced = false;
        while Instant::now() < deadline {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if self.report(remaining.as_millis().min(250) as i32)? {
                announced = false;
                for f in parse_stream(&mut self.rx) {
                    println!(
                        "  FRAME cmd=0x{:04X} declared_len={} got={} checksum_ok={}{}",
                        f.cmd,
                        f.declared_len,
                        f.payload.len(),
                        f.checksum_ok,
                        if f.declared_len > REPORT_LEN - 7 {
                            "  <-- spans more than one report"
                        } else {
                            ""
                        }
                    );
                    let hit = stop(&f);
                    frames.push(f);
                    if hit {
                        return Ok(frames);
                    }
                }
            } else if !announced {
                announced = true;
            }
        }
        Ok(frames)
    }
}

fn wake(d: &mut Dev) -> Result<(), String> {
    d.drain();
    d.send(CMD_WAKE, &[0x01])?;
    let _ = d.collect(400, &|f| f.cmd == CMD_WAKE);
    Ok(())
}

// ---- commands ---------------------------------------------------------

fn cmd_check(d: &mut Dev) -> Result<(), String> {
    println!("== 13.56 MHz poll (0x0069) ==");
    wake(d)?;
    d.send(CMD_HF_POLL, &[])?;
    let frames = d.collect(900, &|f| f.cmd == CMD_HF_POLL)?;
    let poll = frames.into_iter().find(|f| f.cmd == CMD_HF_POLL);
    match poll {
        Some(f) => {
            println!("  payload ({} bytes): {}", f.payload.len(), hex(&f.payload));
            for (i, b) in f.payload.iter().enumerate() {
                println!("    [{i:>2}] 0x{b:02X}");
            }
            if f.payload.len() >= 6 && f.payload[0] == 0x01 {
                println!(
                    "  validity flag: 0x01 (tag latched)  UID {}",
                    hex(&f.payload[2..6])
                );
            } else {
                println!(
                    "  validity flag: 0x{:02X} — NO 13.56 MHz tag latched",
                    f.payload.first().copied().unwrap_or(0xFF)
                );
            }
        }
        None => println!("  no reply to 0x0069 at all"),
    }

    println!("\n== 125 kHz read (0x0072) ==");
    d.send(CMD_LF_READ, &[0x00, 0x01])?;
    if let Some(f) = d
        .collect(900, &|f| f.cmd == CMD_LF_READ)?
        .into_iter()
        .find(|f| f.cmd == CMD_LF_READ)
    {
        println!("  payload ({} bytes): {}", f.payload.len(), hex(&f.payload));
        if f.payload.len() >= 3 {
            println!("  validity flag: 0x{:02X}", f.payload[2]);
        }
    } else {
        println!("  no reply to 0x0072");
    }

    d.send(0x0055, &[])?; // LED off, as a courtesy
    Ok(())
}

fn cmd_info(d: &mut Dev) -> Result<(), String> {
    // Upstream: "count, short_count_flag, then uint32 page index".
    let payload = [0x01u8, 0x01, 0x00, 0x00, 0x00, 0x00];
    println!("== NTAG info (0x0083) ==");
    wake(d)?;
    d.send(CMD_NTAG_INFO, &payload)?;
    let frames = d.collect(5_500, &|f| {
        f.cmd == CMD_NTAG_INFO && f.payload.len() >= 0x40
    })?;
    let mut found = false;
    for f in &frames {
        if f.cmd == CMD_NTAG_INFO && f.payload.len() >= 4 {
            let status = u32::from_le_bytes([f.payload[0], f.payload[1], f.payload[2], f.payload[3]]);
            println!("  status_dword={status}");
            if f.payload.len() >= 8 {
                let kind = u32::from_le_bytes([f.payload[4], f.payload[5], f.payload[6], f.payload[7]]);
                println!("  tag_type={kind}");
            }
            if f.payload.len() >= 0x40 {
                println!("  read_token={}", hex(&f.payload[0x38..0x40]));
                found = true;
            }
        }
    }
    println!("\n  {} frame(s), report_count_in={}", frames.len(), d.reports_in);
    if !found {
        println!("  NO usable 0x0083 reply — see transcript above for what came back");
    }
    Ok(())
}

/// `0x0083` then `0x0081`. Returns (tag_type, read_token, pages).
fn info_and_read_with(
    d: &mut Dev,
    uid: Option<&[u8]>,
    info_arg: Option<[u8; 6]>,
) -> Result<Option<(u32, Vec<u8>, Vec<(u8, u8, Vec<u8>)>, Vec<u8>, Vec<u8>)>, String> {
    let payload = info_arg.unwrap_or([0x01u8, 0x01, 0x00, 0x00, 0x00, 0x00]);
    d.send(CMD_NTAG_INFO, &payload)?;
    let info_frames = d.collect(5_500, &|f| {
        f.cmd == CMD_NTAG_INFO && f.payload.len() >= 0x40 && f.checksum_ok
    })?;
    let mut tag_type = None;
    let mut token = None;
    let mut info_payload = Vec::new();
    for f in &info_frames {
        if f.cmd == CMD_NTAG_INFO && f.payload.len() >= 0x40 && f.checksum_ok {
            let status = u32::from_le_bytes([f.payload[0], f.payload[1], f.payload[2], f.payload[3]]);
            let kind = u32::from_le_bytes([f.payload[4], f.payload[5], f.payload[6], f.payload[7]]);
            println!("  0x0083 status={status} tag_type={kind}");
            if status == 4 {
                tag_type = Some(kind);
                token = Some(f.payload[0x38..0x40].to_vec());
                info_payload = f.payload.clone();
            }
        }
    }
    let (tag_type, token) = match (tag_type, token) {
        (Some(t), Some(k)) => (t, k),
        _ => {
            println!("  no NTAG info reply with status=4 — cannot proceed to a read");
            return Ok(None);
        }
    };

    // 0x0081: read_token(8) + tag_type(1) + 7 zero bytes.
    let mut read_payload = token.clone();
    read_payload.push(tag_type as u8);
    read_payload.extend_from_slice(&[0u8; 7]);
    d.send(CMD_NTAG_READ, &read_payload)?;
    let frames = d.collect(8_000, &|f| f.cmd == CMD_NTAG_READ && f.payload.len() >= 0x404)?;

    // Per-page stream: byte 0 page, byte 1 state, bytes 2..6 data. State 1 = ok.
    let mut pages: Vec<(u8, u8, Vec<u8>)> = Vec::new();
    let mut final_dump: Option<Vec<u8>> = None;
    for f in &frames {
        if f.cmd == CMD_NTAG_PAGE && f.payload.len() == 6 {
            pages.push((f.payload[0], f.payload[1], f.payload[2..6].to_vec()));
        } else if f.cmd == CMD_NTAG_READ {
            final_dump = Some(f.payload.clone());
        }
    }
    if let Some(dump) = &final_dump {
        println!(
            "  final 0x0081 payload_len={} (spans {} reports) status_dword={}",
            dump.len(),
            (5 + dump.len() + 2).div_ceil(REPORT_LEN),
            u32::from_le_bytes([dump[0], dump[1], dump[2], dump[3]])
        );
        // Page table. The body is status(4) + 0x400 page data + 0x100 page
        // states, so page N data is dump[4 + N*4 .. 8 + N*4].
        let data_pages = (dump.len().saturating_sub(4) / 4).min(0x100);
        let states: Option<&[u8]> = if dump.len() >= 0x404 + 0x100 {
            Some(&dump[0x404..0x504])
        } else {
            None
        };
        println!("  page table ({data_pages} pages, states {})", if states.is_some() { "present" } else { "absent" });
        for page in 0..data_pages {
            let off = 4 + page * 4;
            let d = &dump[off..off + 4];
            let st = states.map(|s| s[page]).unwrap_or(0);
            let interesting = d.iter().any(|&b| b != 0) || st != 0 || page < 12;
            if interesting {
                println!("    page {page:>3}: {}  state={st}", hex(d));
            }
        }
        let nonempty = (0..data_pages)
            .filter(|&p| dump[4 + p * 4..8 + p * 4].iter().any(|&b| b != 0))
            .count();
        println!("  non-empty pages: {nonempty}");

        // Independent cross-check, using the 7-byte UID the 0x0069 poll returned
        // and the ISO14443-A cascade BCC rules.
        if let Some(u) = uid {
            println!("\n  -- cross-check against the 0x0069 poll UID --");
            println!("  poll UID ({} bytes) : {}", u.len(), hex(u));
            println!("  dump page 0 : {}", hex(&dump[4..8]));
            println!("  dump page 1 : {}", hex(&dump[8..12]));
            println!("  dump page 2 : {}", hex(&dump[12..16]));
            if u.len() >= 7 {
                let bcc0 = 0x88 ^ u[0] ^ u[1] ^ u[2];
                let bcc1 = u[3] ^ u[4] ^ u[5] ^ u[6];
                let p0 = &dump[4..8];
                let p1 = &dump[8..12];
                let p2 = &dump[12..16];
                let uid_ok = p0[0..3] == u[0..3] && p1[0..4] == u[3..7];
                println!(
                    "  UID0..UID2 == page0[0..3] && UID3..UID6 == page1[0..4] : {}",
                    if uid_ok { "MATCH" } else { "MISMATCH" }
                );
                println!(
                    "  page0[3] == BCC0 (0x88^UID0^UID1^UID2 = 0x{bcc0:02X}) : {}",
                    if p0[3] == bcc0 { "MATCH" } else { "MISMATCH" }
                );
                println!(
                    "  page2[0] == BCC1 (UID3^UID4^UID5^UID6 = 0x{bcc1:02X}) : {}",
                    if p2[0] == bcc1 { "MATCH" } else { "MISMATCH" }
                );
            }
        }
        let cc = &dump[4 + 3 * 4..4 + 3 * 4 + 4];
        println!("\n  -- cross-check against the NFC Forum Type 2 CC --");
        println!("  dump page 3 (CC): {}  magic 0xE1={}  version 0x10={}  size 0x{:02X}",
            hex(cc), cc[0] == 0xE1, cc[1] == 0x10, cc[2]);
        if cc[0] == 0xE1 {
            let user_bytes = cc[2] as usize * 8;
            println!("  user memory per CC: {user_bytes} bytes ({} pages from page 4)",
                user_bytes / 4);
        }
    }
    if !pages.is_empty() {
        println!("  {} streaming 0x0085 page frame(s)", pages.len());
        let mut shown = 0;
        for (page, state, data) in &pages {
            if shown < 12 {
                println!("    page {page:>3} state={state} data={}", hex(data));
                shown += 1;
            }
        }
    }
    Ok(Some((
        tag_type,
        token,
        pages,
        final_dump.unwrap_or_default(),
        info_payload,
    )))
}

fn info_and_read(
    d: &mut Dev,
    uid: Option<&[u8]>,
) -> Result<Option<(u32, Vec<u8>, Vec<(u8, u8, Vec<u8>)>, Vec<u8>, Vec<u8>)>, String> {
    info_and_read_with(d, uid, None)
}

/// Poll `0x0069` until a 13.56 MHz tag latches or the deadline passes. Prints
/// every distinct payload so a marginal coupling is visible.
fn cmd_wait(d: &mut Dev, secs: u64) -> Result<(), String> {
    println!("== waiting {secs}s for a 13.56 MHz tag (0x0069) ==");
    let start = Instant::now();
    let mut distinct = std::collections::HashSet::new();
    let mut polls = 0u32;
    while start.elapsed().as_secs() < secs {
        polls += 1;
        d.drain();
        d.send(CMD_WAKE, &[0x01])?;
        let _ = d.collect(300, &|f| f.cmd == CMD_WAKE);
        d.send(CMD_HF_POLL, &[])?;
        for f in d.collect(600, &|f| f.cmd == CMD_HF_POLL)? {
            if f.cmd != CMD_HF_POLL {
                continue;
            }
            let key = hex(&f.payload);
            let latched = f.payload.first() == Some(&0x01);
            if distinct.insert(key.clone()) || latched {
                println!(
                    "  poll {:>3} st=0x{:02X} {} payload={}",
                    polls,
                    f.payload.first().copied().unwrap_or(0xFF),
                    if latched { "LATCHED" } else { "no tag " },
                    key
                );
            }
            if latched {
                println!("\n  RESULT: tag latched, UID {}", hex(&f.payload[2..6.min(f.payload.len())]));
                return Ok(());
            }
        }
        sleep(Duration::from_millis(250));
    }
    println!("\n  RESULT: no 13.56 MHz tag latched after {polls} polls");
    Ok(())
}

/// Send a well-formed 1328-byte (21-report) `0x0082` frame whose per-page state
/// table is all zero, so the firmware is asked to write nothing. This isolates
/// the transport question — does the firmware accept and answer a multi-report
/// *outbound* frame at all — from the tag question. Safe to run with any tag,
/// and safe with none.
fn cmd_transport(d: &mut Dev) -> Result<(), String> {
    println!("== multi-report outbound transport (0x0082, 1328-byte payload) ==");
    wake(d)?;
    d.send(CMD_NTAG_INFO, &[0x01, 0x01, 0, 0, 0, 0])?;
    let info = d.collect(5_500, &|f| {
        f.cmd == CMD_NTAG_INFO && f.payload.len() >= 0x40 && f.checksum_ok
    })?;
    let mut tag_type = 0u8;
    let mut token = vec![0u8; 8];
    for f in &info {
        if f.cmd == CMD_NTAG_INFO && f.payload.len() >= 0x40 {
            tag_type = f.payload[4];
            token.copy_from_slice(&f.payload[0x38..0x40]);
            println!(
                "  session: status={} tag_type={} token={}",
                u32::from_le_bytes([f.payload[0], f.payload[1], f.payload[2], f.payload[3]]),
                tag_type,
                hex(&token)
            );
        }
    }

    let mut payload = vec![0u8; NTAG_WRITE_PAYLOAD];
    payload[0..8].copy_from_slice(&token);
    payload[8..12].copy_from_slice(&(tag_type as u32).to_le_bytes());
    payload[12..16].copy_from_slice(&1u32.to_le_bytes());
    // 0x400 page-data bytes and 0x100 page-state bytes stay zero: no page is
    // requested, so no page can be written.
    d.send(CMD_NTAG_WRITE, &payload)?;
    let frames = d.collect(6_000, &|f| f.cmd == CMD_NTAG_WRITE || f.cmd == CMD_NTAG_PAGE)?;
    if frames.is_empty() {
        println!("\n  RESULT: firmware did NOT answer a 21-report outbound frame (deadline hit)");
    } else {
        for f in &frames {
            println!(
                "  reply cmd=0x{:04X} len={} status={} checksum_ok={}",
                f.cmd,
                f.payload.len(),
                if f.payload.len() >= 4 {
                    u32::from_le_bytes([f.payload[0], f.payload[1], f.payload[2], f.payload[3]])
                } else {
                    0
                },
                f.checksum_ok
            );
        }
        println!("\n  RESULT: firmware answered an outbound {} -report frame", (5 + payload.len() + 2).div_ceil(REPORT_LEN));
    }
    Ok(())
}

fn cmd_read(d: &mut Dev) -> Result<(), String> {
    println!("== NTAG info + read ==");
    wake(d)?;
    // Poll first so the UID used for the cross-check is independent of NTAG.
    d.send(CMD_HF_POLL, &[])?;
    let uid = d
        .collect(900, &|f| f.cmd == CMD_HF_POLL)?
        .into_iter()
        .find(|f| f.cmd == CMD_HF_POLL && f.payload.len() >= 6)
        .and_then(|f| {
            if f.payload[0] == 0x01 {
                // 0x0069 carries the full 7-byte UID: payload[2..9].
                Some(f.payload[2..9.min(f.payload.len())].to_vec())
            } else {
                None
            }
        });
    match &uid {
        Some(u) => println!("  0x0069 UID (independent): {}", hex(u)),
        None => println!("  0x0069: no tag latched — the read checks below will be weaker"),
    }
    match info_and_read(d, uid.as_deref())? {
        Some(_) => println!("\n  RESULT: NTAG read produced data (see above)"),
        None => println!("\n  RESULT: no NTAG read data"),
    }
    Ok(())
}

fn poll_uid(d: &mut Dev) -> Result<Option<Vec<u8>>, String> {
    d.send(CMD_HF_POLL, &[])?;
    Ok(d
        .collect(900, &|f| f.cmd == CMD_HF_POLL)?
        .into_iter()
        .find(|f| f.cmd == CMD_HF_POLL && f.payload.len() >= 6)
        .and_then(|f| {
            if f.payload[0] == 0x01 {
                // 0x0069 carries the full 7-byte UID: payload[2..9].
                Some(f.payload[2..9.min(f.payload.len())].to_vec())
            } else {
                None
            }
        }))
}

fn page_of(dump: &[u8], page: u8) -> Option<Vec<u8>> {
    let off = 4 + page as usize * 4;
    if dump.len() >= off + 4 {
        Some(dump[off..off + 4].to_vec())
    } else {
        None
    }
}

/// The bytes from page 0 to page 11 — UID, CC and the whole NDEF TLV of the tag
/// that was on this Reader. Used to prove a write to a free page touched nothing
/// else.
fn head_of(dump: &[u8]) -> Vec<u8> {
    let n = 4 + 12 * 4;
    if dump.len() >= n {
        dump[4..n].to_vec()
    } else {
        Vec::new()
    }
}

/// One `0x0082` write of a single page, with the tag's whole current image in the
/// data table so that no other page can be changed by accident. Only the target
/// page differs from what was read, and only the target page is marked `2`
/// ("write this page") in the state table.
#[derive(Clone)]
struct WriteVariant {
    /// Flag dword at payload 12..16.
    flag: u32,
    /// Page-state byte written for the target page.
    state: u8,
    /// Settle time after the preceding read before the write frame goes out.
    delay_ms: u64,
    /// Copy these 32 bytes from the info reply into payload 0x10..0x30, when set.
    echo_block: Option<usize>,
    /// Checksum over the whole payload instead of the firmware's `len & 0xFF`.
    full_checksum: bool,
    /// Pause between outbound report chunks of a multi-report frame.
    gap_ms: u64,
    /// Override for the 6-byte 0x0083 request sent before the write.
    info_arg: Option<[u8; 6]>,
}

impl Default for WriteVariant {
    fn default() -> Self {
        WriteVariant {
            flag: 1,
            state: 2,
            delay_ms: 400,
            echo_block: None,
            full_checksum: false,
            gap_ms: 5,
            info_arg: None,
        }
    }
}

fn send_write(
    d: &mut Dev,
    v: &WriteVariant,
    token: &[u8],
    tag_type: u32,
    image: &[u8],
    page: u8,
    data: &[u8; 4],
    info_payload: &[u8],
) -> Result<(), String> {
    let mut payload = vec![0u8; NTAG_WRITE_PAYLOAD];
    payload[0..8].copy_from_slice(&token[..8]);
    payload[8..12].copy_from_slice(&tag_type.to_le_bytes());
    payload[12..16].copy_from_slice(&v.flag.to_le_bytes());
    if let Some(off) = v.echo_block {
        if info_payload.len() >= off + 0x20 {
            payload[0x10..0x30].copy_from_slice(&info_payload[off..off + 0x20]);
            println!("  echoing info payload[{off}..{}] into 0x10..0x30", off + 0x20);
        }
    }
    let n = image.len().min(0x400);
    payload[0x30..0x30 + n].copy_from_slice(&image[..n]);
    payload[0x30 + page as usize * 4..0x30 + page as usize * 4 + 4].copy_from_slice(data);
    payload[0x430 + page as usize] = v.state;

    d.send_full(CMD_NTAG_WRITE, &payload, v.full_checksum, v.gap_ms)?;
    let frames = d.collect(8_000, &|f| f.cmd == CMD_NTAG_WRITE)?;
    let mut ok_pages = Vec::new();
    let mut err_pages = Vec::new();
    let mut other_pages = Vec::new();
    for f in &frames {
        if f.cmd == CMD_NTAG_PAGE && f.payload.len() == 6 {
            let (p, state) = (f.payload[0], f.payload[1]);
            if p != page {
                other_pages.push(p);
            }
            if state == 1 {
                ok_pages.push(p);
            } else if state == 4 {
                err_pages.push(p);
            }
        }
    }
    println!(
        "  page frames: ok={ok_pages:?} err={err_pages:?} other_pages={other_pages:?}"
    );
    match frames.iter().find(|f| f.cmd == CMD_NTAG_WRITE) {
        Some(f) => {
            println!(
                "  final 0x0082 payload_len={} status_dword={} checksum_ok={}",
                f.payload.len(),
                if f.payload.len() >= 4 {
                    u32::from_le_bytes([f.payload[0], f.payload[1], f.payload[2], f.payload[3]])
                } else {
                    0
                },
                f.checksum_ok
            );
            if f.payload.len() >= 4 + 0x100 {
                let states = &f.payload[4..4 + 0x100];
                let set: Vec<(usize, u8)> = states
                    .iter()
                    .enumerate()
                    .filter(|(_, &b)| b != 0)
                    .map(|(i, &b)| (i, b))
                    .collect();
                println!(
                    "  reply page-state table: {} non-zero entries{}{}",
                    set.len(),
                    if set.is_empty() { "" } else { " -> " },
                    set.iter()
                        .take(24)
                        .map(|(p, b)| format!("page {p}=state {b}"))
                        .collect::<Vec<_>>()
                        .join(", ")
                );
                if f.payload.len() >= 4 + 0x100 + 0x20 {
                    println!(
                        "  reply payload[4+0x100..+0x20] = {}",
                        hex(&f.payload[4 + 0x100..4 + 0x100 + 0x20])
                    );
                }
            }
        }
        None => println!("  no final 0x0082 frame arrived"),
    }
    Ok(())
}

fn cmd_write(d: &mut Dev, page: u8, data: [u8; 4], v: &WriteVariant) -> Result<(), String> {
    println!("== NTAG write (0x0082) — WRITES ONE PAGE ==");
    println!(
        "  target page {page}, bytes {}; variant flag={} state={} delay={}ms echo_block={:?} full_checksum={} gap={}ms info_arg={:?}",
        hex(&data), v.flag, v.state, v.delay_ms, v.echo_block, v.full_checksum, v.gap_ms, v.info_arg
    );
    wake(d)?;
    let uid = poll_uid(d)?;
    let (tag_type, token, _pages, before_dump, info_payload) =
        match info_and_read_with(d, uid.as_deref(), v.info_arg)? {
            Some(v) => v,
            None => return Err("could not read the tag, so refusing to write blind".into()),
        };
    if page < 4 {
        return Err(format!(
            "page {page} is not a user page (pages 0-3 hold UID/BCC/static lock/CC); refusing"
        ));
    }
    let before = page_of(&before_dump, page)
        .ok_or_else(|| format!("page {page} is not present in the read-back dump"))?;
    println!("  page {page} before write : {}", hex(&before));
    if before == data {
        return Err("the page already holds those bytes — pick a different value".into());
    }
    let head_before = head_of(&before_dump);

    sleep(Duration::from_millis(v.delay_ms));
    println!("\n-- write --");
    send_write(
        d,
        v,
        &token,
        tag_type,
        &before_dump[4..],
        page,
        &data,
        &info_payload,
    )?;

    println!("\n-- read-back after write --");
    sleep(Duration::from_millis(400));
    wake(d)?;
    let (tag_type2, token2, _p2, after_dump, info_payload2) =
        match info_and_read(d, uid.as_deref())? {
            Some(v) => v,
            None => return Err("read-back failed after the write".into()),
        };
    let after = page_of(&after_dump, page).unwrap_or_default();
    println!("  page {page} after write  : {}", hex(&after));
    let observed = after == data;
    let head_intact = head_of(&after_dump) == head_before;
    println!(
        "  write observed on a later read : {}",
        if observed { "YES" } else { "NO" }
    );
    println!(
        "  pages 0-11 (UID/CC/NDEF) unchanged : {}",
        if head_intact { "yes" } else { "NO — CONTENT CHANGED" }
    );

    // Restore: put the page back to the bytes it held before, so the tag is left
    // exactly as it was found.
    println!("\n-- restore page {page} to {} --", hex(&before));
    let restore: [u8; 4] = [before[0], before[1], before[2], before[3]];
    send_write(
        d,
        v,
        &token2,
        tag_type2,
        &after_dump[4..],
        page,
        &restore,
        &info_payload2,
    )?;

    println!("\n-- read-back after restore --");
    sleep(Duration::from_millis(400));
    wake(d)?;
    match info_and_read(d, uid.as_deref())? {
        Some((_, _, _, final_dump, _)) => {
            let final_page = page_of(&final_dump, page).unwrap_or_default();
            println!("  page {page} finally        : {}", hex(&final_page));
            println!(
                "  page restored to original : {}",
                if final_page == before { "YES" } else { "NO" }
            );
            println!(
                "  pages 0-11 (UID/CC/NDEF) unchanged : {}",
                if head_of(&final_dump) == head_before { "yes" } else { "NO — CONTENT CHANGED" }
            );
        }
        None => println!("  final read-back failed"),
    }
    println!(
        "\n  RESULT: write {} ; tag left {}",
        if observed { "OBSERVED on a later read" } else { "NOT observed" },
        if observed { "as found" } else { "in an unknown state — re-read it" }
    );
    Ok(())
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd = args.first().map(|s| s.as_str()).unwrap_or("check");

    let mut d = match Dev::open() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(2);
        }
    };
    println!("opened {:04x}:{:04x}\n", VID, PID);

    let res = match cmd {
        "check" => cmd_check(&mut d),
        "wait" => {
            let secs: u64 = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(60);
            cmd_wait(&mut d, secs)
        }
        "info" => cmd_info(&mut d),
        "read" => cmd_read(&mut d),
        "transport" => cmd_transport(&mut d),
        "write" => {
            if !args.iter().any(|a| a == "--yes-disposable") {
                eprintln!(
                    "refusing to write: pass --yes-disposable and only with a tag you are \
                     willing to lose"
                );
                std::process::exit(2);
            }
            if args.len() < 3 {
                eprintln!("usage: ntagspike write <page> <4-byte-hex> --yes-disposable");
                std::process::exit(2);
            }
            let page: u8 = match args[1].parse() {
                Ok(p) => p,
                Err(_) => {
                    eprintln!("page must be a decimal page number");
                    std::process::exit(2);
                }
            };
            let raw: String = args[2].chars().filter(|c| c.is_ascii_hexdigit()).collect();
            if raw.len() != 8 {
                eprintln!("data must be exactly 4 bytes of hex, e.g. deadbeef");
                std::process::exit(2);
            }
            let mut data = [0u8; 4];
            for i in 0..4 {
                data[i] = u8::from_str_radix(&raw[i * 2..i * 2 + 2], 16).unwrap();
            }
            let mut v = WriteVariant::default();
            let mut i = 3;
            while i < args.len() {
                match args[i].as_str() {
                    "--flag" => {
                        v.flag = args.get(i + 1).and_then(|x| x.parse().ok()).unwrap_or(1);
                        i += 2;
                    }
                    "--state" => {
                        v.state = args.get(i + 1).and_then(|x| x.parse().ok()).unwrap_or(2);
                        i += 2;
                    }
                    "--delay-ms" => {
                        v.delay_ms = args.get(i + 1).and_then(|x| x.parse().ok()).unwrap_or(400);
                        i += 2;
                    }
                    "--echo-block" => {
                        v.echo_block = args.get(i + 1).and_then(|x| x.parse().ok());
                        i += 2;
                    }
                    "--full-checksum" => {
                        v.full_checksum = true;
                        i += 1;
                    }
                    "--gap-ms" => {
                        v.gap_ms = args.get(i + 1).and_then(|x| x.parse().ok()).unwrap_or(5);
                        i += 2;
                    }
                    "--info-arg" => {
                        let raw: String = args
                            .get(i + 1)
                            .map(|x| x.chars().filter(|c| c.is_ascii_hexdigit()).collect())
                            .unwrap_or_default();
                        if raw.len() == 12 {
                            let mut b = [0u8; 6];
                            for k in 0..6 {
                                b[k] = u8::from_str_radix(&raw[k * 2..k * 2 + 2], 16).unwrap();
                            }
                            v.info_arg = Some(b);
                        }
                        i += 2;
                    }
                    _ => i += 1,
                }
            }
            cmd_write(&mut d, page, data, &v)
        }
        other => {
            eprintln!("unknown subcommand: {other}");
            std::process::exit(2);
        }
    };

    if let Err(e) = res {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
    println!("\nreports out={} in={}", d.reports_out, d.reports_in);
}
