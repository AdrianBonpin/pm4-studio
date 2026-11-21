import { useEffect, useRef, useState } from "react";
import { Library as LibraryIcon, Nfc, Radio, Settings as SettingsIcon, Terminal } from "lucide-react";
import { Badge, type BadgeTone } from "./components/ui/Badge";
import { Button } from "./components/ui/Button";
import { ToastViewport } from "./components/ToastViewport";
import { useBeep } from "./hooks/useBeep";
import { useLibrary } from "./hooks/useLibrary";
import { useReader, type Status } from "./hooks/useReader";
import { outcomes, report } from "./lib/outcome";
import { formatFirmwareRevision } from "./lib/readerIdentity";
import { isMacOS, isTauri } from "./lib/platform";
import { PAGES, type PageId } from "./lib/pageCopy";
import { HfPage } from "./pages/HfPage";
import { LibraryPage } from "./pages/LibraryPage";
import { LfPage } from "./pages/LfPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ToolsPage } from "./pages/ToolsPage";

/**
 * Tone per Reader status, in the design system's own vocabulary.
 *
 * A tone, not a colour: the tokens in `src/index.css` are the only place a hue
 * is defined, so a status badge cannot drift away from the theme.
 */
const STATUS_TONE: Record<Status, BadgeTone> = {
  idle: "muted",
  connecting: "warn",
  connected: "ok",
  absent: "muted",
  wedged: "warn",
  error: "err",
};

/** The sidebar icon per destination. The words are in `lib/pageCopy`. */
const PAGE_ICON: Record<PageId, typeof Nfc> = {
  lf: Nfc,
  hf: Radio,
  library: LibraryIcon,
  tools: Terminal,
  settings: SettingsIcon,
};

/**
 * The shell.
 *
 * The sidebar is navigation and connection, and nothing else: five destinations
 * above, the Reader's identity, status, firmware and Connect below. The beep
 * preference used to sit down there, disabled whenever the Reader was unplugged,
 * for a value stored on this machine and unrelated to the hardware; it is in
 * Settings → Feedback now, where it is available with nothing plugged in.
 *
 * The destination is the shell's own state, so leaving one for another and coming
 * back returns to the one you left — within a session, which is what it promises.
 * It is deliberately not persisted across launches: an app that opens where you
 * last were is a different decision, and this one is not made here.
 *
 * The credits that used to close every page are gone from the page flow. They are
 * a fact about the project, so they are stated once in Settings → About.
 */
export default function App() {
  const [page, setPage] = useState<PageId>("lf");
  const reader = useReader();
  const library = useLibrary();
  const { quietLevel, setQuietLevel, chirp } = useBeep();

  const current = PAGES.find((p) => p.id === page) ?? PAGES[0];
  const connected = reader.connected;

  // The device-failure strip that used to sit at the top of the content column is
  // gone. The same news now arrives as a message in the corner the user chose,
  // carrying the two controls the strip carried: a reconnect and a dismiss.
  //
  // Reported once per distinct failure rather than once per render, so a re-render
  // (or React's development double-invoke) cannot duplicate it. Dismissing the
  // message clears the error behind it, which is what "dismiss" meant on the
  // strip, and leaves the next identical failure free to be reported again.
  const reportedFailure = useRef<string | null>(null);
  useEffect(() => {
    if (!reader.error) {
      reportedFailure.current = null;
      return;
    }
    if (reportedFailure.current === reader.error) return;
    reportedFailure.current = reader.error;
    report(
      outcomes.readerFailure(reader.error, {
        action: { label: "Reconnect", run: () => void reader.connect() },
        onDismiss: () => reader.setError(null),
      }),
    );
  }, [reader.error, reader.connect, reader.setError]);

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

          <nav aria-label="Destinations" className="flex flex-col gap-0.5 px-2">
            {PAGES.map((p) => {
              const Icon = PAGE_ICON[p.id];
              const active = p.id === page;
              return (
                <button
                  key={p.id}
                  onClick={() => setPage(p.id)}
                  aria-current={active ? "page" : undefined}
                  className={`flex cursor-pointer items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
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
              <Badge label={reader.status} tone={STATUS_TONE[reader.status]} />
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

              {page === "lf" && (
                <LfPage
                  connected={connected}
                  onChirp={chirp}
                  library={library}
                  onDeviceError={reader.setError}
                />
              )}
              {page === "hf" && (
                <HfPage connected={connected} onPoll={reader.pollHfOnce} library={library} />
              )}
              {page === "library" && (
                <LibraryPage connected={connected} library={library} onChirp={chirp} />
              )}
              {page === "tools" && <ToolsPage connected={connected} />}
              {page === "settings" && (
                <SettingsPage
                  reader={{ connected, info: reader.info, firmware: reader.firmware }}
                  quietLevel={quietLevel}
                  onQuietLevelChange={setQuietLevel}
                  library={library}
                />
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Outside the page flow, so a message never moves the content under it. */}
      <ToastViewport />
    </div>
  );
}
