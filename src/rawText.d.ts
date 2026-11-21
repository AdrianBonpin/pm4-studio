/**
 * `import text from "./file.toml?raw"` — Vite hands the file back as a string.
 *
 * One test needs a manifest that is not JSON: `src-tauri/Cargo.toml` carries the
 * Rust crate's version in TOML, and the only way to read it without a TOML
 * parser (and without a Node-only `fs` import in a jsdom-capable `src/`) is the
 * `?raw` suffix Vite already supports. Declared here so `tsc --noEmit` knows the
 * module exists.
 */
declare module "*?raw" {
  const content: string;
  export default content;
}
