import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { DraftsProvider } from "./components/DraftsProvider";
import "./index.css";

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
