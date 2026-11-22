import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { DraftsProvider } from "./components/DraftsProvider";
import { assertNoFixtureBackend } from "./lib/deviceBoundary";
import "./index.css";

// A shipped build must fail rather than answer device calls from a fixture. The
// verification entry (`e2e.html`) stands a fake backend at the IPC boundary and
// marks the window when it does; this is the check that refuses to render over
// that mark. It is a no-op in development, where the fixture belongs, and it
// throws — after leaving the reason on screen — in a production build.
//
// It runs before React so that a build which reached the stub cannot paint a
// single frame of an interface that looks like it works.
assertNoFixtureBackend({ production: import.meta.env.PROD });

// The Drafts queue and the window-close guard are mounted once, above the
// navigation, because they have to outlive the page that edits Drafts: the
// window can be closed from any page, and an edit made on one must still be on
// disk when it is.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <DraftsProvider>
      <App />
    </DraftsProvider>
  </React.StrictMode>,
);
