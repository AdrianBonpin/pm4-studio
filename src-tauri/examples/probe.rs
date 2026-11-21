//! Headless transport check: opens the real reader and exercises every
//! implemented command. Run with `cargo run --example probe`.
//!
//! Read-only against the tag (no writes are issued), so it is safe to run with
//! a badge sitting on the reader.

use pm4_studio_lib::reader::{hex, LfCard, Reader};
use std::thread::sleep;
use std::time::Duration;

fn main() {
    let r = match Reader::open() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("open failed: {e}");
            std::process::exit(1);
        }
    };
    println!("opened {:04x}:{:04x}", r.info.vid, r.info.pid);
    println!("  product      : {}", r.info.product);
    println!("  manufacturer : {}", r.info.manufacturer);
    println!("  serial       : {}", r.info.serial);

    match r.wake() {
        Ok(()) => println!("\n[0x51] wake      : ok"),
        Err(e) => {
            eprintln!("\n[0x51] wake failed: {e}");
            std::process::exit(1);
        }
    }

    println!("[0x69] hf poll   : {:?}", r.hf_poll_once());

    print!("[0x72] lf read   : ");
    let mut found: Option<LfCard> = None;
    for attempt in 0..12 {
        match r.lf_read_once() {
            Ok(Some(c)) => {
                found = Some(c);
                break;
            }
            Ok(None) => {
                if attempt == 0 {
                    println!("no badge yet, polling…");
                }
                sleep(Duration::from_millis(350));
            }
            Err(e) => {
                println!("error: {e}");
                std::process::exit(1);
            }
        }
    }

    match found {
        Some(c) => {
            println!("\n=== 125 kHz badge ===");
            println!("  EM4100 ID    : {}", c.id);
            println!("  data32       : 0x{:08X}", c.data32);
            println!("  facility/card: {} / {}", c.facility, c.card);
            println!("  payload      : {}", c.raw);
        }
        None => println!("no badge detected after 12 attempts"),
    }

    // Prove the checksum rule on a live frame.
    if let Ok(Some(f)) = r.transact(0x0051, &[0x01], Some(0x0051), 1500) {
        println!("\nlive frame checksum verified: {}", f.checksum_ok);
        println!("live frame payload: {}", hex(&f.payload));
    }
}
