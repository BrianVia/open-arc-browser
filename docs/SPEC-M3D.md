# M3d Spec — uBlock Origin sideloading

Authority: docs/ARCHITECTURE.md. Context: MV3 ad blockers need
declarativeNetRequest, which Electron will never have. Full uBlock Origin
(MV2) blocks via chrome.webRequest, which Electron fully supports, but
Chrome Web Store no longer distributes MV2 — so the browser provisions it
itself from uBlock's official GitHub releases.

## Module: src/main/engine/sideload.ts

One exported function:

`ensureSideloadedExtensions(extensionsDir: string, deps?): Promise<void>`

- Target dir: `<extensionsDir>/ublock-origin/` (inside the existing
  per-profile extensions root). If `manifest.json` exists there → resolve
  immediately (no network).
- Otherwise: GET `https://api.github.com/repos/gorhill/uBlock/releases/latest`
  (global fetch), pick the asset whose name ends `.chromium.zip`, download
  to a temp file under app temp dir, extract with the system `unzip`
  binary via execFile (`unzip -o -q <zip> -d <tmpdir>`), then rename the
  extracted `uBlock0.chromium` folder to the target dir. Clean up temp
  files.
- ponytail: relying on system `unzip` is Linux-first with a known ceiling;
  comment it (upgrade path: a zip dependency when packaging for other
  platforms).
- Any failure (offline, no unzip, GitHub down): log one warning and
  resolve — startup must never block or crash on this. A later launch
  retries because the guard is just the manifest existing.
- Injectable deps for tests: fetch, execFile, fs ops — mirror the
  FileOperations pattern in src/main/state/store.ts.

## Wiring (EngineHost#sessionFor)

Chain it before the web-store init so the first-run download is picked up
by the same load pass:
`ensureSideloadedExtensions(root).then(() => installChromeWebStore(...))`
— keep the existing #extensionReady promise covering the whole chain.
loadUnpackedExtensions (chunk-1 loader) call stays as is.

## Tests (mocked network/exec/fs — no real downloads)

- Resolves without fetching when manifest already exists.
- Happy path: release JSON → picks *.chromium.zip asset → execFile called
  with unzip → extracted folder renamed to target.
- Failure path: fetch rejects → resolves anyway (warning logged), and the
  web-store chain still runs (engine test: #sessionFor still initializes).

## Constraints

- No new npm dependencies.
- typecheck/test/build green. No GUI, no git. Report files changed, pass
  counts, deviations.
