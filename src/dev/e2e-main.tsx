/**
 * The verification entry point: the app, with a fixture standing in for a Reader.
 *
 * `e2e.html` loads this file and nothing else. `index.html` — the only input a
 * production build has — loads `src/main.tsx`, which never mentions this one. The
 * separation is the structural half of the guarantee that a release bundle cannot
 * answer device calls from a fixture; `src/lib/deviceBoundary.ts` is the runtime
 * half.
 *
 * The install has to happen before the app renders, and a static `import` would
 * be hoisted above it, so the app is loaded dynamically after the boundary is
 * standing. That ordering is the whole file.
 */

import { installDeviceStub } from "./deviceStub";

/**
 * Whether this is a production build.
 *
 * `false` on the dev server, which is the only place this entry is ever served.
 * A production build that somehow included this file would set it to `true`, and
 * the stub would then refuse to install rather than answer anything — see
 * `installDeviceStub`.
 */
const PRODUCTION = import.meta.env.PROD;

installDeviceStub({ production: PRODUCTION });

void import("../main");
