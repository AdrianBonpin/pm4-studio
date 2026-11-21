//! Read-only probe: one 13.56 MHz tag's memory through the shipping path.
//!
//! Unlike `ntagspike` (which explored the protocol), this probe calls the same
//! `ntag` + `memory_dump` code the app calls, so a hardware run exercises the
//! shipping read path rather than a parallel copy of it. It sends `0x0083`
//! (info) and `0x0081` (read) and nothing else: no write, no erase, no format.
//!
//! Usage, from src-tauri/:
//!
//!   cargo run --example dumpread
//!
//! A tag that is not on the Reader, or a Reader another process holds, prints
//! the error the page would show and exits non-zero.

use pm4_studio_lib::memory_dump::MemoryDump;
use pm4_studio_lib::ntag;
use pm4_studio_lib::reader::Reader;

fn main() {
    let reader = match Reader::open() {
        Ok(reader) => reader,
        Err(e) => {
            eprintln!("{e}");
            if e.contains("E00002C5") {
                eprintln!("the Reader is held by another process — quit it and retry");
            }
            std::process::exit(2);
        }
    };

    let result = (|| -> Result<MemoryDump, String> {
        let info = ntag::read_info(&reader)?;
        println!("tag type {}  UID {}", info.tag_type, info.uid);
        let payload = ntag::read_payload(&reader, &info)?;
        println!("read reply payload: {} bytes", payload.len());
        let captured_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| format!("{} ms since epoch", d.as_millis()))
            .unwrap_or_else(|_| "unknown".to_string());
        MemoryDump::parse(&payload, info.identity(captured_at)).map_err(|e| e.message())
    })();

    match result {
        Ok(dump) => {
            println!("\n{}", dump.to_text());
            println!(
                "suggested export name: {}",
                dump.suggested_file_name()
            );
        }
        Err(e) => {
            eprintln!("read failed: {e}");
            std::process::exit(1);
        }
    }
}
