//! Single-shot LF-write candidate tester.
//!
//! One attempt per process so a wedged device only costs one run. Between
//! attempts you replug the reader if it stops accepting reports.
//!
//! Fixes the flaw in the first version: the LF read returns TWO frames per
//! poll, so a leftover frame was being misread as the reply to the write
//! command. This drains the queue before sending and only treats a frame whose
//! command id matches as a reply.
//!
//! Usage:
//!   cargo run --example writeprobe -- <cmdhex> <payload> [--verify-only]
//!
//!   payloads: cust-be | 0001-cust-be | cust-le | read24
//!
//!   --verify-only just reads the tag and reports it, sending nothing.

use pm4_studio_lib::reader::{hex, make_frame, Reader};
use std::thread::sleep;
use std::time::Duration;

const TARGET_CUSTOMER: u8 = 0x55;
const TARGET_DATA32: u32 = 0x0084_8212;

fn settle(ms: u64) {
    sleep(Duration::from_millis(ms));
}

/// Drain, wake, then read the LF tag once.
fn read_tag(r: &Reader) -> Result<Option<(u8, u32)>, String> {
    r.drain();
    let f = make_frame(0x0051, &[0x01]);
    let _ = r.raw_command(&f);
    settle(120);
    r.drain();
    let f = make_frame(0x0072, &[0x00, 0x01]);
    let _ = r.write_raw(&f);
    // Poll for the read reply specifically; ignore anything else.
    for _ in 0..6 {
        match r.read_one(400)? {
            Some(fr) if fr.cmd == 0x0072 => {
                let p = &fr.payload;
                if p.len() >= 0x18 && p[2] == 0x01 {
                    let customer = p[8];
                    let data32 = u32::from_le_bytes([p[12], p[13], p[14], p[15]]);
                    return Ok(Some((customer, data32)));
                }
                return Ok(None);
            }
            Some(_) => continue,
            None => break,
        }
    }
    Ok(None)
}

fn payload_for(name: &str) -> Option<Vec<u8>> {
    let be = TARGET_DATA32.to_be_bytes();
    let le = TARGET_DATA32.to_le_bytes();
    Some(match name {
        "cust-be" => {
            let mut v = vec![TARGET_CUSTOMER];
            v.extend_from_slice(&be);
            v
        }
        "0001-cust-be" => {
            let mut v = vec![0x00, 0x01, TARGET_CUSTOMER];
            v.extend_from_slice(&be);
            v
        }
        "cust-le" => {
            let mut v = vec![TARGET_CUSTOMER];
            v.extend_from_slice(&le);
            v
        }
        "w24b" => {
            // Same shape as the read payload but with the target id placed at the
            // CONFIRMED write offsets: customer [12], data32 LE [16..20].
            // Keeps the 01/01 flags that the successful probe had.
            let mut v = vec![0u8; 24];
            v[1] = 0x01;
            v[2] = 0x01;
            v[8] = TARGET_CUSTOMER;
            v[12] = TARGET_CUSTOMER;
            v[16..20].copy_from_slice(&le);
            v
        }
        "w24" => {
            // Confirmed write layout: customer at [12], data32 LE at [16..20].
            // (The read layout places these 4 bytes earlier, at [8] and [12..16].)
            let mut v = vec![0u8; 24];
            v[12] = TARGET_CUSTOMER;
            v[16..20].copy_from_slice(&le);
            v
        }
        "read24" => {
            let mut v = vec![0u8; 24];
            v[0] = 0x00;
            v[1] = 0x01;
            v[2] = 0x01;
            v[8] = TARGET_CUSTOMER;
            v[12..16].copy_from_slice(&le);
            v[18] = 0xC8;
            v[19] = 0x42;
            v
        }
        _ => return None,
    })
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let verify_only = args.iter().any(|a| a == "--verify-only");

    let r = match Reader::open() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("open failed: {e}");
            std::process::exit(1);
        }
    };

    // Baseline read.
    let before = match read_tag(&r) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("read failed: {e}  (device may be wedged — replug it)");
            std::process::exit(4);
        }
    };
    match before {
        Some((c, d)) => println!("tag before : customer 0x{c:02X}  data32 0x{d:08X}"),
        None => {
            println!("tag before : (no tag latched)");
            if verify_only {
                std::process::exit(0);
            }
        }
    }

    if verify_only {
        if let Some((c, d)) = before {
            if d == TARGET_DATA32 && c == TARGET_CUSTOMER {
                println!("\n*** THIS TAG ALREADY HOLDS THE BADGE ID — the write worked. ***");
            }
        }
        return;
    }

    if args.len() < 2 {
        eprintln!("\nusage: writeprobe <cmdhex> <payload>");
        eprintln!("  payloads: cust-be | 0001-cust-be | cust-le | read24");
        std::process::exit(2);
    }
    let cmd = u16::from_str_radix(args[0].trim_start_matches("0x"), 16).expect("bad cmd hex");
    let payload = match payload_for(&args[1]) {
        Some(p) => p,
        None => {
            eprintln!("unknown payload name: {}", args[1]);
            std::process::exit(2);
        }
    };

    // Safety: never write to something that already looks like the real badge.
    if let Some((c, d)) = before {
        if d == TARGET_DATA32 && c == TARGET_CUSTOMER {
            eprintln!("\n!! Tag already reads as the badge id. Aborting.");
            std::process::exit(3);
        }
    }

    println!("SENDING    : cmd 0x{cmd:04X}  payload {}", hex(&payload));
    r.drain();
    settle(150);
    r.drain();

    let frame = make_frame(cmd, &payload);
    if let Err(e) = r.write_raw(&frame) {
        eprintln!("write failed: {e}  (device wedged — replug and retry)");
        std::process::exit(4);
    }
    println!("write accepted by USB");

    settle(700);
    let n = r.drain();
    println!("drained {n} queued frame(s) after the write");

    // Read back patiently: a write may keep the firmware busy for a few seconds.
    let mut after: Option<(u8, u32)> = None;
    for attempt in 0..6 {
        if attempt > 0 {
            settle(1500);
        }
        match read_tag(&r) {
            Ok(Some(v)) => {
                after = Some(v);
                break;
            }
            Ok(None) => continue,
            Err(e) => {
                eprintln!("read-back attempt {} failed: {e}", attempt + 1);
            }
        }
    }

    match after {
        Some((c, d)) => {
            println!("tag after  : customer 0x{c:02X}  data32 0x{d:08X}");
            if c == TARGET_CUSTOMER && d == TARGET_DATA32 {
                println!("\n*** SUCCESS — this command writes the badge id. ***");
            } else if Some((c, d)) == before {
                println!("unchanged");
            } else {
                println!("changed, but not to the target id");
            }
        }
        None => println!("tag after  : (no tag latched — device may be busy/wedged)"),
    }
    let _ = r.drain();
}
