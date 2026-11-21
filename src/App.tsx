import { useState } from "react";
import { FileText, Library as LibraryIcon, Nfc, Radio, Terminal, X } from "lucide-react";
import { Badge } from "./components/ui/Badge";
import { Button } from "./components/ui/Button";
import { Toggle } from "./components/ui/Toggle";
import { useBeep } from "./hooks/useBeep";
import { useLibrary } from "./hooks/useLibrary";
import { useReader } from "./hooks/useReader";
import {
  classifyDeviceFailure,
  deviceFailureNotice,
  formatFirmwareRevision,
} from "./lib/readerIdentity";
import { isMacOS, isTauri } from "./lib/platform";
import { HfPage } from "./pages/HfPage";
import { DraftsPage } from "./pages/DraftsPage";
import { LibraryPage } from "./pages/LibraryPage";
import { LfPage } from "./pages/LfPage";
import { ToolsPage } from "./pages/ToolsPage";

type Page = "lf" | "hf" | "drafts" | "library" | "tools";

const STATUS_COLOR = {
  idle: "#A1A1AA",
  connecting: "#FBBF24",
  connected: "#4ADE80",
  absent: "#A1A1AA",
  wedged: "#FBBF24",
  error: "#F87171",
} as const;

/** Left-rule tone per classified failure. Hardware faults carry the remedy. */
const NOTICE_TONE = {
  muted: { box: "border-border-hover bg-surface/50", title: "text-text" },
  warn: { box: "border-warn bg-warn/5", title: "text-warn" },
  error: { box: "border-err bg-err/5", title: "text-err" },
} as const;

const PAGES: {
  id: Page;
  label: string;
  title: string;
  subtitle: string;
  icon: typeof Nfc;
}[] = [
  {
    id: "lf",
    label: "125 kHz",
    title: "125 kHz",
    subtitle: "Badges, fobs and elevator tags. Read, clone and write EM4100.",
    icon: Nfc,
  },
  {
    id: "hf",
    label: "13.56 MHz",
    title: "13.56 MHz",
    subtitle: "ISO14443-A tags. Read the UID, the card type, and the raw memory.",
    icon: Radio,
  },
  {
    id: "drafts",
    label: "Drafts",
    title: "Drafts",
    subtitle: "NDEF messages you are composing. Not attached to any Tag.",
    icon: FileText,
  },
  {
    id: "library",
    label: "Library",
    title: "Library",
    subtitle: "Snapshots of every read, browsable with no Reader attached.",
    icon: LibraryIcon,
  },
  {
    id: "tools",
    label: "Tools",
    title: "Tools",
    subtitle: "Hardware probes and raw command frames.",
    icon: Terminal,
  },
];

export default function App() {
  const [page, setPage] = useState<Page>("lf");
  const reader = useReader();
  const library = useLibrary();
  const { beepOn, setBeepOn, chirp } = useBeep();

  const current = PAGES.find((p) => p.id === page) ?? PAGES[0];
  const connected = reader.connected;
  const failure = reader.error ? classifyDeviceFailure(reader.error) : "unknown";
  const notice = reader.error ? deviceFailureNotice(failure) : null;

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-canvas text-text select-none">
      {/* macOS "Overlay" title bar: in-flow strip the window can be dragged by.
          The bottom border closes the window frame under the traffic lights. */}
      {isTauri() && isMacOS() && (
        <div
          data-tauri-drag-region
          aria-hidden
          className="h-9 shrink-0 border-b border-border bg-canvas"
        />
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-56 shrink-0 flex-col border-r border-border">
          <div className="px-4 pb-4 pt-1">
            <p className="font-heading text-sm text-text">PM4 Studio</p>
            <p className="mt-0.5 text-[11px] leading-tight text-text-muted">
              NFC-PM4 reader
            </p>
          </div>

          <nav className="flex flex-col gap-0.5 px-2">
            {PAGES.map((p) => {
              const Icon = p.icon;
              const active = p.id === page;
              return (
                <button
                  key={p.id}
                  onClick={() => setPage(p.id)}
                  aria-current={active ? "page" : undefined}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                    active
                      ? "bg-surface-raised text-text"
                      : "text-text-muted hover:bg-surface hover:text-text"
                  }`}
                >
                  <Icon size={14} className={active ? "text-accent-muted" : ""} />
                  {p.label}
                </button>
              );
            })}
          </nav>

          <div className="mt-auto flex flex-col gap-3 border-t border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-[11px] text-text-muted">
                {reader.info ? reader.info.product : "no reader"}
              </span>
              <Badge label={reader.status} color={STATUS_COLOR[reader.status]} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase tracking-[0.12em] text-text-muted">
                Firmware
              </span>
              <span
                className="truncate font-mono text-[11px] text-text-muted"
                title="Firmware revision reported by the Reader"
              >
                {connected ? formatFirmwareRevision(reader.firmware) : "not connected"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-text-muted">Beep</span>
              <Toggle
                checked={beepOn}
                onChange={setBeepOn}
                label="Beep on read and write"
                disabled={!connected}
              />
            </div>
            <Button variant="secondary" className="w-full" onClick={() => void reader.connect()}>
              {connected ? "Reconnect" : "Connect"}
            </Button>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto overscroll-contain px-8 py-6">
            <div className="mx-auto flex max-w-3xl flex-col gap-6">
              <header className="flex flex-col gap-1">
                <h1 className="font-heading text-xl text-text">{current.title}</h1>
                <p className="text-sm text-text-muted">{current.subtitle}</p>
              </header>

              {reader.error && notice && (
                <div
                  className={`flex items-start justify-between gap-3 border-l-2 px-3 py-2 ${NOTICE_TONE[notice.tone].box}`}
                >
                  <div className="min-w-0">
                    {failure === "unknown" ? (
                      <p className="text-sm text-err">{reader.error}</p>
                    ) : (
                      <>
                        <p className={`text-sm ${NOTICE_TONE[notice.tone].title}`}>
                          {notice.title}
                        </p>
                        <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
                          {notice.detail}
                        </p>
                        <p className="mt-1 select-text break-all font-mono text-[11px] text-text-muted">
                          {reader.error}
                        </p>
                      </>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {failure !== "unknown" && (
                      <Button
                        variant="ghost"
                        className="text-xs"
                        onClick={() => void reader.connect()}
                      >
                        Reconnect
                      </Button>
                    )}
                    <button
                      aria-label="Dismiss"
                      onClick={() => reader.setError(null)}
                      className="cursor-pointer opacity-70 transition-opacity hover:opacity-100"
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>
              )}

              {page === "lf" && (
                <LfPage
                  connected={connected}
                  onChirp={chirp}
                  library={library}
                  onDeviceError={reader.setError}
                />
              )}
              {page === "hf" && (
                <HfPage
                  connected={connected}
                  onPoll={reader.pollHfOnce}
                  onChirp={chirp}
                />
              )}
              {page === "drafts" && <DraftsPage connected={connected} />}
              {page === "library" && (
                <LibraryPage connected={connected} library={library} onChirp={chirp} />
              )}
              {page === "tools" && <ToolsPage connected={connected} />}

              <footer className="border-t border-border pt-4 text-[11px] leading-relaxed text-text-muted">
                Protocol reverse-engineered from USB captures. Credits:{" "}
                <a
                  href="https://github.com/vicrodh/cyb-nfc"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent-muted hover:underline"
                >
                  vicrodh/cyb-nfc
                </a>{" "}
                and{" "}
                <a
                  href="https://github.com/journeyman846/nfcx-tool"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent-muted hover:underline"
                >
                  journeyman846/nfcx-tool
                </a>
                . Not PC/SC, not CCID.
              </footer>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
