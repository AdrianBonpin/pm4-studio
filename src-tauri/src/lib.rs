//! Tauri command surface for PM4 Studio.

mod atomic_file;
pub mod author_identity;
mod clear_data;
pub mod batch;
pub mod clear;
pub mod console;
pub mod identity;
pub mod library;
pub mod library_io;
pub mod library_migration;
pub mod library_schema;
pub mod memory_dump;
pub mod ntag;
pub mod password;
pub mod reader;
pub mod stream;
pub mod tag_records;
pub mod wire_record;
pub mod write_guard;
pub mod write_outcome;
#[cfg(test)]
mod test_frames;

use batch::BatchAttempt;
use clear::ClearAttempt;
use identity::Identity;
use library::{
    Draft, InsertOutcome, Library, LibraryProblem, LibraryStore, Open, SaveError, Snapshot,
    WriteCountOutcome,
};
use library_io::{FileError, ImportPreview};
use memory_dump::MemoryDump;
use ntag::{ErasePreview, EraseReport, NdefPreview, NdefWrite, TagView};
use tag_records::{TagNdef, TagRecordsRead};
use reader::{DeviceInfo, Frame, HfCard, LfCard, LfWriteAttempt, Reader, REPORT_LEN};
use write_outcome::Evidence;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

pub struct AppState {
    reader: Mutex<Option<Reader>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            reader: Mutex::new(None),
        }
    }
}

/// Lock the reader slot, opening the device on first use.
fn with_reader<T>(
    state: &State<'_, AppState>,
    f: impl FnOnce(&Reader) -> Result<T, String>,
) -> Result<T, String> {
    let mut slot = state
        .reader
        .lock()
        .map_err(|_| "internal state lock poisoned".to_string())?;
    if slot.is_none() {
        *slot = Some(Reader::open()?);
    }
    let r = slot.as_ref().expect("just populated");
    match f(r) {
        Ok(v) => Ok(v),
        Err(e) => {
            // Any transport error means the handle is suspect; drop it so the
            // next call re-enumerates instead of failing forever.
            *slot = None;
            Err(e)
        }
    }
}

/// Firmware revision of the attached Reader, e.g. `H00S07`.
///
/// Bounded: an absent or wedged Reader produces an error instead of a promise
/// that never settles, so the shell can say "no Reader" or "replug" at once.
#[tauri::command]
fn firmware_version(state: State<'_, AppState>) -> Result<String, String> {
    with_reader(&state, |r| r.version())
}

#[derive(Serialize)]
pub struct RawResponse {
    pub sent: String,
    pub cmd: u16,
    pub payload: String,
    pub checksum_ok: bool,
    pub raw: String,
}

/// Open the Reader and return what it says about itself.
///
/// `async` on purpose. A synchronous command is dispatched on the main thread, so
/// opening the device there — and `HidApi::new()` enumerates every HID device —
/// freezes the window: the event loop is inside this call, the pointer turns into
/// a wait cursor, and nothing repaints until enumeration returns. As an async
/// command this runs on the runtime instead, and the main thread stays free.
///
/// The guard matters for the same reason the freezing was possible: React's
/// StrictMode mounts effects twice in a development build, so `useReader` used to
/// ask to connect twice at startup. The first attempt held the reader slot while
/// it enumerated, and because the second was dispatched on the main thread it
/// waited on that mutex forever. A concurrent attempt now returns immediately
/// with a reason instead of queueing, and the slot is only taken once the device
/// is open — never across the blocking work.
#[tauri::command]
async fn connect(state: State<'_, AppState>) -> Result<DeviceInfo, String> {
    static CONNECTING: AtomicBool = AtomicBool::new(false);

    if CONNECTING.swap(true, Ordering::SeqCst) {
        return Err("a connection attempt is already running".to_string());
    }

    let outcome = (|| -> Result<DeviceInfo, String> {
        let r = Reader::open()?;
        let info = r.info.clone();
        r.wake().ok();
        let mut slot = state
            .reader
            .lock()
            .map_err(|_| "internal state lock poisoned".to_string())?;
        *slot = Some(r);
        Ok(info)
    })();

    CONNECTING.store(false, Ordering::SeqCst);
    outcome
}

#[tauri::command]
fn disconnect(state: State<'_, AppState>) -> Result<(), String> {
    let mut slot = state
        .reader
        .lock()
        .map_err(|_| "internal state lock poisoned".to_string())?;
    *slot = None;
    Ok(())
}

#[tauri::command]
fn device_info(state: State<'_, AppState>) -> Result<Option<DeviceInfo>, String> {
    let slot = state
        .reader
        .lock()
        .map_err(|_| "internal state lock poisoned".to_string())?;
    Ok(slot.as_ref().map(|r| r.info.clone()))
}

/// One 125 kHz poll. `None` = no tag latched on this attempt.
#[tauri::command]
fn lf_poll(state: State<'_, AppState>) -> Result<Option<LfCard>, String> {
    with_reader(&state, |r| {
        r.wake()?;
        r.lf_read_once()
    })
}

/// One 13.56 MHz poll.
#[tauri::command]
fn hf_poll(state: State<'_, AppState>) -> Result<Option<HfCard>, String> {
    with_reader(&state, |r| {
        r.wake()?;
        r.hf_poll_once()
    })
}

/// Read the 13.56 MHz tag's memory as a page dump.
///
/// Read-only: the tag is asked for its info and its memory and nothing else.
/// A tag that does not answer is an error the page shows; the Reader handle is
/// dropped so the next attempt re-enumerates instead of failing forever.
#[tauri::command]
fn ntag_memory_read(
    state: State<'_, AppState>,
    captured_at: String,
) -> Result<MemoryDump, String> {
    with_reader(&state, |r| {
        let info = ntag::read_info(r)?;
        let payload = ntag::read_payload(r, &info)?;
        MemoryDump::parse(&payload, info.identity(&captured_at)).map_err(|e| e.message())
    })
}

/// Read a Tag's Records: its memory, then the NDEF TLV inside that memory.
///
/// Read-only, and read-only in the strict sense that matters here: this sends
/// `0x0083` and `0x0081` and nothing else, so a Tag is never changed by being
/// loaded into a Draft. Decoding the message into Records happens in the
/// webview codec; this returns the bytes and what the TLV structure was.
#[tauri::command]
fn ntag_records_read(
    state: State<'_, AppState>,
    captured_at: String,
) -> Result<TagRecordsRead, String> {
    with_reader(&state, |r| {
        let info = ntag::read_info(r)?;
        let payload = ntag::read_payload(r, &info)?;
        let identity = info.identity(&captured_at);
        let dump = MemoryDump::parse(&payload, identity).map_err(|e| e.message())?;
        let ndef = TagNdef::from_read_payload(&payload).map_err(|e| e.message())?;
        Ok(TagRecordsRead { dump, ndef })
    })
}

/// Write a memory dump to a text file the user chooses.
///
/// `None` means the dialog was cancelled, and nothing was written. The dump is
/// rendered here rather than accepted as text from the webview, so the file is
/// always the dump this build formatted.
#[tauri::command]
async fn memory_dump_export(app: AppHandle, dump: MemoryDump) -> Result<Option<String>, String> {
    let chosen = ask_where_to_save(
        &app,
        "Save memory dump",
        "Text file",
        &["txt"],
        Some(dump.suggested_file_name()),
    )
    .await?;
    let Some(path) = chosen else {
        return Ok(None);
    };
    library_io::write_text(Path::new(&path), &dump.to_text()).map_err(|e| e.message())?;
    Ok(Some(path))
}

#[tauri::command]
fn beep(state: State<'_, AppState>) -> Result<(), String> {
    with_reader(&state, |r| r.beep())
}

#[tauri::command]
fn led_off(state: State<'_, AppState>) -> Result<(), String> {
    with_reader(&state, |r| r.led_off())
}

/// What the authoring form is about to write, shown before anything is sent.
///
/// A confirmation payload, not a report: it is built by the same codec that
/// encodes the `0x0073` payload, so the Identity on screen and the bytes on the
/// wire cannot disagree. Producing it touches no device.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityPreview {
    pub customer: u8,
    pub data32: u32,
    /// The five-byte id as every other surface shows it: `55 00 84 82 12`.
    pub id: String,
    /// The same five bytes with no separators, for copying back into the form.
    pub hex: String,
    pub facility: u8,
    pub card: u16,
    /// The 24-byte `0x0073` payload, hex. This is what goes on the wire.
    pub payload_hex: String,
}

impl From<author_identity::Preview> for IdentityPreview {
    fn from(preview: author_identity::Preview) -> Self {
        let identity = preview.identity;
        Self {
            customer: identity.customer,
            data32: identity.data32,
            id: preview.id,
            hex: preview.hex,
            facility: identity.facility(),
            card: identity.card(),
            payload_hex: preview.payload_hex,
        }
    }
}

/// The Identity a customer, facility and card entry describes, before any write.
///
/// Pure: it reads no Tag and sends no Frame, so this is safe to call while the
/// user is still typing, and the confirmation it feeds cannot have had a side
/// effect. Out-of-range entries are refused here with the valid range named —
/// see `author_identity`, which owns the ranges and the codec round trip.
#[tauri::command]
fn lf_identity_preview(
    customer: String,
    facility: String,
    card: String,
) -> Result<IdentityPreview, String> {
    author_identity::from_parts(&customer, &facility, &card)
        .and_then(author_identity::preview)
        .map(IdentityPreview::from)
        .map_err(|e| e.to_string())
}

/// The Identity a raw five-byte hex entry describes, before any write.
///
/// Pure, for the same reason as [`lf_identity_preview`]: the entry may be wrong,
/// and finding that out must not cost a Tag.
#[tauri::command]
fn lf_identity_preview_hex(hex: String) -> Result<IdentityPreview, String> {
    author_identity::from_hex(&hex)
        .and_then(author_identity::preview)
        .map(IdentityPreview::from)
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    pub customer: u8,
    pub data32: u32,
    /// What the tag reads after the write, when it could be re-read.
    pub readback: Option<LfCard>,
    /// "refused" | "verified" | "unverified" | "failed" — see `write_outcome`.
    pub outcome: &'static str,
    /// True only when the read-back matched. Kept for callers that predate
    /// `outcome`, and deliberately equal to `outcome == "verified"`.
    pub verified: bool,
    /// Why this write did not confirm a copy, when it did not.
    pub message: Option<String>,
    /// Which of ADR 0001's two refusal conditions stopped the write, as
    /// `"unreadable"` or `"already-carries"`. `None` for any attempt that was
    /// transmitted, and for a failure that was never a refusal.
    ///
    /// This is the cause as a value rather than inside the prose above: the two
    /// conditions have two different fixes, and a caller that had to pattern-match
    /// a sentence to tell them apart would be one rewording away from presenting
    /// them identically (`write_guard::RefusalCause`).
    pub refusal_cause: Option<&'static str>,
    /// Confirmed copies of this Identity after the write, when a Snapshot in the
    /// library carries it. `None` means the library holds no such Snapshot.
    pub confirmed_copies: Option<u32>,
    /// Set when the count could not be written to the library file. The Tag was
    /// written either way, so this never fails the write.
    pub count_problem: Option<String>,
}

/// Apply one write outcome to the Snapshot that carries this Identity.
///
/// The counting rule is `WriteOutcome::counts_as_confirmed_copy`'s, so a caller
/// only has to hand over the outcome it observed. Recorded after the fact: the
/// Tag is written either way, so a library that cannot be written to is
/// reported, never raised.
fn record_write_count(
    app: &AppHandle,
    identity: &Identity,
    outcome: write_outcome::WriteOutcome,
) -> (WriteCountOutcome, Option<String>) {
    let store = match library_store(app) {
        Ok(store) => store,
        Err(e) => return (WriteCountOutcome::NoSnapshot, Some(e)),
    };
    // Read, count and write as one step, so a count recorded now cannot replace
    // a Draft or a Snapshot another part of the app saved a moment ago.
    match store.update(|library| library.record_write(identity, outcome)) {
        Ok((_, record)) => (record, None),
        Err(SaveError::Refused(problem)) => {
            (WriteCountOutcome::NoSnapshot, Some(problem.message()))
        }
        Err(e) => (WriteCountOutcome::NoSnapshot, Some(save_message(e))),
    }
}

/// Apply one write outcome to the Snapshot a 13.56 MHz write came from.
///
/// The counting rule is `WriteOutcome::counts_as_confirmed_copy`'s, applied by
/// the store, so this hands over the outcome it observed and nothing else. The
/// Tag is written either way, so a library that cannot be written to is reported
/// next to the write, never raised instead of it.
fn record_snapshot_write_count(
    app: &AppHandle,
    id: &str,
    outcome: write_outcome::WriteOutcome,
) -> (WriteCountOutcome, Option<String>) {
    let store = match library_store(app) {
        Ok(store) => store,
        Err(e) => return (WriteCountOutcome::NoSnapshot, Some(e)),
    };
    // Read, count and write as one step, so a count recorded now cannot replace
    // a Draft or a Snapshot another part of the app saved a moment ago.
    match store.update(|library| library.record_snapshot_write(id, outcome)) {
        Ok((_, record)) => (record, None),
        Err(SaveError::Refused(problem)) => {
            (WriteCountOutcome::NoSnapshot, Some(problem.message()))
        }
        Err(e) => (WriteCountOutcome::NoSnapshot, Some(save_message(e))),
    }
}

/// Write an Identity onto the 125 kHz tag currently on the reader.
///
/// The Identity is validated before any device access, and the write itself is
/// the guard's decision: an unreadable tag or a tag that already presents this
/// Identity is refused, per ADR 0001.
///
/// A write that the read-back confirms is one more confirmed copy of this
/// Identity, so the Snapshot that carries it gains a count. Nothing else
/// touches the count: a refusal, a failed transmission, and a write that could
/// not be read back are all reported without claiming a copy exists.
#[tauri::command]
fn lf_write(
    app: AppHandle,
    state: State<'_, AppState>,
    customer: u8,
    data32: u32,
) -> Result<WriteResult, String> {
    let identity = Identity::new(customer, data32).map_err(|e| e.to_string())?;
    let attempt = with_reader(&state, |r| Ok(r.lf_write_attempt(identity)))?;

    let (evidence, message, refusal_cause) = match &attempt {
        LfWriteAttempt::Refused { cause, message } => (
            Evidence::Refused,
            Some(message.clone()),
            Some(cause.as_str()),
        ),
        LfWriteAttempt::Failed(why) => (Evidence::NotTransmitted, Some(why.clone()), None),
        LfWriteAttempt::Transmitted(card) => (
            Evidence::Readback(card.as_ref().map(LfCard::identity)),
            None,
            None,
        ),
    };
    if matches!(attempt, LfWriteAttempt::Failed(_)) {
        // A transport error means the handle is suspect; drop it so the next
        // call re-enumerates instead of failing forever.
        if let Ok(mut slot) = state.reader.lock() {
            *slot = None;
        }
    }
    let outcome = write_outcome::classify(evidence, identity);

    let readback = match attempt {
        LfWriteAttempt::Transmitted(card) => card,
        _ => None,
    };

    let (record, count_problem) = record_write_count(&app, &identity, outcome);

    Ok(WriteResult {
        customer,
        data32,
        readback,
        outcome: outcome.as_str(),
        verified: outcome.counts_as_confirmed_copy(),
        message,
        refusal_cause,
        // A count that failed to persist is not reported as if it had.
        confirmed_copies: match count_problem {
            None => record.confirmed_copies(),
            Some(_) => None,
        },
        count_problem,
    })
}

/// What one attempt of a Batch Clone produced, in the shape the webview reads.
///
/// The batch holds one source Identity and writes it to successive Blanks. Each
/// attempt reports its own outcome, which is why this view is one attempt and
/// not a run: `skipped` is the case where the Tag in the write position already
/// presents the Identity, so nothing was written and nothing is counted.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchAttemptView {
    pub customer: u8,
    pub data32: u32,
    /// "verified" | "skipped" | "unverified" | "refused" | "failed" — see
    /// `batch::BatchOutcome`.
    pub outcome: &'static str,
    /// Why this attempt did not confirm a copy, when it did not.
    pub message: Option<String>,
    /// Which of ADR 0001's two refusal conditions stopped the attempt, when one
    /// did — `"unreadable"` or `"already-carries"`. A skip is the second one by
    /// definition, and it is still never counted as a copy.
    pub refusal_cause: Option<&'static str>,
    /// What the Tag read as for this attempt, when it read as anything.
    pub readback: Option<LfCard>,
    /// Confirmed copies of this Identity after the attempt, when a Snapshot in
    /// the library carries it. A skip never moves this number.
    pub confirmed_copies: Option<u32>,
    /// Set when the count could not be written to the library file.
    pub count_problem: Option<String>,
}

/// One attempt of a Batch Clone: write `customer`/`data32` to the Tag now on the
/// reader, guarded exactly as a single Clone is.
///
/// Called once per Blank. The Identity comes from the caller, which read the
/// source Tag once when the run started, so no attempt re-reads the source. The
/// Tag in the *write* position is re-read on every attempt (ADR 0001), so a Tag
/// that cannot be read is refused rather than written blind, and a Tag that
/// already presents this Identity is not written again — it is reported as
/// `skipped`, which is legible and is never counted as a copy.
#[tauri::command]
fn lf_clone_attempt(
    app: AppHandle,
    state: State<'_, AppState>,
    customer: u8,
    data32: u32,
) -> Result<BatchAttemptView, String> {
    let identity = Identity::new(customer, data32).map_err(|e| e.to_string())?;
    let attempt = with_reader(&state, |r| Ok(batch::guarded_attempt(r, identity)))?;
    if matches!(attempt, BatchAttempt::Failed(_)) {
        // A transport error means the handle is suspect; drop it so the next
        // attempt re-enumerates instead of failing forever.
        if let Ok(mut slot) = state.reader.lock() {
            *slot = None;
        }
    }
    let verdict = batch::verdict(&attempt, identity);
    let outcome = verdict.outcome;

    let (record, count_problem) = record_write_count(&app, &identity, outcome.write_outcome());

    Ok(BatchAttemptView {
        customer,
        data32,
        outcome: outcome.as_str(),
        message: verdict.message,
        refusal_cause: verdict.refusal.map(|cause| cause.as_str()),
        readback: verdict.readback,
        confirmed_copies: match count_problem {
            None => record.confirmed_copies(),
            Some(_) => None,
        },
        count_problem,
    })
}

/// What one guarded Clear or Destroy produced, in the shape the webview reads.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearResult {
    /// The Identity the user confirmed, which is what was overwritten.
    pub customer: u8,
    pub data32: u32,
    /// "clear" | "destroy" — the operation the user chose, echoed back so the
    /// interface can never word a result for a different action than it asked for.
    pub operation: &'static str,
    /// "refused" | "cleared" | "destroyed" | "unverified" | "failed" |
    /// "willNotAcceptWrites" — see `write_outcome`. Never "verified": neither
    /// operation places a copy.
    pub outcome: &'static str,
    /// True only when the re-read presented the cleared placeholder. Mirror of
    /// `outcome == "cleared"`, and never true for a destroy.
    pub cleared: bool,
    /// True only when the re-read found no Identity. Mirror of
    /// `outcome == "destroyed"`, and never true for a clear.
    pub destroyed: bool,
    /// The Identity the Tag presents, when it presented one: the placeholder after
    /// a Clear that landed, and what it kept when the write did not take.
    pub presents: Option<String>,
    /// Why the Tag was not overwritten as asked, when it was not.
    pub message: Option<String>,
}

/// Clear or destroy the Identity on the 125 kHz tag on the reader.
///
/// `customer` and `data32` are the Identity the user confirmed in the UI, and
/// `operation` is which of the two writes they asked for. The guard refuses unless
/// the tag in the write position presents exactly that Identity, so a confirmation
/// can never be applied to a different tag — and refuses outright when no tag can
/// be read, per ADR 0001. There is no "write anyway": neither refusal is a prompt.
///
/// The two operations write two different payloads and report two different
/// outcomes, and neither can be reported as the other:
///
///   * `clear` writes the non-zero placeholder (customer `0x00`, data32
///     `0x00FFFFFF`). The tag stops being a working credential and stays a live,
///     rewritable chip: it still reads as a Tag, so a Clone or an authored Identity
///     can be written onto it next.
///   * `destroy` writes the neutral Identity (all zeroes). Measured on hardware,
///     a T5577 written with it stops presenting an Identity, keeps answering every
///     reader, and permanently refuses further data. It is the deliberate,
///     destructive operation and it is never the default.
///
/// Nothing is recorded in the library. Neither operation copies an Identity, so no
/// Snapshot's confirmed-copy count may move; a Snapshot that describes the
/// overwritten value stays exactly as it is, because a Snapshot records what a Tag
/// held when it was read, not what a Tag holds now.
#[tauri::command]
fn lf_clear(
    state: State<'_, AppState>,
    customer: u8,
    data32: u32,
    operation: String,
) -> Result<ClearResult, String> {
    // The wire name is closed: an unknown operation is an error rather than a
    // default, because defaulting here would silently pick one of two irreversible
    // writes.
    let operation = clear::LfOperation::from_wire(&operation)?;
    // Built without `Identity::new`: a reading is not range-checked, and a tag
    // whose data field carries bits this app cannot encode is still a tag the
    // user may want to clear.
    let confirmed = Identity { customer, data32 };
    let attempt = with_reader(&state, |r| Ok(r.lf_clear_attempt(confirmed, operation)))?;
    if matches!(attempt, ClearAttempt::Failed(_)) {
        // A transport error means the handle is suspect; drop it so the next
        // call re-enumerates instead of failing forever.
        if let Ok(mut slot) = state.reader.lock() {
            *slot = None;
        }
    }
    let verdict = clear::verdict(operation, &attempt);
    let cleared = matches!(verdict.outcome, write_outcome::WriteOutcome::Cleared);
    let destroyed = matches!(verdict.outcome, write_outcome::WriteOutcome::Destroyed);
    Ok(ClearResult {
        customer,
        data32,
        operation: operation.as_str(),
        outcome: verdict.outcome.as_str(),
        cleared,
        destroyed,
        presents: verdict.presented.map(|id| id.id()),
        message: verdict.message,
    })
}
/// What a Draft write would do to the Tag on the Reader, before anything is
/// written. The confirmation names the message that would be replaced, so a
/// write is never consented to blind.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NdefPreviewView {
    /// What the Tag holds now, decoded no further than the TLV. The webview's
    /// NDEF codec turns `existing.messageHex` into Records.
    pub tag: Option<TagView>,
    /// Bytes the Draft's message would occupy on the Tag, TLV overhead included.
    pub required_bytes: usize,
    pub capacity_bytes: Option<usize>,
    /// True only when a write would actually proceed.
    pub fits: bool,
    /// Why the write would not proceed, when it would not: an empty Draft, a
    /// message larger than the Tag, a Tag whose capacity cannot be read, or no
    /// Tag in the field.
    pub refusal: Option<String>,
}

impl From<NdefPreview> for NdefPreviewView {
    fn from(preview: NdefPreview) -> Self {
        Self {
            tag: preview.tag,
            required_bytes: preview.required_bytes,
            capacity_bytes: preview.capacity_bytes,
            fits: preview.fits,
            refusal: preview.refusal,
        }
    }
}

/// What one write of a message to a 13.56 MHz Tag did, in the shape the webview
/// reads it.
///
/// Writing a Draft and writing a Snapshot's Records produce this same value:
/// they are one operation with different provenance, and both are counted by the
/// same rule.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NdefWriteView {
    /// "refused" | "verified" | "unverified" | "failed" — see `write_outcome`.
    pub outcome: &'static str,
    /// Why this write did not land a confirmed copy, when it did not.
    pub message: Option<String>,
    /// What the Tag held before the write, from the read that precedes it.
    pub before: Option<TagView>,
    /// What it read back as afterwards, when it could be re-read.
    pub after: Option<TagView>,
    pub capacity_bytes: Option<usize>,
    pub required_bytes: usize,
    /// Pages the request asked the firmware to write.
    pub wrote_pages: Vec<usize>,
    /// Pages the firmware reported writing.
    pub accepted_pages: Vec<usize>,
    /// Confirmed copies of the Snapshot these Records came from, after the
    /// write. `None` when the write named no Snapshot (a Draft), or when the
    /// library holds none under that id. A Draft owns no count: it is attached
    /// to no Tag, so there is nothing to be honest about.
    pub confirmed_copies: Option<u32>,
    /// True only when the count actually rose — one verified write of a
    /// Snapshot's Records. False for a Draft, for a Snapshot the library does
    /// not hold, and for every outcome that is not a confirmed copy, so a caller
    /// reloads the list only when there is something new in it.
    pub count_changed: bool,
    /// Set when the count could not be written to the library file. The Tag was
    /// written either way, so this never fails the write.
    pub count_problem: Option<String>,
}

impl From<NdefWrite> for NdefWriteView {
    fn from(write: NdefWrite) -> Self {
        Self {
            outcome: write.outcome.as_str(),
            message: write.message,
            before: write.before,
            after: write.readback,
            capacity_bytes: write.capacity_bytes,
            required_bytes: write.required_bytes,
            wrote_pages: write.wrote_pages,
            accepted_pages: write.accepted_pages,
            // Filled in by the command when the write named a Snapshot.
            confirmed_copies: None,
            count_changed: false,
            count_problem: None,
        }
    }
}

/// What the password panel is told about the Tag on the Reader.
///
/// Everything here comes from a **read**: `0x0083` and `0x0081` only. There is no
/// write path for password protection on this Reader, so this view has no
/// "allowed" field to be wrong about — the refusal is expressed by
/// [`PasswordAttemptView`] instead.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordStatusView {
    /// UID of the Tag that was read, when one was.
    pub uid: Option<String>,
    /// User memory in bytes, from the Type 2 Capability Container.
    pub capacity_bytes: Option<usize>,
    /// "unknown" | "disabled" | "enabled". Always "unknown" on this Reader.
    pub protection: &'static str,
    /// Why protection cannot be determined, in one sentence.
    pub why_unknown: String,
    /// Page 131 as the Reader returned it (AUTH0, ACCESS, VCTID, RFUI), hex.
    /// Deliberately named as a read: it is not the Tag's configuration.
    pub auth0_page_read: Option<String>,
    /// Page 133 as the Reader returned it (PWD), hex.
    pub pwd_page_read: Option<String>,
    /// Page 134 as the Reader returned it (PACK), hex.
    pub pack_page_read: Option<String>,
    /// False: this Reader's configuration-area read is not real configuration.
    pub configuration_real: bool,
    /// Pages setting a password would have to change. Never written.
    pub set_pages: Vec<usize>,
    /// Pages removing a password would have to change. Never written.
    pub remove_pages: Vec<usize>,
    /// False: this protocol has no command that authenticates a Tag.
    pub reader_can_authenticate: bool,
}

impl From<password::PasswordReport> for PasswordStatusView {
    fn from(report: password::PasswordReport) -> Self {
        let hex_page = |page: Option<[u8; 4]>| page.map(|bytes| reader::hex(&bytes));
        let config = report.config;
        Self {
            uid: report.uid,
            capacity_bytes: report.capacity_bytes,
            protection: report.protection.as_str(),
            why_unknown: report.why_unknown,
            auth0_page_read: config.and_then(|c| hex_page(c.auth0_page_read)),
            pwd_page_read: config.and_then(|c| hex_page(c.pwd_page_read)),
            pack_page_read: config.and_then(|c| hex_page(c.pack_page_read)),
            configuration_real: config
                .map(|c| c.real_configuration)
                .unwrap_or(password::CONFIG_PAGES_ARE_REAL),
            set_pages: report.set_pages,
            remove_pages: report.remove_pages,
            reader_can_authenticate: password::READER_CAN_AUTHENTICATE,
        }
    }
}

/// What one requested password operation came to: a refusal, always.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordAttemptView {
    /// Always "refused". Spelled out so the shared notice vocabulary reads it
    /// the same way it reads a write outcome.
    pub outcome: &'static str,
    /// Machine code: "not-acknowledged", "cannot-authenticate",
    /// "protection-unknown", "config-unreadable", "nothing-to-remove",
    /// "config-page-write".
    pub refusal: &'static str,
    pub message: String,
    /// Pages the operation would have had to change, had it been possible.
    pub would_write_pages: Vec<usize>,
    /// Always empty: no frame is sent for either operation.
    pub wrote_pages: Vec<usize>,
}

impl PasswordAttemptView {
    /// Ask the password module and hand back its answer.
    ///
    /// `password::decide` returns `Result<Infallible, _>`, so the `Ok` arm holds a
    /// value that cannot exist. Matching it with an empty `match never {}` is how
    /// this file proves no password operation has a success path.
    fn attempt(operation: password::PasswordOperation, acknowledged: bool) -> Self {
        let request = password::PasswordRequest {
            operation,
            acknowledged,
            protection: password::ProtectionStatus::Unknown,
        };
        match password::decide(&request) {
            Err(refusal) => Self {
                outcome: "refused",
                refusal: refusal.code(),
                message: refusal.notice(),
                would_write_pages: operation.config_pages(),
                wrote_pages: Vec::new(),
            },
            Ok(never) => match never {},
        }
    }
}

/// The NDEF message a Draft encodes to, as bytes. The codec lives in the
/// webview (`src/lib/ndef.ts`), which owns NDEF; this only refuses bytes it
/// cannot read, so a malformed message never reaches a Tag.
fn message_bytes(message_hex: &str) -> Result<Vec<u8>, String> {
    let bytes = reader::parse_hex(message_hex)?;
    if bytes.is_empty() {
        return Err("this Draft encodes to no bytes, so there is no message to write".to_string());
    }
    Ok(bytes)
}

/// What writing a Draft to the 13.56 MHz Tag on the Reader would replace.
///
/// Read-only: it sends the info and read commands and nothing else, so the
/// confirmation can name the Tag's current message or state that the Tag appears
/// empty before the user consents.
#[tauri::command]
fn hf_ndef_preview(
    state: State<'_, AppState>,
    message_hex: String,
) -> Result<NdefPreviewView, String> {
    let message = message_bytes(&message_hex)?;
    with_reader(&state, |r| Ok(ntag::preview(r, &message).into()))
}

/// Write a message to the 13.56 MHz Tag on the Reader as one complete NDEF
/// message, then read it back.
///
/// The message is a Draft's Records or a Snapshot's, encoded by the webview's
/// one NDEF codec — this command does not care which, because writing either is
/// the same operation and goes through the same confirmation. `snapshot_id` is
/// the difference: when the Records came from a Snapshot, it names the Snapshot
/// so a confirmed copy can be counted against it. A Draft names none and has no
/// count, because it is attached to no Tag.
///
/// Nothing is sent for an empty message or one the Tag cannot hold, and a Tag
/// that cannot be read first is not written at all. The write itself is one
/// 21-report frame carrying the Tag's whole image, with only the pages the
/// message occupies marked for writing — so the UID, lock bytes and Capability
/// Container cannot be touched (see `ntag::plan_write`).
///
/// The outcome is the same vocabulary the 125 kHz path uses: only `verified`, a
/// read-back that matches what was written, is a write that landed — and only
/// then does the Snapshot's confirmed-copy count rise.
#[tauri::command]
fn hf_ndef_write(
    app: AppHandle,
    state: State<'_, AppState>,
    message_hex: String,
    snapshot_id: Option<String>,
) -> Result<NdefWriteView, String> {
    let message = message_bytes(&message_hex)?;
    let written = with_reader(&state, |r| Ok(ntag::write_message(r, &message)))?;
    // The outcome is read before the value is turned into its view, because the
    // counting rule is the enum's and not a wire string's.
    let outcome = written.outcome;
    let mut view = NdefWriteView::from(written);
    if let Some(id) = snapshot_id.as_deref() {
        let (record, problem) = record_snapshot_write_count(&app, id, outcome);
        view.count_changed = problem.is_none() && record.incremented();
        view.confirmed_copies = match problem {
            None => record.confirmed_copies(),
            Some(_) => None,
        };
        view.count_problem = problem;
    }
    Ok(view)
}

/// What can be determined about the password protection of the Tag on the
/// Reader.
///
/// Read-only: `0x0083` info and `0x0081` memory read, nothing else. The answer is
/// always "cannot be determined", because this firmware's configuration-area
/// read is not the Tag's configuration (docs/PROTOCOL.md open problem 5, and
/// `password.rs` for the contradiction that settles it). A Tag that cannot be
/// read is reported as such rather than as unprotected.
#[tauri::command]
fn hf_password_status(state: State<'_, AppState>) -> Result<PasswordStatusView, String> {
    with_reader(&state, |r| {
        Ok(match ntag::read_tag(r) {
            Ok(Some(read)) => password::report_from_image(read.info.uid.clone(), &read.memory).into(),
            Ok(None) => password::report_without_tag(ntag::NO_TAG_MESSAGE).into(),
            Err(e) => password::report_without_tag(&format!(
                "the Tag could not be read, so its protection cannot be determined: {e}"
            ))
            .into(),
        })
    })
}

/// Set a password on the Tag on the Reader — refused, always.
///
/// No frame is sent and the Reader is not opened. The protocol has no
/// authentication command, so a password set here could never be satisfied and
/// the write that would clear `AUTH0` sits behind the protection it clears.
/// `password::decide` has no success path at all, so this cannot become a write
/// by changing a flag.
#[tauri::command]
fn hf_password_set(acknowledged: bool) -> PasswordAttemptView {
    PasswordAttemptView::attempt(password::PasswordOperation::Set, acknowledged)
}

/// Remove the password from the Tag on the Reader — refused, always.
///
/// Removing protection needs either `PWD_AUTH` to get in, or an unprotected write
/// of `AUTH0 = 0xFF`; this protocol has the first nowhere and the second is
/// exactly what a protected Tag refuses. Protection status also cannot be read,
/// so a Tag whose password is unknown is never treated as recoverable.
#[tauri::command]
fn hf_password_remove(acknowledged: bool) -> PasswordAttemptView {
    PasswordAttemptView::attempt(password::PasswordOperation::Remove, acknowledged)
}

/// What erasing the 13.56 MHz Tag's NDEF content would clear, before anything is
/// cleared.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NdefErasePreviewView {
    /// What the Tag holds now, so the confirmation can name what will be lost.
    pub tag: Option<TagView>,
    /// Bytes of the current NDEF TLV an erase would clear, terminator included.
    pub clears_bytes: usize,
    /// User pages an erase would write: `03 00 FE` plus the old message's tail.
    pub pages: Vec<usize>,
    pub capacity_bytes: Option<usize>,
    /// True only when an erase would actually proceed.
    pub can_erase: bool,
    /// Why the erase would not proceed, when it would not: no Tag in the field,
    /// a Tag that could not be read, no NDEF message to clear, an already empty
    /// message, unreadable content, or a capacity that cannot be read.
    pub refusal: Option<String>,
}

impl From<ErasePreview> for NdefErasePreviewView {
    fn from(preview: ErasePreview) -> Self {
        Self {
            tag: preview.tag,
            clears_bytes: preview.clears_bytes,
            pages: preview.pages,
            capacity_bytes: preview.capacity_bytes,
            can_erase: preview.can_erase,
            refusal: preview.refusal,
        }
    }
}

/// What one erase did, in the shape the webview reads it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NdefEraseView {
    /// "refused" | "erased" | "unverified" | "failed" — see `write_outcome`.
    /// Never "verified": clearing content places no copy to verify.
    pub outcome: &'static str,
    /// Why the content was not cleared, when it was not.
    pub message: Option<String>,
    /// What the Tag held before the erase, from the read that precedes it.
    pub before: Option<TagView>,
    /// What it read back as afterwards, when it could be re-read.
    pub after: Option<TagView>,
    pub capacity_bytes: Option<usize>,
    /// Bytes of the old NDEF TLV the erase cleared.
    pub cleared_bytes: usize,
    /// Pages the request asked the firmware to write.
    pub erase_pages: Vec<usize>,
    /// Pages the firmware reported writing.
    pub accepted_pages: Vec<usize>,
    /// Pages 0..=3 (UID, lock bytes, Capability Container) read identically
    /// before and after. `None` when there was nothing to compare.
    pub identity_intact: Option<bool>,
    /// The bytes written over the message area, hex. Evidence, not a summary.
    pub written_hex: String,
}

impl From<EraseReport> for NdefEraseView {
    fn from(report: EraseReport) -> Self {
        Self {
            outcome: report.outcome.as_str(),
            message: report.message,
            before: report.before,
            after: report.readback,
            capacity_bytes: report.capacity_bytes,
            cleared_bytes: report.cleared_bytes,
            erase_pages: report.erase_pages,
            accepted_pages: report.accepted_pages,
            identity_intact: report.identity_intact,
            written_hex: report.written_hex,
        }
    }
}

/// What erasing the 13.56 MHz Tag's NDEF content would do, without doing it.
///
/// Read-only: it sends the info and read commands and nothing else, so the
/// confirmation can name the Records that would be lost before the user
/// consents. The Tag keeps its UID, its Capability Container and its format —
/// only the NDEF message is cleared.
#[tauri::command]
fn hf_ndef_erase_preview(
    state: State<'_, AppState>,
) -> Result<NdefErasePreviewView, String> {
    with_reader(&state, |r| Ok(ntag::preview_erase(r).into()))
}

/// Clear the NDEF content of the 13.56 MHz Tag on the Reader, then read it back.
///
/// A Tag that cannot be read first is not erased at all (ADR 0001), and a Tag
/// with no NDEF message to clear is refused rather than formatted. The write is
/// one 21-report frame carrying the Tag's whole image, with only the pages the
/// old message occupied marked — so the UID, lock bytes and Capability Container
/// cannot be touched (`ntag::plan_erase`, which reuses ticket 18's page guard).
///
/// The outcome has its own word: `erased`, which is never `verified` and never
/// raises a Snapshot's confirmed-copy count.
#[tauri::command]
fn hf_ndef_erase(state: State<'_, AppState>) -> Result<NdefEraseView, String> {
    with_reader(&state, |r| Ok(ntag::erase_ndef(r).into()))
}

/// Send an arbitrary frame. Input is a hex string; the frame is zero-padded to
/// 64 bytes. Useful for probing commands that are not yet wrapped.
///
/// A release build sends only the commands on `console::RELEASE_ALLOWED`; the
/// rest are refused before the Reader is opened, so a refused frame reaches no
/// device and does not even claim the USB handle (ADR 0006).
#[tauri::command]
fn raw_send(
    state: State<'_, AppState>,
    hex: String,
) -> Result<Option<RawResponse>, console::ConsoleError> {
    let mut bytes = reader::parse_hex(&hex).map_err(console::ConsoleError::failed)?;
    if let Some(refusal) = console::decide(console::CAPABILITY, console::command_in(&bytes)).refusal()
    {
        return Err(refusal);
    }
    if bytes.len() > REPORT_LEN {
        return Err(console::ConsoleError::failed(format!(
            "frame is {} bytes, maximum is {REPORT_LEN}",
            bytes.len()
        )));
    }
    bytes.resize(REPORT_LEN, 0);
    let mut frame = [0u8; REPORT_LEN];
    frame.copy_from_slice(&bytes);

    with_reader(&state, |r| {
        let resp: Option<Frame> = r.raw_command(&frame)?;
        Ok(resp.map(|f| RawResponse {
            sent: reader::hex(&frame),
            cmd: f.cmd,
            payload: reader::hex(&f.payload),
            checksum_ok: f.checksum_ok,
            raw: frame_with_meta(&f),
        }))
    })
    .map_err(console::ConsoleError::failed)
}

fn frame_with_meta(f: &Frame) -> String {
    let mut s = format!("{:04X}  ", f.cmd);
    s.push_str(&reader::hex(&f.payload));
    s
}

/// Send a command by id with a hex payload, building a correctly checksummed
/// frame. Used by the diagnostics page so probe frames are never malformed.
///
/// Held to the same allow-list as `raw_send`: two commands that reach the same
/// wire must not disagree about what this build may send.
#[tauri::command]
fn send_cmd(
    state: State<'_, AppState>,
    cmd: u16,
    payload: String,
) -> Result<Option<RawResponse>, console::ConsoleError> {
    if let Some(refusal) = console::decide(console::CAPABILITY, cmd).refusal() {
        return Err(refusal);
    }
    let bytes = reader::parse_hex(&payload).map_err(console::ConsoleError::failed)?;
    if bytes.len() > reader::REPORT_LEN - 7 {
        return Err(console::ConsoleError::failed(format!(
            "payload is {} bytes, maximum is {}",
            bytes.len(),
            reader::REPORT_LEN - 7
        )));
    }
    with_reader(&state, |r| {
        let frame = reader::make_frame(cmd, &bytes);
        let resp = r.raw_command(&frame)?;
        Ok(resp.map(|f| RawResponse {
            sent: reader::hex(&frame),
            cmd: f.cmd,
            payload: reader::hex(&f.payload),
            checksum_ok: f.checksum_ok,
            raw: frame_with_meta(&f),
        }))
    })
    .map_err(console::ConsoleError::failed)
}

/// Which commands this build's raw console sends, asked before the console is
/// used so it can say it is read-only up front (ADR 0006).
///
/// No Reader is touched: the answer is a property of the binary, not of the
/// hardware.
#[tauri::command]
fn console_capability() -> console::CapabilityView {
    console::capability_view(console::CAPABILITY)
}

/// The app data directory Tauri resolves from the bundle identifier, never a
/// hardcoded path, so a rename of the app moves everything it saved with it
/// instead of losing it.
///
/// This is the only place the directory is resolved, so the store and the clear
/// action cannot disagree about where this app keeps its files.
fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve the app data directory: {e}"))
}

/// Where the library lives: the one file name inside the app data directory.
fn library_store(app: &AppHandle) -> Result<LibraryStore, String> {
    Ok(LibraryStore::new(app_data_dir(app)?.join(library::FILE_NAME)))
}

/// One file the clear action removed, in the shape the webview reports.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovedTargetView {
    /// "libraryFile" | "staleTemp"
    pub target: &'static str,
    pub path: String,
    pub bytes: u64,
}

/// The file that stopped the clear action, and why it could not be removed.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockedTargetView {
    /// "libraryFile" | "staleTemp"
    pub target: &'static str,
    pub path: String,
    pub reason: String,
}

/// What clearing every file this app saved came to.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearView {
    /// True only when every target that existed was removed.
    pub cleared: bool,
    /// Exactly what was removed: never a target that was not there.
    pub removed: Vec<RemovedTargetView>,
    /// The part that could not be removed. `None` when `cleared` is true.
    pub blocked: Option<BlockedTargetView>,
}

impl From<clear_data::Removed> for RemovedTargetView {
    fn from(removed: clear_data::Removed) -> Self {
        Self {
            target: removed.kind.id(),
            path: removed.path.display().to_string(),
            bytes: removed.bytes,
        }
    }
}

/// Remove every file this app has saved: the library file, and the temporary
/// sibling a save may have left beside it.
///
/// It takes **no path from input**. The two targets are resolved here from the
/// app data directory, so there is no argument through which the webview (or
/// anything else driving this command) can name a file outside this app's own
/// storage. What is removed, and what refuses the action, is
/// [`clear_data::clear`]'s to decide; this only resolves and reports.
///
/// It runs inside the library's serialisation domain, so it cannot race a save
/// that is reading and replacing the same file. It is reachable only from the
/// Settings → Data gate that requires the word `clear`: no save, load, import or
/// migration calls it, which is what keeps a failed write from turning into a
/// quiet deletion (see the exception recorded in [`library`]).
#[tauri::command]
fn clear_all_saved_data(app: AppHandle) -> Result<ClearView, String> {
    let dir = app_data_dir(&app)?;
    let scope = clear_data::ClearScope::resolve(&dir);
    let outcome = library::serialised(|domain| clear_data::clear(domain, &scope));
    Ok(match outcome {
        clear_data::ClearOutcome::Cleared { removed } => ClearView {
            cleared: true,
            removed: removed.into_iter().map(RemovedTargetView::from).collect(),
            blocked: None,
        },
        clear_data::ClearOutcome::Refused { blocked, removed } => ClearView {
            cleared: false,
            removed: removed.into_iter().map(RemovedTargetView::from).collect(),
            blocked: Some(BlockedTargetView {
                target: blocked.kind.id(),
                path: blocked.path.display().to_string(),
                reason: blocked.reason,
            }),
        },
    })
}

/// Which file a reveal should hand to the file manager.
///
/// A library nobody has saved yet has no file to select, so the directory it
/// will be written into is revealed instead: the place is the answer either way,
/// and revealing a path that does not exist fails.
fn reveal_target(path: &Path) -> &Path {
    match path.is_file() {
        true => path,
        false => path.parent().unwrap_or(path),
    }
}

/// Show the library file in the system file manager.
///
/// Takes no path: it reveals the one file the store resolved, so a caller
/// cannot use it to open something else. The command returns the path it
/// revealed, because every platform's file manager may be slow to appear and
/// the page can still state where the file is.
#[tauri::command]
fn library_reveal(app: AppHandle) -> Result<String, String> {
    let store = library_store(&app)?;
    let target = reveal_target(store.path()).to_path_buf();
    reveal_in_file_manager(&target).map_err(|e| {
        format!(
            "the file manager could not be opened for {}: {e}",
            target.display()
        )
    })?;
    Ok(store.path().display().to_string())
}

/// Open the system file manager at one path, selecting it where the platform
/// can. Spawned, not awaited: the file manager is not this app's child process.
#[cfg(target_os = "macos")]
fn reveal_in_file_manager(path: &Path) -> std::io::Result<()> {
    std::process::Command::new("open")
        .arg("-R")
        .arg(path)
        .spawn()
        .map(|_| ())
}

#[cfg(target_os = "windows")]
fn reveal_in_file_manager(path: &Path) -> std::io::Result<()> {
    std::process::Command::new("explorer")
        .arg(if path.is_dir() {
            path.as_os_str().to_owned()
        } else {
            format!("/select,{}", path.display()).into()
        })
        .spawn()
        .map(|_| ())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn reveal_in_file_manager(path: &Path) -> std::io::Result<()> {
    let dir = if path.is_dir() {
        path
    } else {
        path.parent().unwrap_or(path)
    };
    std::process::Command::new("xdg-open")
        .arg(dir)
        .spawn()
        .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::reveal_target;

    #[test]
    fn a_reveal_selects_the_library_file_when_it_exists() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");
        std::fs::write(&path, b"{}").expect("library");

        assert_eq!(reveal_target(&path), path, "the file itself is selected");
    }

    #[test]
    fn a_reveal_of_a_library_nobody_has_saved_shows_its_directory() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("library.json");

        // Revealing a path that does not exist fails on every platform, and the
        // answer the user wants is where it will be.
        assert_eq!(reveal_target(&path), dir.path());
    }
}

/// Why a library file must not be read or written, in the shape the UI shows.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProblemView {
    /// "corrupt" | "newerVersion" | "olderVersion" | "unreadable"
    pub kind: &'static str,
    pub message: String,
    pub detail: Option<String>,
}

impl From<LibraryProblem> for ProblemView {
    fn from(problem: LibraryProblem) -> Self {
        let (kind, detail) = match &problem {
            LibraryProblem::Corrupt { detail } => ("corrupt", Some(detail.clone())),
            LibraryProblem::NewerVersion { .. } => ("newerVersion", None),
            LibraryProblem::OlderVersion { .. } => ("olderVersion", None),
            LibraryProblem::Unreadable { detail } => ("unreadable", Some(detail.clone())),
        };
        Self {
            kind,
            message: problem.message(),
            detail,
        }
    }
}

/// The library as the UI renders it. `problem` set means the file was left
/// alone and nothing may be saved until the user deals with it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryView {
    pub path: String,
    /// The schema version this build writes.
    pub version: u32,
    pub snapshots: Vec<Snapshot>,
    pub problem: Option<ProblemView>,
    /// Set when an older library was lifted to this build's schema but the lift
    /// could not be written back. The library in memory is the lifted one and
    /// saving is allowed; the file still carries the older version claim until
    /// a save corrects it, which is what there is to say.
    pub migration_warning: Option<String>,
}

fn loaded_view(store: &LibraryStore, library: Library) -> LibraryView {
    LibraryView {
        path: store.path().display().to_string(),
        version: library.version,
        snapshots: library.snapshots,
        problem: None,
        migration_warning: None,
    }
}

/// The view for an open library: the same as a loaded one, plus whatever the
/// lift of an older file has to report.
fn opened_view(store: &LibraryStore, open: Open) -> LibraryView {
    match open {
        Open::Opened { library, migration } => LibraryView {
            migration_warning: migration.and_then(|lift| lift.message()),
            ..loaded_view(store, library)
        },
        Open::Refused(problem) => refused_view(store, problem),
    }
}

fn refused_view(store: &LibraryStore, problem: LibraryProblem) -> LibraryView {
    LibraryView {
        path: store.path().display().to_string(),
        version: library::SCHEMA_VERSION,
        snapshots: Vec::new(),
        problem: Some(problem.into()),
        migration_warning: None,
    }
}

/// The message a save that did not happen is reported with.
fn save_message(error: SaveError) -> String {
    match error {
        SaveError::Refused(problem) => problem.message(),
        SaveError::Io(detail) => format!("The library could not be saved: {detail}"),
    }
}

/// What a change to the library came to.
enum Changed<R> {
    /// The library was read, changed and written back as one step. `library` is
    /// the library the change produced.
    Done { library: Library, result: R },
    /// The file is not one this build may touch, and nothing was written.
    Refused(LibraryProblem),
}

/// Change the library in one step, so that no save of any kind can land between
/// this command's read and its write.
///
/// A caller that reads the library itself and then saves it hands over a version
/// that may already be out of date: another part of the app can save in between,
/// and the write then replaces that save with this one, silently. Handing the
/// change to the store is what makes two saves in quick succession both land.
///
/// A refusal is not an error: it is the file this build must not touch, and the
/// caller reports it as the view that says so.
fn change_library<R>(
    store: &LibraryStore,
    change: impl FnOnce(&mut Library) -> R,
) -> Result<Changed<R>, String> {
    match store.update(change) {
        Ok((library, result)) => Ok(Changed::Done { library, result }),
        Err(SaveError::Refused(problem)) => Ok(Changed::Refused(problem)),
        Err(e) => Err(save_message(e)),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    /// "added" | "duplicate" | "refused"
    pub outcome: &'static str,
    pub library: LibraryView,
    /// The Snapshot concerned: the new one, or the one already in the library.
    pub snapshot: Option<Snapshot>,
}

/// Read the library. Also works with no Reader attached, which is the point.
///
/// This is the app's open: a file written by an older schema is lifted here and
/// the lift is written back before the view is returned, so the version the
/// user's file claims is the version it holds (ADR 0005).
#[tauri::command]
fn library_load(app: AppHandle) -> Result<LibraryView, String> {
    let store = library_store(&app)?;
    Ok(opened_view(&store, store.open()))
}

/// Save a 125 kHz read as a Snapshot. A read already in the library is reported
/// as a duplicate instead of being added a second time.
#[tauri::command]
fn library_save_lf(
    app: AppHandle,
    customer: u8,
    data32: u32,
    raw: String,
    captured_at: String,
) -> Result<SaveResult, String> {
    let store = library_store(&app)?;
    match change_library(&store, |library| {
        library.add_lf(customer, data32, &raw, &captured_at)
    })? {
        Changed::Refused(problem) => Ok(SaveResult {
            outcome: "refused",
            library: refused_view(&store, problem),
            snapshot: None,
        }),
        Changed::Done { library, result } => match result {
            InsertOutcome::Duplicate(existing) => Ok(SaveResult {
                outcome: "duplicate",
                library: loaded_view(&store, library),
                snapshot: Some(existing),
            }),
            InsertOutcome::Added(added) => Ok(SaveResult {
                outcome: "added",
                library: loaded_view(&store, library),
                snapshot: Some(added),
            }),
        },
    }
}

/// Save a 13.56 MHz read as a Snapshot, keeping everything the read found.
///
/// The caller hands over the read's own fields — the UID, the raw reply, the
/// ATQA and SAK, the family they resolved to, the capacity, the NDEF status and
/// the Records in order — so this command adds no interpretation of its own. A
/// read already in the library (the same UID) is reported as a duplicate instead
/// of being stored twice, and a file this build must not write to is reported as
/// refused rather than raised.
#[tauri::command]
fn library_save_hf(
    app: AppHandle,
    hf: library::HfFields,
    captured_at: String,
) -> Result<SaveResult, String> {
    let store = library_store(&app)?;
    match change_library(&store, |library| library.add_hf(hf, &captured_at))? {
        Changed::Refused(problem) => Ok(SaveResult {
            outcome: "refused",
            library: refused_view(&store, problem),
            snapshot: None,
        }),
        Changed::Done { library, result } => match result {
            InsertOutcome::Duplicate(existing) => Ok(SaveResult {
                outcome: "duplicate",
                library: loaded_view(&store, library),
                snapshot: Some(existing),
            }),
            InsertOutcome::Added(added) => Ok(SaveResult {
                outcome: "added",
                library: loaded_view(&store, library),
                snapshot: Some(added),
            }),
        },
    }
}

/// Rename one Snapshot. The name is user copy, so it is only trimmed.
#[tauri::command]
fn library_rename(app: AppHandle, id: String, name: String) -> Result<LibraryView, String> {
    let store = library_store(&app)?;
    match change_library(&store, |library| library.rename(&id, &name))? {
        Changed::Refused(problem) => Ok(refused_view(&store, problem)),
        Changed::Done { library, .. } => Ok(loaded_view(&store, library)),
    }
}

/// Write the name and note a user gave one Snapshot. Both are user copy, so
/// they are only trimmed, and one call writes both or neither: a cancelled
/// edit never reaches the store.
#[tauri::command]
fn library_edit(
    app: AppHandle,
    id: String,
    name: String,
    note: String,
) -> Result<LibraryView, String> {
    let store = library_store(&app)?;
    match change_library(&store, |library| library.edit(&id, &name, &note))? {
        Changed::Refused(problem) => Ok(refused_view(&store, problem)),
        Changed::Done { library, .. } => Ok(loaded_view(&store, library)),
    }
}

/// Delete one Snapshot. Permanent, as the spec requires.
#[tauri::command]
fn library_delete(app: AppHandle, id: String) -> Result<LibraryView, String> {
    let store = library_store(&app)?;
    match change_library(&store, |library| library.remove(&id))? {
        Changed::Refused(problem) => Ok(refused_view(&store, problem)),
        Changed::Done { library, .. } => Ok(loaded_view(&store, library)),
    }
}

/// What one migration run did, in the shape the webview reads it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationView {
    /// "migrated" | "libraryExists" | "nothingToMigrate" | "refused"
    pub status: &'static str,
    /// Snapshots this run wrote.
    pub migrated: usize,
    /// Of those, the ones preserved without an Identity because they could not be decoded.
    pub raw_only: usize,
    /// Stored reads the library already held, so they were not added twice.
    pub already_present: usize,
    /// Array elements that were not stored reads at all.
    pub skipped: usize,
    /// Snapshot fields the old store never recorded.
    pub missing: Vec<&'static str>,
    /// Old-store keys this app has no home for.
    pub unmapped: Vec<String>,
    pub library: LibraryView,
}

/// Move the old webview store's saved reads into the library, once.
///
/// The webview reads its own `localStorage` and hands the parsed entries over;
/// this writes them into the library file only while that file does not exist, so
/// a restart cannot duplicate them and a failed run simply repeats on the next
/// launch. The old store is never cleared or marked, so nothing is lost if this
/// fails. See `library_migration` for the field-by-field mapping.
#[tauri::command]
fn library_migrate_legacy(
    app: AppHandle,
    entries: Vec<serde_json::Value>,
    now: String,
) -> Result<MigrationView, String> {
    let store = library_store(&app)?;
    match library_migration::migrate(&store, &entries, &now) {
        Ok(run) => Ok(MigrationView {
            status: run.status.as_str(),
            migrated: run.migrated,
            raw_only: run.raw_only,
            already_present: run.already_present,
            skipped: run.skipped,
            missing: run.missing,
            unmapped: run.unmapped,
            library: loaded_view(&store, run.library),
        }),
        // The file is not one this build may read, so it was left exactly as it
        // is. The view says so, as it does for every other library operation.
        Err(library_migration::MigrationError::Refused(problem)) => Ok(MigrationView {
            status: "refused",
            migrated: 0,
            raw_only: 0,
            already_present: 0,
            skipped: 0,
            missing: library_migration::MISSING_FIELDS.to_vec(),
            unmapped: Vec::new(),
            library: refused_view(&store, problem),
        }),
        Err(library_migration::MigrationError::Io(detail)) => Err(format!(
            "The saved reads from the old version could not be moved into the library. \
             They have not been changed. {detail}"
        )),
    }
}

/// Drafts, in their own shape. They live in the same file as the Snapshots but
/// are a separate collection, so the Drafts page never has to be told what a
/// Snapshot is and the library page never lists a Draft.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftsView {
    pub drafts: Vec<Draft>,
    /// Set when the file must not be written to; nothing may be saved until the
    /// user deals with it.
    pub problem: Option<ProblemView>,
    /// Set when an older library was lifted but the lift could not be written.
    /// The Drafts are here, whole, and saving is allowed.
    pub migration_warning: Option<String>,
}

fn drafts_view(library: Library) -> DraftsView {
    DraftsView {
        drafts: library.drafts,
        problem: None,
        migration_warning: None,
    }
}

/// The Drafts view for an open library: the same as a loaded one, plus whatever
/// the lift of an older file has to report.
fn opened_drafts_view(open: Open) -> DraftsView {
    match open {
        Open::Opened { library, migration } => DraftsView {
            migration_warning: migration.and_then(|lift| lift.message()),
            ..drafts_view(library)
        },
        Open::Refused(problem) => refused_drafts_view(problem),
    }
}

fn refused_drafts_view(problem: LibraryProblem) -> DraftsView {
    DraftsView {
        drafts: Vec::new(),
        problem: Some(problem.into()),
        migration_warning: None,
    }
}

/// Read the Drafts. Works with no Reader attached, which is the point of a
/// Draft: it is composed before any Tag is in hand.
///
/// Opening, not merely reading: whichever page the user reaches first, a file
/// written by an older schema is lifted and the lift written back here too.
#[tauri::command]
fn drafts_load(app: AppHandle) -> Result<DraftsView, String> {
    let store = library_store(&app)?;
    Ok(opened_drafts_view(store.open()))
}

/// Create an empty Draft. The id comes from the store, never from the UI.
#[tauri::command]
fn draft_create(app: AppHandle, name: String, updated_at: String) -> Result<DraftsView, String> {
    let store = library_store(&app)?;
    match change_library(&store, |library| {
        library.add_draft(&name, &updated_at);
    })? {
        Changed::Refused(problem) => Ok(refused_drafts_view(problem)),
        Changed::Done { library, .. } => Ok(drafts_view(library)),
    }
}

/// Replace one Draft whole: name and Records in the order given.
#[tauri::command]
fn draft_save(app: AppHandle, draft: Draft) -> Result<DraftsView, String> {
    let store = library_store(&app)?;
    match change_library(&store, |library| library.save_draft(draft))? {
        Changed::Refused(problem) => Ok(refused_drafts_view(problem)),
        Changed::Done { library, .. } => Ok(drafts_view(library)),
    }
}

/// Delete one Draft. The file is rewritten, so the delete survives a restart.
#[tauri::command]
fn draft_delete(app: AppHandle, id: String) -> Result<DraftsView, String> {
    let store = library_store(&app)?;
    match change_library(&store, |library| library.remove_draft(&id))? {
        Changed::Refused(problem) => Ok(refused_drafts_view(problem)),
        Changed::Done { library, .. } => Ok(drafts_view(library)),
    }
}

/// What the file dialog is being opened for.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum PickMode {
    /// Choose an existing file to read.
    Open,
    /// Choose where a file is to be written.
    Save,
}

/// Ask the user where to save a file the app is about to write.
///
/// Driven from Rust for the same reason `library_pick_file` is: the plugin's own
/// IPC commands are never invoked from the webview, so no capability permission
/// beyond the window's own is needed. `None` means the dialog was cancelled and
/// the caller must write nothing.
async fn ask_where_to_save(
    app: &AppHandle,
    title: &str,
    filter_name: &str,
    extensions: &[&str],
    suggested_name: Option<String>,
) -> Result<Option<String>, String> {
    // The dialog answers on the main thread, which is not allowed to block, so
    // the answer comes back through a channel this command awaits instead.
    let (tx, mut answer) = tauri::async_runtime::channel(1);
    let mut dialog = app
        .dialog()
        .file()
        .set_title(title)
        .add_filter(filter_name, extensions);
    if let Ok(downloads) = app.path().download_dir() {
        dialog = dialog.set_directory(downloads);
    }
    if let Some(name) = suggested_name {
        dialog = dialog.set_file_name(name);
    }
    dialog.save_file(move |chosen| {
        let _ = tx.try_send(chosen);
    });
    let chosen = answer
        .recv()
        .await
        .ok_or_else(|| "the file dialog closed without choosing anything".to_string())?;
    Ok(chosen
        .and_then(|file| file.into_path().ok())
        .map(|path| path.display().to_string()))
}

/// Ask the user for a file path with the system dialog.
///
/// `null` means the dialog was cancelled, and the caller must change nothing.
/// The dialog is driven from here rather than from the webview, so the plugin's
/// IPC commands are never invoked and no capability permission beyond the
/// window's own is needed for it.
#[tauri::command]
async fn library_pick_file(
    app: AppHandle,
    mode: PickMode,
    suggested_name: Option<String>,
) -> Result<Option<String>, String> {
    // The dialog answers on the main thread, which is not allowed to block, so
    // the answer comes back through a channel this command awaits instead.
    let (tx, mut answer) = tauri::async_runtime::channel(1);
    let mut dialog = app
        .dialog()
        .file()
        .set_title("PM4 Studio library")
        .add_filter("Library file", &["json"]);
    if let Ok(downloads) = app.path().download_dir() {
        dialog = dialog.set_directory(downloads);
    }
    match mode {
        PickMode::Save => {
            if let Some(name) = suggested_name {
                dialog = dialog.set_file_name(name);
            }
            dialog.save_file(move |chosen| {
                let _ = tx.try_send(chosen);
            });
        }
        PickMode::Open => dialog.pick_file(move |chosen| {
            let _ = tx.try_send(chosen);
        }),
    }
    let chosen = answer
        .recv()
        .await
        .ok_or_else(|| "the file dialog closed without choosing anything".to_string())?;
    Ok(chosen
        .and_then(|file| file.into_path().ok())
        .map(|path| path.display().to_string()))
}

/// What an export wrote, so the UI can say where it went and how much is in it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportView {
    pub path: String,
    pub snapshots: usize,
    pub drafts: usize,
}

/// Write the whole library to a file the user chose. The file is a library
/// file, so importing it back restores the library exactly.
#[tauri::command]
fn library_export(app: AppHandle, path: String) -> Result<ExportView, String> {
    let store = library_store(&app)?;
    let document = library_io::export(&store, Path::new(&path)).map_err(|e| e.message())?;
    Ok(ExportView {
        path,
        snapshots: document.library.snapshots.len(),
        drafts: document.draft_count(),
    })
}

/// Say what importing a file would add, without writing anything. Cancelling an
/// import is simply not calling the apply below.
#[tauri::command]
fn library_import_preview(app: AppHandle, path: String) -> Result<ImportPreview, String> {
    let store = library_store(&app)?;
    library_io::preview(&store, Path::new(&path)).map_err(|e: FileError| e.message())
}

/// What an import changed.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportView {
    pub preview: ImportPreview,
    pub library: LibraryView,
}

/// Merge a file the user chose into the library. Entries already here are kept,
/// so an import neither duplicates nor destroys anything.
#[tauri::command]
fn library_import_apply(app: AppHandle, path: String) -> Result<ImportView, String> {
    let store = library_store(&app)?;
    let (document, preview) =
        library_io::apply(&store, Path::new(&path)).map_err(|e: FileError| e.message())?;
    Ok(ImportView {
        preview,
        library: loaded_view(&store, document.library),
    })
}

pub fn run() {
    tauri::Builder::default()
        // Must be the first plugin registered. A second launch raises the
        // window that already owns the exclusive USB handle instead of opening
        // a second process that would fail with an opaque access error.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        // Registered for the file dialogs the library exports and imports with.
        // They are driven from Rust, so nothing here is reachable from the
        // webview and no additional capability permission is granted for it.
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            connect,
            disconnect,
            device_info,
            firmware_version,
            lf_poll,
            hf_poll,
            ntag_memory_read,
            ntag_records_read,
            memory_dump_export,
            beep,
            led_off,
            lf_identity_preview,
            lf_identity_preview_hex,
            lf_write,
            lf_clone_attempt,
            lf_clear,
            hf_ndef_preview,
            hf_ndef_write,
            hf_password_status,
            hf_password_set,
            hf_password_remove,
            hf_ndef_erase_preview,
            hf_ndef_erase,
            console_capability,
            raw_send,
            send_cmd,
            library_load,
            library_save_lf,
            library_save_hf,
            library_rename,
            library_edit,
            library_delete,
            library_migrate_legacy,
            drafts_load,
            draft_create,
            draft_save,
            draft_delete,
            library_export,
            library_import_preview,
            library_import_apply,
            library_pick_file,
            library_reveal,
            clear_all_saved_data
        ])
        .run(tauri::generate_context!())
        .expect("error while running PM4 Studio");
}

#[cfg(test)]
mod wire_tests {
    //! The two write views as the webview receives them.
    //!
    //! A refusal's cause travels as its own field rather than inside `message`,
    //! so a test that only ever reads the prose would not notice the field being
    //! renamed, dropped or defaulted to the wrong condition. These assertions are
    //! about the wire shape, which is the contract the TypeScript side switches
    //! on (`src/types.ts`).

    use super::*;

    fn write_result(outcome: &'static str, refusal_cause: Option<&'static str>) -> WriteResult {
        WriteResult {
            customer: 0x55,
            data32: 0x0084_8212,
            readback: None,
            outcome,
            verified: false,
            message: Some("the guard said no".to_string()),
            refusal_cause,
            confirmed_copies: None,
            count_problem: None,
        }
    }

    fn attempt_view(
        outcome: &'static str,
        refusal_cause: Option<&'static str>,
    ) -> BatchAttemptView {
        BatchAttemptView {
            customer: 0x55,
            data32: 0x0084_8212,
            outcome,
            message: None,
            refusal_cause,
            readback: None,
            confirmed_copies: None,
            count_problem: None,
        }
    }

    #[test]
    fn a_write_refusal_carries_its_cause_beside_the_message() {
        let json = serde_json::to_value(write_result("refused", Some("already-carries")))
            .expect("a write result serialises");
        assert_eq!(json["refusalCause"], "already-carries");
        assert_eq!(json["outcome"], "refused");
        assert_eq!(json["message"], "the guard said no");
    }

    #[test]
    fn a_write_that_was_transmitted_carries_a_null_cause() {
        let json = serde_json::to_value(write_result("unverified", None))
            .expect("a write result serialises");
        assert!(json["refusalCause"].is_null());
    }

    #[test]
    fn a_batch_skip_carries_the_same_identity_cause_it_was_judged_by() {
        // A skip is the guard's second condition, so it names it: the two
        // conditions have different fixes and must not arrive looking alike.
        let json =
            serde_json::to_value(attempt_view("skipped", Some("already-carries")))
                .expect("an attempt view serialises");
        assert_eq!(json["refusalCause"], "already-carries");
        assert_eq!(json["outcome"], "skipped");
    }

    #[test]
    fn an_unreadable_attempt_names_the_other_condition() {
        let json =
            serde_json::to_value(attempt_view("refused", Some("unreadable")))
                .expect("an attempt view serialises");
        assert_eq!(json["refusalCause"], "unreadable");
        assert_eq!(json["outcome"], "refused");
    }
}
