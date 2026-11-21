//! Capture real HF/LF payloads so the decoder offsets can be confirmed.
//!
//! Prints every distinct frame seen while polling, with the payload split into
//! indexed bytes so ATQA/SAK positions can be read off directly.
//!
//! Usage: cargo run --example capture -- [seconds]   (default 25)

use pm4_studio_lib::reader::{hex, Reader};
use std::collections::HashSet;
use std::thread::sleep;
use std::time::{Duration, Instant};

fn main() {
    let secs: f64 = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(25.0);

    let r = match Reader::open() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("open failed: {e}");
            std::process::exit(1);
        }
    };
    println!("capturing for {secs}s — place the tag on the reader now\n");

    let mut seen: HashSet<String> = HashSet::new();
    let start = Instant::now();
    let mut n = 0u32;

    while start.elapsed().as_secs_f64() < secs {
        n += 1;
        let _ = r.wake();

        if let Ok(Some(f)) = r.transact(0x0069, &[], Some(0x0069), 700) {
            let key = format!("HF {}", hex(&f.payload));
            if seen.insert(key) {
                println!("══ HF poll reply (cmd 0x{:04X}, len {})", f.cmd, f.payload.len());
                println!("   payload : {}", hex(&f.payload));
                println!("   cksum   : {}", f.checksum_ok);
                for (i, b) in f.payload.iter().enumerate() {
                    println!("     [{i:>2}] 0x{b:02X}  {b:>3}");
                }
                println!();
            }
        }

        if let Ok(Some(f)) = r.transact(0x0072, &[0x00, 0x01], Some(0x0072), 700) {
            let key = format!("LF {}", hex(&f.payload));
            if seen.insert(key) {
                println!("══ LF read reply (cmd 0x{:04X}, len {})", f.cmd, f.payload.len());
                println!("   payload : {}", hex(&f.payload));
                for (i, b) in f.payload.iter().enumerate() {
                    println!("     [{i:>2}] 0x{b:02X}  {b:>3}");
                }
                println!();
            }
        }

        sleep(Duration::from_millis(300));
    }

    println!("done — {n} polls, {} distinct payloads", seen.len());
    if seen.is_empty() {
        println!("nothing replied at all");
    }
}
