//! Tauri command surface for PM4 Studio.

pub mod reader;

use reader::{DeviceInfo, Frame, HfCard, LfCard, Reader, REPORT_LEN};
use serde::Serialize;
use std::sync::Mutex;
use tauri::State;

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

/// One 125 kHz poll. `None` = no badge latched on this attempt.
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

#[derive(Serialize)]
pub struct WriteResult {
    pub customer: u8,
    pub data32: u32,
    /// What the tag reads after the write, when it could be re-read.
    pub readback: Option<LfCard>,
    pub verified: bool,
}

/// Write an EM4100 identity onto the blank 125 kHz tag currently on the reader.
#[tauri::command]
fn lf_write(
    state: State<'_, AppState>,
    customer: u8,
    data32: u32,
) -> Result<WriteResult, String> {
    with_reader(&state, |r| {
        let readback = r.lf_write_verified(customer, data32)?;
        let verified = readback
            .as_ref()
            .map(|c| c.customer == customer && c.data32 == data32)
            .unwrap_or(false);
        Ok(WriteResult {
            customer,
            data32,
            readback,
            verified,
        })
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

pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            connect,
            disconnect,
            device_info,
            lf_poll,
            hf_poll,
            beep,
            lf_write,
            raw_send,
            send_cmd
        ])
        .run(tauri::generate_context!())
        .expect("error while running PM4 Studio");
}
