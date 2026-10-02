# VSIX Inspector — Design

## Purpose

A VS Code extension that opens a `.vsix` file and reports what's actually
inside it: installed size breakdown, files a working `.vscodeignore` usually
excludes but which shipped anyway, `node_modules` directories that a bundler
(esbuild/webpack) should have inlined but didn't, and the declared license of
the extension and of any surviving dependencies.

Bloated VSIX packages are common and hard to diagnose from the marketplace
side alone; this tool lets a publisher (or a curious installer) point it at
any `.vsix` and get a concrete, file-level answer.

## Non-goals (v1)

- No SPDX validation or license-text scanning — declared `license` field only.
- No cross-referencing the bundle's `require()`/`import` graph to tell "truly
  unbundled dependency" apart from "incidentally copied folder" — presence of
  a `node_modules/` entry is itself the finding.
- No treemap/chart visualization — sorted tables are the v1 report format.
- No CLI — VS Code extension only. A CLI/core split can be extracted later if
  wanted; not built speculatively now.

## Package layout

```
vsix-inspector/
  src/
    extension.ts              — activation, command + webview wiring
    analyzer/
      zip.ts                  — open a vsix (path or Buffer), list entries, read entry contents
      manifest.ts             — parse extension/package.json + extension.vsixmanifest
      sizeReport.ts           — total size, top-N largest files, per-top-level-dir totals
      ignoreHeuristics.ts     — flag files a working .vscodeignore usually excludes
      nodeModules.ts          — group any node_modules/ survivors by package, with size + file count
      licenses.ts             — declared "license" field from root + each node_modules package.json
      report.ts               — combines the above into one VsixReport object
    webview/report.html.ts    — VsixReport -> plain HTML (no framework)
  test/analyzer/*.test.ts     — node:test, in-memory fixture zips built with yazl
  esbuild.js, tsconfig.json, package.json
```

The `analyzer/` modules take no dependency on the `vscode` API — they are
plain functions over buffers/paths, testable standalone with `node:test`.
`extension.ts` is the only module that touches the VS Code API.

## Commands & activation

- `vsixInspector.inspect` — contributed to the explorer context menu when
  `resourceExtname == .vsix`, and to the command palette (prompts a file
  picker when invoked with no file selected).
- `activationEvents: onCommand` only — no eager activation.

## Data flow

1. Command fires with a vsix `Uri`.
2. `analyzer/report.ts#buildReport(vsixPath)`:
   - opens the zip via `analyzer/zip.ts` (backed by `yauzl`, streaming —
     avoids loading a large vsix, e.g. a C/C++ toolchain extension with
     bundled native binaries, fully into memory),
   - reads entry metadata (path, compressed/uncompressed size) for every
     entry,
   - reads `extension/package.json` (and `extension.vsixmanifest` for
     publisher/displayName) via `analyzer/manifest.ts`,
   - feeds entries + manifest through `sizeReport`, `ignoreHeuristics`,
     `nodeModules`, `licenses`,
   - returns one plain, JSON-serializable `VsixReport`.
3. `extension.ts` opens/reveals a webview panel and sets its HTML to
   `renderReport(report)`.

## Report model

```ts
interface VsixReport {
  totalUncompressedSize: number;
  totalCompressedSize: number;
  fileCount: number;
  largestFiles: { path: string; size: number }[]; // top 20
  manifest: { name: string; version: string; publisher?: string; license?: string };
  ignoreFindings: { category: string; path: string; size: number }[];
  unbundledPackages: { name: string; path: string; fileCount: number; size: number }[];
  licenses: { name: string; license?: string }[]; // undefined = missing
}
```

### `ignoreHeuristics` categories (v1)

Each matched entry is reported with the category that matched it (first
match wins): test directories (`test/`, `tests/`, `__tests__/`), source maps
(`*.map`), stray TypeScript sources when a compiled `dist/`/`out/` exists in
the same package, extra markdown beyond `README*`/`CHANGELOG*`/`LICENSE*`,
VCS/editor cruft (`.git*`, `.DS_Store`, `.vscode/`), lockfiles
(`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`), and log files (`*.log`).

### `nodeModules` grouping

Any entry whose path contains a `node_modules/` segment is grouped by the
package name immediately following the last `node_modules/` (handling scoped
packages, `@scope/name`), summing file count and uncompressed size per
package.

### `licenses`

The root `extension/package.json`'s `license` field, plus the `license` field
of every package.json found under a `node_modules/<pkg>/package.json` path.
A missing or empty field is reported as `license: undefined` — a finding in
its own right, not silently dropped.

## Webview rendering

Plain HTML/CSS, no framework. A one-line summary banner (e.g. "12.4 MB
installed, 340 files, 3 unbundled packages, 2 missing licenses") followed by
four tables: Overview/largest files, Possible `.vscodeignore` misses,
Unbundled dependencies, Declared licenses. Entry paths and package names are
HTML-escaped before templating — a malicious vsix's filenames are untrusted
input rendered into a webview.

## Error handling

- Corrupt/non-zip file → caught, surfaced via `vscode.window.showErrorMessage`,
  no report built.
- Missing `extension/package.json` → report still builds; manifest fields are
  `undefined` rather than throwing.
- Entries with path-traversal segments (`../`, zip-slip) → skipped during
  extraction and surfaced as their own finding, rather than resolved against
  the filesystem. Mirrors openvsx server's `ArchiveUtil.isSafePath` guard.

## Testing & build

- `node:test` + `node:assert/strict` — no test framework dependency.
- Fixtures are built in-memory with `yazl` (dev dependency) in a `before()`
  hook per test file, fed directly to `zip.ts`'s Buffer-accepting reader —
  no binary fixture files checked into git.
- `esbuild` bundles `src/extension.ts` → `dist/extension.js` with `vscode`
  marked external, so the packaged extension itself ships zero unbundled
  `node_modules` entries.
- Runtime dependency: `yauzl` only. Dev dependencies: `yazl`, `typescript`,
  `esbuild`, `@types/vscode`, `@types/yauzl`, `@vscode/vsce` (for packaging
  the extension's own `.vsix`).
