//! Tauri command surface for PM4 Studio.

pub mod identity;
pub mod library;
pub mod reader;
pub mod write_guard;
pub mod write_outcome;
#[cfg(test)]
mod test_frames;

use identity::Identity;
use library::{
    InsertOutcome, Library, LibraryProblem, LibraryStore, SaveError, Snapshot, WriteCountOutcome,
};
use reader::{DeviceInfo, Frame, HfCard, LfCard, LfWriteAttempt, Reader, REPORT_LEN};
use write_outcome::Evidence;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

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

#[tauri::command]
fn connect(state: State<'_, AppState>) -> Result<DeviceInfo, String> {
    let mut slot = state
        .reader
        .lock()
        .map_err(|_| "internal state lock poisoned".to_string())?;
    let r = Reader::open()?;
    let info = r.info.clone();
    r.wake().ok();
    *slot = Some(r);
    Ok(info)
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

#[tauri::command]
fn beep(state: State<'_, AppState>) -> Result<(), String> {
    with_reader(&state, |r| r.beep())
}

#[tauri::command]
fn led_off(state: State<'_, AppState>) -> Result<(), String> {
    with_reader(&state, |r| r.led_off())
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
    /// Confirmed copies of this Identity after the write, when a Snapshot in the
    /// library carries it. `None` means the library holds no such Snapshot.
    pub confirmed_copies: Option<u32>,
    /// Set when the count could not be written to the library file. The Tag was
    /// written either way, so this never fails the write.
    pub count_problem: Option<String>,
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

    let (evidence, message) = match &attempt {
        LfWriteAttempt::Refused(why) => (Evidence::Refused, Some(why.clone())),
        LfWriteAttempt::Failed(why) => (Evidence::NotTransmitted, Some(why.clone())),
        LfWriteAttempt::Transmitted(card) => (
            Evidence::Readback(card.as_ref().map(LfCard::identity)),
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

    // Record the count after the fact: the Tag is written either way, so a
    // library that cannot be written to is reported, never raised.
    let mut count_problem = None;
    let record = match library_store(&app) {
        Err(e) => {
            count_problem = Some(e);
            WriteCountOutcome::NoSnapshot
        }
        Ok(store) => match store.load() {
            Err(problem) => {
                count_problem = Some(problem.message());
                WriteCountOutcome::NoSnapshot
            }
            Ok(mut library) => {
                let record = library.record_write(&identity, outcome);
                if record.incremented() {
                    if let Err(e) = store.save(&library) {
                        count_problem = Some(match e {
                            SaveError::Refused(problem) => problem.message(),
                            SaveError::Io(detail) => {
                                format!("The library could not be saved: {detail}")
                            }
                        });
                    }
                }
                record
            }
        },
    };

    Ok(WriteResult {
        customer,
        data32,
        readback,
        outcome: outcome.as_str(),
        verified: outcome.counts_as_confirmed_copy(),
        message,
        // A count that failed to persist is not reported as if it had.
        confirmed_copies: match count_problem {
            None => record.confirmed_copies(),
            Some(_) => None,
        },
        count_problem,
    })
}

/// Send an arbitrary frame. Input is a hex string; the frame is zero-padded to
/// 64 bytes. Useful for probing commands that are not yet wrapped.
#[tauri::command]
fn raw_send(state: State<'_, AppState>, hex: String) -> Result<Option<RawResponse>, String> {
    let mut bytes = reader::parse_hex(&hex)?;
    if bytes.len() > REPORT_LEN {
        return Err(format!(
            "frame is {} bytes, maximum is {REPORT_LEN}",
            bytes.len()
        ));
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
}

fn frame_with_meta(f: &Frame) -> String {
    let mut s = format!("{:04X}  ", f.cmd);
    s.push_str(&reader::hex(&f.payload));
    s
}

/// Send a command by id with a hex payload, building a correctly checksummed
/// frame. Used by the diagnostics page so probe frames are never malformed.
#[tauri::command]
fn send_cmd(
    state: State<'_, AppState>,
    cmd: u16,
    payload: String,
) -> Result<Option<RawResponse>, String> {
    let bytes = reader::parse_hex(&payload)?;
    if bytes.len() > reader::REPORT_LEN - 7 {
        return Err(format!("payload is {} bytes, maximum is {}", bytes.len(), reader::REPORT_LEN - 7));
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
}

/// Where the library lives: the app data directory Tauri resolves from the
/// bundle identifier, never a hardcoded path, so a rename of the app moves the
/// library with it instead of losing it.
fn library_store(app: &AppHandle) -> Result<LibraryStore, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve the app data directory: {e}"))?;
    Ok(LibraryStore::new(dir.join("library.json")))
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
}

fn loaded_view(store: &LibraryStore, library: Library) -> LibraryView {
    LibraryView {
        path: store.path().display().to_string(),
        version: library.version,
        snapshots: library.snapshots,
        problem: None,
    }
}

fn refused_view(store: &LibraryStore, problem: LibraryProblem) -> LibraryView {
    LibraryView {
        path: store.path().display().to_string(),
        version: library::SCHEMA_VERSION,
        snapshots: Vec::new(),
        problem: Some(problem.into()),
    }
}

/// Load the library for writing, or the view that explains why it is read-only.
fn load_writable(store: &LibraryStore) -> Result<Library, LibraryView> {
    store.load().map_err(|problem| refused_view(store, problem))
}

fn commit(store: &LibraryStore, library: &Library) -> Result<(), String> {
    store.save(library).map_err(|e| match e {
        SaveError::Refused(problem) => problem.message(),
        SaveError::Io(detail) => format!("The library could not be saved: {detail}"),
    })
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
#[tauri::command]
fn library_load(app: AppHandle) -> Result<LibraryView, String> {
    let store = library_store(&app)?;
    Ok(match store.load() {
        Ok(library) => loaded_view(&store, library),
        Err(problem) => refused_view(&store, problem),
    })
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
    let mut library = match load_writable(&store) {
        Ok(library) => library,
        Err(refused) => {
            return Ok(SaveResult {
                outcome: "refused",
                library: refused,
                snapshot: None,
            })
        }
    };

    match library.add_lf(customer, data32, &raw, &captured_at) {
        InsertOutcome::Duplicate(existing) => Ok(SaveResult {
            outcome: "duplicate",
            library: loaded_view(&store, library),
            snapshot: Some(existing),
        }),
        InsertOutcome::Added(added) => {
            commit(&store, &library)?;
            Ok(SaveResult {
                outcome: "added",
                library: loaded_view(&store, library),
                snapshot: Some(added),
            })
        }
    }
}

/// Rename one Snapshot. The name is user copy, so it is only trimmed.
#[tauri::command]
fn library_rename(app: AppHandle, id: String, name: String) -> Result<LibraryView, String> {
    let store = library_store(&app)?;
    let mut library = match load_writable(&store) {
        Ok(library) => library,
        Err(refused) => return Ok(refused),
    };
    if library.rename(&id, &name) {
        commit(&store, &library)?;
    }
    Ok(loaded_view(&store, library))
}

/// Delete one Snapshot. Permanent, as the spec requires.
#[tauri::command]
fn library_delete(app: AppHandle, id: String) -> Result<LibraryView, String> {
    let store = library_store(&app)?;
    let mut library = match load_writable(&store) {
        Ok(library) => library,
        Err(refused) => return Ok(refused),
    };
    if library.remove(&id) {
        commit(&store, &library)?;
    }
    Ok(loaded_view(&store, library))
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
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            connect,
            disconnect,
            device_info,
            firmware_version,
            lf_poll,
            hf_poll,
            beep,
            led_off,
            lf_write,
            raw_send,
            send_cmd,
            library_load,
            library_save_lf,
            library_rename,
            library_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running PM4 Studio");
}
