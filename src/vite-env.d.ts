/**
 * What Vite hands a module as `import.meta.env`.
 *
 * The project does not pull in `vite/client` for this, because it needs three
 * fields rather than the whole surface: which build is running, and (for the
 * verification entry) the mode. `PROD` is what makes the guarantee in
 * `src/lib/deviceBoundary.ts` and `src/dev/deviceStub.ts` a compile-time fact
 * rather than a runtime hope — Vite substitutes the literal, so a production
 * bundle carries `true` and a development one `false`.
 */
interface ImportMetaEnv {
  /** True in a production build. */
  readonly PROD: boolean;
  /** True on the dev server and in tests. */
  readonly DEV: boolean;
  /** `development` or `production`. */
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
