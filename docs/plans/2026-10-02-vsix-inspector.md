# VSIX Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VS Code extension that inspects a `.vsix` file and reports installed size breakdown, likely `.vscodeignore` misses, unbundled `node_modules` survivors, and declared licenses, shown in a webview.

**Architecture:** A pure, `vscode`-free `analyzer/` module pipeline (zip reading → manifest parsing → size/ignore/node_modules/license analysis → one combined report object), rendered into a hand-rolled HTML webview by `extension.ts`, the only module that touches the VS Code API.

**Tech Stack:** TypeScript, Node.js (>=20), `yauzl` (zip reading, runtime dep), `yazl` (test fixtures, dev dep), `esbuild` (bundling), `node:test` + `node:assert/strict` (testing, no framework dependency), `@vscode/vsce` (packaging).

**Spec:** `docs/specs/2026-10-02-vsix-inspector-design.md`

## Global Constraints

- Runtime dependency is `yauzl` only — no other runtime dependencies.
- No SPDX validation, no license-text scanning, no bundle-graph cross-referencing, no treemap/chart UI, no CLI — all out of scope for this plan (see spec Non-goals).
- Tests use `node:test` + `node:assert/strict` only — no Jest/Mocha/Vitest.
- Test fixtures are built in-memory with `yazl` inside each test file — no binary `.vsix`/`.zip` fixtures checked into git.
- `esbuild` bundles `src/extension.ts` → `dist/extension.js` with `vscode` marked external, so the packaged extension itself ships zero unbundled `node_modules` entries.
- All entry paths and package names must be HTML-escaped before being templated into the webview — a `.vsix`'s file names are untrusted input.
- Zip entries with path-traversal segments (`../`, zip-slip) are skipped during extraction and surfaced as their own finding, never resolved against the filesystem.
- `analyzer/*` modules take no dependency on the `vscode` API.

---

## File Structure

```
vsix-inspector/
  package.json, tsconfig.json, esbuild.js, .gitignore, .vscodeignore, README.md
  src/
    extension.ts
    analyzer/
      zip.ts
      manifest.ts
      sizeReport.ts
      ignoreHeuristics.ts
      nodeModules.ts
      licenses.ts
      report.ts
    webview/
      report.html.ts
  test/
    helpers/buildZip.ts
    analyzer/{zip,manifest,sizeReport,ignoreHeuristics,nodeModules,licenses,report}.test.ts
    webview/report.html.test.ts
```

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `esbuild.js`
- Create: `.gitignore`
- Create: `src/extension.ts`

**Interfaces:**
- Produces: `activate(context: vscode.ExtensionContext): void` and `deactivate(): void` in `src/extension.ts` (stub, filled in by Task 10). Produces the `npm run build`, `npm run typecheck`, and `npm test` scripts every later task relies on.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "vsix-inspector",
  "displayName": "VSIX Inspector",
  "description": "Inspect a .vsix file: bundle size breakdown, .vscodeignore misses, unbundled node_modules, and declared licenses.",
  "version": "0.0.1",
  "publisher": "TinyGearsOrg",
  "license": "Apache-2.0",
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": ["Other"],
  "activationEvents": [],
  "main": "./dist/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "vsixInspector.inspect",
        "title": "Inspect VSIX"
      }
    ],
    "menus": {
      "explorer/context": [
        {
          "command": "vsixInspector.inspect",
          "when": "resourceExtname == .vsix"
        }
      ]
    }
  },
  "scripts": {
    "build": "node esbuild.js",
    "watch": "node esbuild.js --watch",
    "typecheck": "tsc --noEmit",
    "pretest": "tsc -p tsconfig.json",
    "test": "node --test $(find out/test -name '*.test.js')",
    "package": "vsce package"
  },
  "dependencies": {
    "yauzl": "^2.10.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/vscode": "^1.85.0",
    "@types/yauzl": "^2.10.3",
    "@types/yazl": "^2.5.5",
    "@vscode/vsce": "^2.26.0",
    "esbuild": "^0.21.0",
    "typescript": "^5.4.0",
    "yazl": "^2.5.1"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "strict": true,
    "outDir": "out",
    "rootDir": ".",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"],
  "exclude": ["node_modules", "dist", "out"]
}
```

- [ ] **Step 3: Create `esbuild.js`**

```js
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    sourcemap: true,
    minify: !watch,
  });

  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
out/
*.vsix
```

- [ ] **Step 5: Create `src/extension.ts` stub**

```ts
import * as vscode from 'vscode';

export function activate(_context: vscode.ExtensionContext): void {
  // Command registration added in Task 10.
}

export function deactivate(): void {}
```

- [ ] **Step 6: Install dependencies and verify the build**

Run: `npm install && npm run typecheck && npm run build`
Expected: no errors; `dist/extension.js` is created.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json esbuild.js .gitignore src/extension.ts package-lock.json
git commit -m "chore: scaffold extension project"
```

---

### Task 2: Zip reading (`analyzer/zip.ts`)

**Files:**
- Create: `src/analyzer/zip.ts`
- Create: `test/helpers/buildZip.ts`
- Test: `test/analyzer/zip.test.ts`

**Interfaces:**
- Produces: `interface VsixEntry { path: string; compressedSize: number; uncompressedSize: number }`
- Produces: `interface VsixArchive { entries: VsixEntry[]; unsafeEntries: string[]; readEntry(path: string): Promise<Buffer> }`
- Produces: `function openVsix(source: string | Buffer): Promise<VsixArchive>`
- Produces (test helper, reused by every later test task): `function buildZipBuffer(files: { path: string; content: string }[]): Promise<Buffer>` in `test/helpers/buildZip.ts`
- Produces (test helper, reused by Task 8): `function injectRawPath(zipBuffer: Buffer, placeholderPath: string, rawPath: string): Buffer` in `test/helpers/buildZip.ts` — works around `yazl` rejecting `..` paths at write time by swapping in the real (unsafe) path's bytes after the archive is built; `placeholderPath` and `rawPath` must be equal length.

- [ ] **Step 1: Write the test fixture helper**

```ts
// test/helpers/buildZip.ts
import * as yazl from 'yazl';

export interface FixtureFile {
  path: string;
  content: string;
}

export function buildZipBuffer(files: FixtureFile[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zipfile = new yazl.ZipFile();
    for (const file of files) {
      zipfile.addBuffer(Buffer.from(file.content, 'utf8'), file.path);
    }
    const chunks: Buffer[] = [];
    zipfile.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    zipfile.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zipfile.outputStream.on('error', reject);
    zipfile.end();
  });
}

// yazl's addBuffer() rejects any path containing ".." before it ever reaches
// the archive, so a path-traversal fixture can't be built through the public
// API. Build it with a same-length placeholder path instead, then overwrite
// the raw bytes after the fact — the file name length field doesn't change,
// so no other offset in the archive shifts.
export function injectRawPath(zipBuffer: Buffer, placeholderPath: string, rawPath: string): Buffer {
  if (placeholderPath.length !== rawPath.length) {
    throw new Error('placeholderPath and rawPath must be the same length');
  }
  const result = Buffer.from(zipBuffer);
  const placeholderBytes = Buffer.from(placeholderPath, 'utf8');
  const rawBytes = Buffer.from(rawPath, 'utf8');
  let index = result.indexOf(placeholderBytes);
  while (index !== -1) {
    rawBytes.copy(result, index);
    index = result.indexOf(placeholderBytes, index + placeholderBytes.length);
  }
  return result;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// test/analyzer/zip.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildZipBuffer, injectRawPath } from '../helpers/buildZip';
import { openVsix } from '../../src/analyzer/zip';

const UNSAFE_PATH = '../evil.txt';
const UNSAFE_PATH_PLACEHOLDER = 'x'.repeat(UNSAFE_PATH.length); // same byte length, valid as written

test('lists safe entries with sizes and skips unsafe paths', async () => {
  const rawBuffer = await buildZipBuffer([
    { path: 'extension/package.json', content: '{"name":"demo"}' },
    { path: UNSAFE_PATH_PLACEHOLDER, content: 'escape attempt' },
  ]);
  const buffer = injectRawPath(rawBuffer, UNSAFE_PATH_PLACEHOLDER, UNSAFE_PATH);

  const archive = await openVsix(buffer);

  assert.equal(archive.entries.length, 1);
  assert.equal(archive.entries[0]?.path, 'extension/package.json');
  assert.equal(archive.entries[0]?.uncompressedSize, Buffer.byteLength('{"name":"demo"}'));
  assert.deepEqual(archive.unsafeEntries, [UNSAFE_PATH]);
});

test('reads entry content by path', async () => {
  const buffer = await buildZipBuffer([
    { path: 'extension/package.json', content: '{"name":"demo"}' },
  ]);

  const archive = await openVsix(buffer);
  const content = await archive.readEntry('extension/package.json');

  assert.equal(content.toString('utf8'), '{"name":"demo"}');
});

test('rejects reading a path that does not exist', async () => {
  const buffer = await buildZipBuffer([{ path: 'a.txt', content: 'x' }]);
  const archive = await openVsix(buffer);

  await assert.rejects(() => archive.readEntry('missing.txt'));
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx tsc -p tsconfig.json && node --test out/test/analyzer/zip.test.js`
Expected: FAIL — `Cannot find module '../../src/analyzer/zip'` (tsc compile error, since `src/analyzer/zip.ts` doesn't exist yet).

- [ ] **Step 4: Implement `src/analyzer/zip.ts`**

yauzl's default filename validation doesn't just reject a single bad entry —
on any path-traversal (`..`) filename it emits `error` and aborts the entire
read, so `end` never fires and nothing after that entry is seen either. That
contradicts the requirement below (skip just the unsafe entry, keep
analyzing the rest of the archive), so this implementation opens with
`decodeStrings: false` to bypass yauzl's built-in validation entirely and
decodes/validates filenames itself instead.

```ts
import * as yauzl from 'yauzl';

export interface VsixEntry {
  path: string;
  compressedSize: number;
  uncompressedSize: number;
}

export interface VsixArchive {
  entries: VsixEntry[];
  unsafeEntries: string[];
  readEntry(path: string): Promise<Buffer>;
}

function isSafePath(entryPath: string): boolean {
  if (entryPath.startsWith('/') || entryPath.startsWith('\\')) {
    return false;
  }
  return !entryPath.split(/[/\\]/).includes('..');
}

// @types/yauzl types entry.fileName as always `string`, but with
// decodeStrings:false (required above) yauzl hands back the raw bytes as a
// Buffer instead - hence the cast. The backslash normalization mirrors what
// yauzl itself would do with decodeStrings:true and strictFileNames:false.
function decodeEntryPath(entry: yauzl.Entry): string {
  const raw = entry.fileName as unknown as Buffer;
  return raw.toString('utf8').replace(/\\/g, '/');
}

export function openVsix(source: string | Buffer): Promise<VsixArchive> {
  return new Promise((resolve, reject) => {
    const onZipFile = (err: Error | null | undefined, zipfile?: yauzl.ZipFile) => {
      if (err || !zipfile) {
        reject(err ?? new Error('Failed to open vsix'));
        return;
      }

      const entries: VsixEntry[] = [];
      const unsafeEntries: string[] = [];
      const entriesByPath = new Map<string, yauzl.Entry>();

      zipfile.readEntry();
      zipfile.on('entry', (entry: yauzl.Entry) => {
        const entryPath = decodeEntryPath(entry);
        if (!entryPath.endsWith('/')) {
          if (isSafePath(entryPath)) {
            entries.push({
              path: entryPath,
              compressedSize: entry.compressedSize,
              uncompressedSize: entry.uncompressedSize,
            });
            entriesByPath.set(entryPath, entry);
          } else {
            unsafeEntries.push(entryPath);
          }
        }
        zipfile.readEntry();
      });

      zipfile.on('end', () => {
        resolve({
          entries,
          unsafeEntries,
          readEntry: (entryPath: string) =>
            new Promise<Buffer>((resolveRead, rejectRead) => {
              const entry = entriesByPath.get(entryPath);
              if (!entry) {
                rejectRead(new Error(`Entry not found: ${entryPath}`));
                return;
              }
              zipfile.openReadStream(entry, (streamErr, stream) => {
                if (streamErr || !stream) {
                  rejectRead(streamErr ?? new Error(`Failed to read entry: ${entryPath}`));
                  return;
                }
                const chunks: Buffer[] = [];
                stream.on('data', (chunk: Buffer) => chunks.push(chunk));
                stream.on('end', () => resolveRead(Buffer.concat(chunks)));
                stream.on('error', rejectRead);
              });
            }),
        });
      });

      zipfile.on('error', reject);
    };

    const options: yauzl.Options = { lazyEntries: true, decodeStrings: false };
    if (Buffer.isBuffer(source)) {
      yauzl.fromBuffer(source, options, onZipFile);
    } else {
      yauzl.open(source, options, onZipFile);
    }
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsc -p tsconfig.json && node --test out/test/analyzer/zip.test.js`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/analyzer/zip.ts test/helpers/buildZip.ts test/analyzer/zip.test.ts
git commit -m "feat: add vsix zip reader with zip-slip guard"
```

---

### Task 3: Manifest parsing (`analyzer/manifest.ts`)

**Files:**
- Create: `src/analyzer/manifest.ts`
- Test: `test/analyzer/manifest.test.ts`

**Interfaces:**
- Consumes: nothing (pure function over a `Buffer`)
- Produces: `interface VsixManifest { name?: string; version?: string; publisher?: string; license?: string }`
- Produces: `function parseManifest(packageJsonBuffer: Buffer | undefined): VsixManifest`

Note: the extension's own `extension/package.json` already carries `name`, `version`, `publisher`, and `license` (vsce requires a `publisher` field to package an extension), so parsing `extension.vsixmanifest` as well is unnecessary for these four fields — dropped from scope accordingly.

- [ ] **Step 1: Write the failing test**

```ts
// test/analyzer/manifest.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseManifest } from '../../src/analyzer/manifest';

test('parses name, version, publisher, and license', () => {
  const buffer = Buffer.from(
    JSON.stringify({ name: 'demo', version: '1.2.3', publisher: 'acme', license: 'MIT' }),
  );

  assert.deepEqual(parseManifest(buffer), {
    name: 'demo',
    version: '1.2.3',
    publisher: 'acme',
    license: 'MIT',
  });
});

test('treats an empty license string as missing', () => {
  const buffer = Buffer.from(JSON.stringify({ name: 'demo', license: '' }));
  assert.equal(parseManifest(buffer).license, undefined);
});

test('returns an empty object for invalid JSON', () => {
  assert.deepEqual(parseManifest(Buffer.from('not json')), {});
});

test('returns an empty object when no buffer is given', () => {
  assert.deepEqual(parseManifest(undefined), {});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -p tsconfig.json && node --test out/test/analyzer/manifest.test.js`
Expected: FAIL — compile error, `src/analyzer/manifest.ts` does not exist.

- [ ] **Step 3: Implement `src/analyzer/manifest.ts`**

```ts
export interface VsixManifest {
  name?: string;
  version?: string;
  publisher?: string;
  license?: string;
}

export function parseManifest(packageJsonBuffer: Buffer | undefined): VsixManifest {
  if (!packageJsonBuffer) {
    return {};
  }

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(packageJsonBuffer.toString('utf8'));
  } catch {
    return {};
  }

  const asString = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined;

  return {
    name: asString(pkg.name),
    version: asString(pkg.version),
    publisher: asString(pkg.publisher),
    license: asString(pkg.license),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsc -p tsconfig.json && node --test out/test/analyzer/manifest.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/analyzer/manifest.ts test/analyzer/manifest.test.ts
git commit -m "feat: parse extension manifest fields"
```

---

### Task 4: Size report (`analyzer/sizeReport.ts`)

**Files:**
- Create: `src/analyzer/sizeReport.ts`
- Test: `test/analyzer/sizeReport.test.ts`

**Interfaces:**
- Consumes: `VsixEntry` from `src/analyzer/zip.ts` (Task 2)
- Produces: `interface SizeReport { totalUncompressedSize: number; totalCompressedSize: number; fileCount: number; largestFiles: { path: string; size: number }[] }`
- Produces: `function buildSizeReport(entries: VsixEntry[], topN?: number): SizeReport` (default `topN = 20`)

- [ ] **Step 1: Write the failing test**

```ts
// test/analyzer/sizeReport.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSizeReport } from '../../src/analyzer/sizeReport';
import type { VsixEntry } from '../../src/analyzer/zip';

function entry(path: string, size: number): VsixEntry {
  return { path, uncompressedSize: size, compressedSize: Math.ceil(size / 2) };
}

test('totals sizes and file count across all entries', () => {
  const report = buildSizeReport([entry('a.js', 100), entry('b.js', 50)]);
  assert.equal(report.totalUncompressedSize, 150);
  assert.equal(report.totalCompressedSize, 50 + 25);
  assert.equal(report.fileCount, 2);
});

test('returns the top N largest files sorted descending', () => {
  const entries = [entry('small.js', 10), entry('big.js', 1000), entry('medium.js', 100)];
  const report = buildSizeReport(entries, 2);

  assert.deepEqual(report.largestFiles, [
    { path: 'big.js', size: 1000 },
    { path: 'medium.js', size: 100 },
  ]);
});

test('defaults to top 20 largest files', () => {
  const entries = Array.from({ length: 25 }, (_, i) => entry(`file-${i}.js`, i));
  const report = buildSizeReport(entries);
  assert.equal(report.largestFiles.length, 20);
  assert.equal(report.largestFiles[0]?.path, 'file-24.js');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -p tsconfig.json && node --test out/test/analyzer/sizeReport.test.js`
Expected: FAIL — compile error, module does not exist.

- [ ] **Step 3: Implement `src/analyzer/sizeReport.ts`**

```ts
import type { VsixEntry } from './zip';

export interface SizeReport {
  totalUncompressedSize: number;
  totalCompressedSize: number;
  fileCount: number;
  largestFiles: { path: string; size: number }[];
}

export function buildSizeReport(entries: VsixEntry[], topN = 20): SizeReport {
  let totalUncompressedSize = 0;
  let totalCompressedSize = 0;

  for (const entry of entries) {
    totalUncompressedSize += entry.uncompressedSize;
    totalCompressedSize += entry.compressedSize;
  }

  const largestFiles = [...entries]
    .sort((a, b) => b.uncompressedSize - a.uncompressedSize)
    .slice(0, topN)
    .map((entry) => ({ path: entry.path, size: entry.uncompressedSize }));

  return {
    totalUncompressedSize,
    totalCompressedSize,
    fileCount: entries.length,
    largestFiles,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsc -p tsconfig.json && node --test out/test/analyzer/sizeReport.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/analyzer/sizeReport.ts test/analyzer/sizeReport.test.ts
git commit -m "feat: compute vsix size totals and largest files"
```

---

### Task 5: Ignore heuristics (`analyzer/ignoreHeuristics.ts`)

**Files:**
- Create: `src/analyzer/ignoreHeuristics.ts`
- Test: `test/analyzer/ignoreHeuristics.test.ts`

**Interfaces:**
- Consumes: `VsixEntry` from `src/analyzer/zip.ts` (Task 2)
- Produces: `interface IgnoreFinding { category: string; path: string; size: number }`
- Produces: `function findIgnoreFindings(entries: VsixEntry[]): IgnoreFinding[]`
- Categories produced: `'test-files' | 'source-maps' | 'stray-typescript-source' | 'log-files' | 'vcs-editor-cruft' | 'lockfile' | 'extra-markdown'`

- [ ] **Step 1: Write the failing test**

```ts
// test/analyzer/ignoreHeuristics.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findIgnoreFindings } from '../../src/analyzer/ignoreHeuristics';
import type { VsixEntry } from '../../src/analyzer/zip';

function entry(path: string, size = 10): VsixEntry {
  return { path, uncompressedSize: size, compressedSize: size };
}

function categoriesFor(entries: VsixEntry[]): Record<string, string> {
  const findings = findIgnoreFindings(entries);
  return Object.fromEntries(findings.map((f) => [f.path, f.category]));
}

test('flags test directories, source maps, logs, vcs/editor cruft, and lockfiles', () => {
  const entries = [
    entry('extension/test/sample.test.js'),
    entry('extension/dist/main.js.map'),
    entry('extension/debug.log'),
    entry('extension/.git/HEAD'),
    entry('extension/.DS_Store'),
    entry('extension/yarn.lock'),
  ];

  const categories = categoriesFor(entries);
  assert.equal(categories['extension/test/sample.test.js'], 'test-files');
  assert.equal(categories['extension/dist/main.js.map'], 'source-maps');
  assert.equal(categories['extension/debug.log'], 'log-files');
  assert.equal(categories['extension/.git/HEAD'], 'vcs-editor-cruft');
  assert.equal(categories['extension/.DS_Store'], 'vcs-editor-cruft');
  assert.equal(categories['extension/yarn.lock'], 'lockfile');
});

test('flags stray TypeScript sources only when compiled output exists alongside them', () => {
  const withOutput = [entry('extension/src/main.ts'), entry('extension/dist/main.js')];
  assert.equal(categoriesFor(withOutput)['extension/src/main.ts'], 'stray-typescript-source');

  const withoutOutput = [entry('extension/src/main.ts')];
  assert.equal(categoriesFor(withoutOutput)['extension/src/main.ts'], undefined);
});

test('flags extra markdown but keeps README/CHANGELOG/LICENSE', () => {
  const entries = [
    entry('extension/README.md'),
    entry('extension/CHANGELOG.md'),
    entry('extension/LICENSE.md'),
    entry('extension/NOTES.md'),
  ];

  const categories = categoriesFor(entries);
  assert.equal(categories['extension/README.md'], undefined);
  assert.equal(categories['extension/CHANGELOG.md'], undefined);
  assert.equal(categories['extension/LICENSE.md'], undefined);
  assert.equal(categories['extension/NOTES.md'], 'extra-markdown');
});

test('does not flag ordinary bundled files', () => {
  const entries = [entry('extension/dist/main.js'), entry('extension/package.json')];
  assert.deepEqual(findIgnoreFindings(entries), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -p tsconfig.json && node --test out/test/analyzer/ignoreHeuristics.test.js`
Expected: FAIL — compile error, module does not exist.

- [ ] **Step 3: Implement `src/analyzer/ignoreHeuristics.ts`**

```ts
import type { VsixEntry } from './zip';

export interface IgnoreFinding {
  category: string;
  path: string;
  size: number;
}

const TEST_DIR_RE = /(^|\/)(test|tests|__tests__)\//;
const VCS_EDITOR_RE = /(^|\/)(\.git|\.DS_Store|\.vscode)(\/|$)/;
const LOCKFILE_RE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/;
const KEEP_MARKDOWN_RE = /(^|\/)(README|CHANGELOG|LICENSE)(\.[a-zA-Z0-9]+)?$/i;

export function findIgnoreFindings(entries: VsixEntry[]): IgnoreFinding[] {
  const paths = new Set(entries.map((entry) => entry.path));

  const hasCompiledOutput = (sourcePath: string): boolean => {
    const dir = sourcePath.slice(0, sourcePath.lastIndexOf('/'));
    const root = dir.split('/')[0] ?? dir;
    for (const path of paths) {
      if (path.startsWith(`${root}/dist/`) || path.startsWith(`${root}/out/`)) {
        return true;
      }
    }
    return false;
  };

  const findings: IgnoreFinding[] = [];

  for (const entry of entries) {
    const { path, uncompressedSize: size } = entry;
    let category: string | undefined;

    if (TEST_DIR_RE.test(path)) {
      category = 'test-files';
    } else if (path.endsWith('.map')) {
      category = 'source-maps';
    } else if (path.endsWith('.ts') && !path.endsWith('.d.ts') && hasCompiledOutput(path)) {
      category = 'stray-typescript-source';
    } else if (path.endsWith('.log')) {
      category = 'log-files';
    } else if (VCS_EDITOR_RE.test(path)) {
      category = 'vcs-editor-cruft';
    } else if (LOCKFILE_RE.test(path)) {
      category = 'lockfile';
    } else if (/\.md$/i.test(path) && !KEEP_MARKDOWN_RE.test(path)) {
      category = 'extra-markdown';
    }

    if (category) {
      findings.push({ category, path, size });
    }
  }

  return findings;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsc -p tsconfig.json && node --test out/test/analyzer/ignoreHeuristics.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/analyzer/ignoreHeuristics.ts test/analyzer/ignoreHeuristics.test.ts
git commit -m "feat: flag files a working .vscodeignore usually excludes"
```

---

### Task 6: Unbundled node_modules detection (`analyzer/nodeModules.ts`)

**Files:**
- Create: `src/analyzer/nodeModules.ts`
- Test: `test/analyzer/nodeModules.test.ts`

**Interfaces:**
- Consumes: `VsixEntry` from `src/analyzer/zip.ts` (Task 2)
- Produces: `interface UnbundledPackage { name: string; path: string; fileCount: number; size: number }`
- Produces: `function findUnbundledPackages(entries: VsixEntry[]): UnbundledPackage[]`

- [ ] **Step 1: Write the failing test**

```ts
// test/analyzer/nodeModules.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findUnbundledPackages } from '../../src/analyzer/nodeModules';
import type { VsixEntry } from '../../src/analyzer/zip';

function entry(path: string, size = 10): VsixEntry {
  return { path, uncompressedSize: size, compressedSize: size };
}

test('groups node_modules entries by package name, summing size and file count', () => {
  const entries = [
    entry('extension/node_modules/lodash/index.js', 100),
    entry('extension/node_modules/lodash/package.json', 20),
    entry('extension/node_modules/left-pad/index.js', 5),
  ];

  const packages = findUnbundledPackages(entries).sort((a, b) => a.name.localeCompare(b.name));

  assert.deepEqual(packages, [
    { name: 'left-pad', path: 'extension/node_modules/left-pad', fileCount: 1, size: 5 },
    { name: 'lodash', path: 'extension/node_modules/lodash', fileCount: 2, size: 120 },
  ]);
});

test('handles scoped packages', () => {
  const entries = [entry('extension/node_modules/@scope/pkg/index.js', 10)];
  assert.deepEqual(findUnbundledPackages(entries), [
    { name: '@scope/pkg', path: 'extension/node_modules/@scope/pkg', fileCount: 1, size: 10 },
  ]);
});

test('returns an empty list when there is no node_modules directory', () => {
  const entries = [entry('extension/dist/main.js', 100)];
  assert.deepEqual(findUnbundledPackages(entries), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -p tsconfig.json && node --test out/test/analyzer/nodeModules.test.js`
Expected: FAIL — compile error, module does not exist.

- [ ] **Step 3: Implement `src/analyzer/nodeModules.ts`**

```ts
import type { VsixEntry } from './zip';

export interface UnbundledPackage {
  name: string;
  path: string;
  fileCount: number;
  size: number;
}

const MARKER = 'node_modules/';

function packageDirFromRemainder(remainder: string): string | undefined {
  const segments = remainder.split('/');
  if (segments.length === 0 || segments[0] === '') {
    return undefined;
  }
  if (segments[0].startsWith('@') && segments.length > 1) {
    return `${segments[0]}/${segments[1]}`;
  }
  return segments[0];
}

export function findUnbundledPackages(entries: VsixEntry[]): UnbundledPackage[] {
  const groups = new Map<string, { fileCount: number; size: number }>();

  for (const entry of entries) {
    const idx = entry.path.lastIndexOf(MARKER);
    if (idx === -1) {
      continue;
    }
    const remainder = entry.path.slice(idx + MARKER.length);
    const packageDir = packageDirFromRemainder(remainder);
    if (!packageDir) {
      continue;
    }

    const key = entry.path.slice(0, idx + MARKER.length) + packageDir;
    const existing = groups.get(key);
    if (existing) {
      existing.fileCount += 1;
      existing.size += entry.uncompressedSize;
    } else {
      groups.set(key, { fileCount: 1, size: entry.uncompressedSize });
    }
  }

  return [...groups.entries()].map(([path, group]) => ({
    name: path.slice(path.lastIndexOf(MARKER) + MARKER.length),
    path,
    fileCount: group.fileCount,
    size: group.size,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsc -p tsconfig.json && node --test out/test/analyzer/nodeModules.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/analyzer/nodeModules.ts test/analyzer/nodeModules.test.ts
git commit -m "feat: detect unbundled node_modules packages"
```

---

### Task 7: License collection (`analyzer/licenses.ts`)

**Files:**
- Create: `src/analyzer/licenses.ts`
- Test: `test/analyzer/licenses.test.ts`

**Interfaces:**
- Consumes: `VsixArchive` from `src/analyzer/zip.ts` (Task 2), `VsixManifest` from `src/analyzer/manifest.ts` (Task 3)
- Produces: `interface LicenseEntry { name: string; license?: string }`
- Produces: `function collectLicenses(archive: VsixArchive, manifest: VsixManifest): Promise<LicenseEntry[]>` — first entry is always the extension itself (`manifest.name ?? '(extension)'`), followed by one entry per `node_modules/<pkg>/package.json` found in the archive (deepest `node_modules/` segment wins for nested dependencies).

- [ ] **Step 1: Write the failing test**

```ts
// test/analyzer/licenses.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildZipBuffer } from '../helpers/buildZip';
import { openVsix } from '../../src/analyzer/zip';
import { collectLicenses } from '../../src/analyzer/licenses';

test('collects the extension license plus each node_modules package license', async () => {
  const buffer = await buildZipBuffer([
    { path: 'extension/package.json', content: JSON.stringify({ name: 'demo', license: 'MIT' }) },
    {
      path: 'extension/node_modules/lodash/package.json',
      content: JSON.stringify({ name: 'lodash', license: 'MIT' }),
    },
    {
      path: 'extension/node_modules/left-pad/package.json',
      content: JSON.stringify({ name: 'left-pad' }),
    },
    {
      path: 'extension/node_modules/@scope/pkg/package.json',
      content: JSON.stringify({ name: '@scope/pkg', license: 'Apache-2.0' }),
    },
  ]);
  const archive = await openVsix(buffer);

  const licenses = await collectLicenses(archive, { name: 'demo', license: 'MIT' });
  const byName = Object.fromEntries(licenses.map((l) => [l.name, l.license]));

  assert.equal(byName['demo'], 'MIT');
  assert.equal(byName['lodash'], 'MIT');
  assert.equal(byName['left-pad'], undefined);
  assert.equal(byName['@scope/pkg'], 'Apache-2.0');
  assert.equal(licenses.length, 4);
});

test('falls back to "(extension)" when the manifest has no name', async () => {
  const archive = await openVsix(await buildZipBuffer([]));
  const licenses = await collectLicenses(archive, {});
  assert.equal(licenses[0]?.name, '(extension)');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -p tsconfig.json && node --test out/test/analyzer/licenses.test.js`
Expected: FAIL — compile error, module does not exist.

- [ ] **Step 3: Implement `src/analyzer/licenses.ts`**

```ts
import type { VsixArchive } from './zip';
import type { VsixManifest } from './manifest';

export interface LicenseEntry {
  name: string;
  license?: string;
}

const MARKER = 'node_modules/';

function extractLicense(buffer: Buffer): string | undefined {
  try {
    const pkg = JSON.parse(buffer.toString('utf8'));
    return typeof pkg.license === 'string' && pkg.license.length > 0 ? pkg.license : undefined;
  } catch {
    return undefined;
  }
}

function isPackageRootManifest(afterMarker: string): boolean {
  const segments = afterMarker.split('/');
  if (segments.length === 2) {
    return true;
  }
  return segments.length === 3 && segments[0].startsWith('@');
}

export async function collectLicenses(
  archive: VsixArchive,
  manifest: VsixManifest,
): Promise<LicenseEntry[]> {
  const licenses: LicenseEntry[] = [{ name: manifest.name ?? '(extension)', license: manifest.license }];

  for (const entry of archive.entries) {
    if (!entry.path.endsWith('/package.json')) {
      continue;
    }
    const idx = entry.path.lastIndexOf(MARKER);
    if (idx === -1) {
      continue;
    }
    const afterMarker = entry.path.slice(idx + MARKER.length);
    if (!isPackageRootManifest(afterMarker)) {
      continue;
    }

    const name = afterMarker.slice(0, afterMarker.length - '/package.json'.length);
    const buffer = await archive.readEntry(entry.path);
    licenses.push({ name, license: extractLicense(buffer) });
  }

  return licenses;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsc -p tsconfig.json && node --test out/test/analyzer/licenses.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/analyzer/licenses.ts test/analyzer/licenses.test.ts
git commit -m "feat: collect declared licenses for the extension and its dependencies"
```

---

### Task 8: Combined report (`analyzer/report.ts`)

**Files:**
- Create: `src/analyzer/report.ts`
- Test: `test/analyzer/report.test.ts`

**Interfaces:**
- Consumes: `openVsix` (Task 2), `parseManifest`/`VsixManifest` (Task 3), `buildSizeReport` (Task 4), `findIgnoreFindings`/`IgnoreFinding` (Task 5), `findUnbundledPackages`/`UnbundledPackage` (Task 6), `collectLicenses`/`LicenseEntry` (Task 7)
- Produces: `interface VsixReport { totalUncompressedSize: number; totalCompressedSize: number; fileCount: number; largestFiles: { path: string; size: number }[]; manifest: VsixManifest; ignoreFindings: IgnoreFinding[]; unbundledPackages: UnbundledPackage[]; licenses: LicenseEntry[] }`
- Produces: `function buildReport(source: string | Buffer): Promise<VsixReport>` — this is what `extension.ts` (Task 10) calls directly.

- [ ] **Step 1: Write the failing test**

```ts
// test/analyzer/report.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildZipBuffer, injectRawPath } from '../helpers/buildZip';
import { buildReport } from '../../src/analyzer/report';

const UNSAFE_PATH = '../evil.txt';
const UNSAFE_PATH_PLACEHOLDER = 'x'.repeat(UNSAFE_PATH.length); // see test/helpers/buildZip.ts: injectRawPath

test('builds a full report from a representative vsix layout', async () => {
  const rawBuffer = await buildZipBuffer([
    {
      path: 'extension/package.json',
      content: JSON.stringify({ name: 'my-ext', version: '1.2.3', publisher: 'acme', license: 'MIT' }),
    },
    { path: 'extension/dist/main.js', content: 'console.log(1)' },
    { path: 'extension/test/sample.test.js', content: 'test' },
    { path: 'extension/README.md', content: '# readme' },
    { path: 'extension/NOTES.md', content: 'extra notes' },
    {
      path: 'extension/node_modules/lodash/package.json',
      content: JSON.stringify({ name: 'lodash', license: 'MIT' }),
    },
    { path: 'extension/node_modules/lodash/index.js', content: 'module.exports = {}' },
    {
      path: 'extension/node_modules/left-pad/package.json',
      content: JSON.stringify({ name: 'left-pad' }),
    },
    { path: UNSAFE_PATH_PLACEHOLDER, content: 'escape attempt' },
  ]);
  const buffer = injectRawPath(rawBuffer, UNSAFE_PATH_PLACEHOLDER, UNSAFE_PATH);

  const report = await buildReport(buffer);

  assert.deepEqual(report.manifest, {
    name: 'my-ext',
    version: '1.2.3',
    publisher: 'acme',
    license: 'MIT',
  });
  assert.equal(report.fileCount, 8);

  const findingCategories = Object.fromEntries(report.ignoreFindings.map((f) => [f.path, f.category]));
  assert.equal(findingCategories['extension/test/sample.test.js'], 'test-files');
  assert.equal(findingCategories['extension/NOTES.md'], 'extra-markdown');
  assert.equal(findingCategories['../evil.txt'], 'unsafe-path');
  assert.equal(findingCategories['extension/README.md'], undefined);

  const packageNames = report.unbundledPackages.map((p) => p.name).sort();
  assert.deepEqual(packageNames, ['left-pad', 'lodash']);

  const licenseByName = Object.fromEntries(report.licenses.map((l) => [l.name, l.license]));
  assert.equal(licenseByName['my-ext'], 'MIT');
  assert.equal(licenseByName['lodash'], 'MIT');
  assert.equal(licenseByName['left-pad'], undefined);
});

test('builds a report even when extension/package.json is missing', async () => {
  const buffer = await buildZipBuffer([{ path: 'extension/dist/main.js', content: 'x' }]);
  const report = await buildReport(buffer);

  assert.deepEqual(report.manifest, {});
  assert.equal(report.licenses[0]?.name, '(extension)');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -p tsconfig.json && node --test out/test/analyzer/report.test.js`
Expected: FAIL — compile error, module does not exist.

- [ ] **Step 3: Implement `src/analyzer/report.ts`**

```ts
import { openVsix } from './zip';
import { parseManifest, type VsixManifest } from './manifest';
import { buildSizeReport } from './sizeReport';
import { findIgnoreFindings, type IgnoreFinding } from './ignoreHeuristics';
import { findUnbundledPackages, type UnbundledPackage } from './nodeModules';
import { collectLicenses, type LicenseEntry } from './licenses';

export interface VsixReport {
  totalUncompressedSize: number;
  totalCompressedSize: number;
  fileCount: number;
  largestFiles: { path: string; size: number }[];
  manifest: VsixManifest;
  ignoreFindings: IgnoreFinding[];
  unbundledPackages: UnbundledPackage[];
  licenses: LicenseEntry[];
}

const MANIFEST_PATH = 'extension/package.json';

export async function buildReport(source: string | Buffer): Promise<VsixReport> {
  const archive = await openVsix(source);

  const hasManifest = archive.entries.some((entry) => entry.path === MANIFEST_PATH);
  const manifest = hasManifest ? parseManifest(await archive.readEntry(MANIFEST_PATH)) : parseManifest(undefined);

  const sizeReport = buildSizeReport(archive.entries);
  const ignoreFindings: IgnoreFinding[] = [
    ...findIgnoreFindings(archive.entries),
    ...archive.unsafeEntries.map((path) => ({ category: 'unsafe-path', path, size: 0 })),
  ];
  const unbundledPackages = findUnbundledPackages(archive.entries);
  const licenses = await collectLicenses(archive, manifest);

  return {
    totalUncompressedSize: sizeReport.totalUncompressedSize,
    totalCompressedSize: sizeReport.totalCompressedSize,
    fileCount: sizeReport.fileCount,
    largestFiles: sizeReport.largestFiles,
    manifest,
    ignoreFindings,
    unbundledPackages,
    licenses,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsc -p tsconfig.json && node --test out/test/analyzer/report.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/analyzer/report.ts test/analyzer/report.test.ts
git commit -m "feat: combine analyzer modules into a single vsix report"
```

---

### Task 9: Webview rendering (`webview/report.html.ts`)

**Files:**
- Create: `src/webview/report.html.ts`
- Test: `test/webview/report.html.test.ts`

**Interfaces:**
- Consumes: `VsixReport` from `src/analyzer/report.ts` (Task 8)
- Produces: `function renderReport(report: VsixReport): string`

- [ ] **Step 1: Write the failing test**

```ts
// test/webview/report.html.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReport } from '../../src/webview/report.html';
import type { VsixReport } from '../../src/analyzer/report';

function sampleReport(overrides: Partial<VsixReport> = {}): VsixReport {
  return {
    totalUncompressedSize: 1024 * 1024 * 2,
    totalCompressedSize: 1024 * 512,
    fileCount: 10,
    largestFiles: [{ path: 'extension/dist/main.js', size: 1024 * 900 }],
    manifest: { name: 'my-ext', version: '1.0.0' },
    ignoreFindings: [],
    unbundledPackages: [],
    licenses: [{ name: 'my-ext', license: 'MIT' }],
    ...overrides,
  };
}

test('escapes untrusted entry paths before templating', () => {
  const html = renderReport(
    sampleReport({
      ignoreFindings: [{ category: 'extra-markdown', path: '<script>alert(1)</script>.md', size: 10 }],
    }),
  );

  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;.md'));
});

test('includes a summary banner with counts', () => {
  const html = renderReport(
    sampleReport({
      unbundledPackages: [{ name: 'left-pad', path: 'extension/node_modules/left-pad', fileCount: 1, size: 5 }],
      licenses: [
        { name: 'my-ext', license: 'MIT' },
        { name: 'left-pad', license: undefined },
      ],
    }),
  );

  assert.match(html, /2\.0 MB/);
  assert.match(html, /10 files/);
  assert.match(html, /1 unbundled packages/);
  assert.match(html, /1 missing licenses/);
});

test('renders MISSING for an absent license', () => {
  const html = renderReport(sampleReport({ licenses: [{ name: 'left-pad', license: undefined }] }));
  assert.match(html, /MISSING/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc -p tsconfig.json && node --test out/test/webview/report.html.test.js`
Expected: FAIL — compile error, module does not exist.

- [ ] **Step 3: Implement `src/webview/report.html.ts`**

```ts
import type { VsixReport } from '../analyzer/report';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function rows(cells: string[][]): string {
  return cells.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('\n');
}

export function renderReport(report: VsixReport): string {
  const missingLicenseCount = report.licenses.filter((license) => !license.license).length;
  const name = escapeHtml(report.manifest.name ?? '(unknown)');
  const version = escapeHtml(report.manifest.version ?? '');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family, sans-serif); padding: 1rem; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 1.5rem; }
  td, th { text-align: left; padding: 0.25rem 0.5rem; border-bottom: 1px solid var(--vscode-panel-border, #ccc); }
  h2 { margin-top: 2rem; }
</style>
</head>
<body>
  <h1>${name} ${version}</h1>
  <p>${formatSize(report.totalUncompressedSize)} installed, ${report.fileCount} files,
     ${report.unbundledPackages.length} unbundled packages, ${missingLicenseCount} missing licenses</p>

  <h2>Largest files</h2>
  <table>${rows(report.largestFiles.map((f) => [escapeHtml(f.path), formatSize(f.size)]))}</table>

  <h2>Possible .vscodeignore misses</h2>
  <table>${rows(
    report.ignoreFindings.map((f) => [escapeHtml(f.category), escapeHtml(f.path), formatSize(f.size)]),
  )}</table>

  <h2>Unbundled dependencies</h2>
  <table>${rows(
    report.unbundledPackages.map((p) => [escapeHtml(p.name), String(p.fileCount), formatSize(p.size)]),
  )}</table>

  <h2>Declared licenses</h2>
  <table>${rows(
    report.licenses.map((l) => [escapeHtml(l.name), escapeHtml(l.license ?? 'MISSING')]),
  )}</table>
</body>
</html>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsc -p tsconfig.json && node --test out/test/webview/report.html.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/webview/report.html.ts test/webview/report.html.test.ts
git commit -m "feat: render vsix report as a webview-ready html string"
```

---

### Task 10: Wire up the extension, package metadata, and manual smoke test

**Files:**
- Modify: `src/extension.ts`
- Create: `.vscodeignore`
- Create: `README.md`

**Interfaces:**
- Consumes: `buildReport` (Task 8), `renderReport` (Task 9)
- Produces: the `vsixInspector.inspect` command registered against the contributes block already declared in Task 1's `package.json`.

There is no automated test for this task — it is the only module that touches the live `vscode` API, and pulling in `@vscode/test-electron` to exercise it would add a heavy dependency for a single wiring task. Verification is a manual smoke test instead (Step 4).

- [ ] **Step 1: Implement `src/extension.ts`**

```ts
import * as vscode from 'vscode';
import { buildReport } from './analyzer/report';
import { renderReport } from './webview/report.html';

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand('vsixInspector.inspect', async (uri?: vscode.Uri) => {
    const targetUri = uri ?? (await pickVsixFile());
    if (!targetUri) {
      return;
    }

    let report;
    try {
      report = await buildReport(targetUri.fsPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Could not inspect VSIX: ${message}`);
      return;
    }

    const fileName = targetUri.fsPath.split(/[/\\]/).pop() ?? targetUri.fsPath;
    const panel = vscode.window.createWebviewPanel(
      'vsixInspector',
      `Inspect: ${fileName}`,
      vscode.ViewColumn.Active,
      {},
    );
    panel.webview.html = renderReport(report);
  });

  context.subscriptions.push(disposable);
}

export function deactivate(): void {}

async function pickVsixFile(): Promise<vscode.Uri | undefined> {
  const result = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { 'VSIX files': ['vsix'] },
  });
  return result?.[0];
}
```

- [ ] **Step 2: Create `.vscodeignore`**

```
.vscode/**
.gitignore
.superpowers/**
docs/**
src/**
test/**
out/**
node_modules/**
esbuild.js
tsconfig.json
package-lock.json
*.vsix
```

- [ ] **Step 3: Create `README.md`**

```md
# VSIX Inspector

Inspect a `.vsix` file from VS Code: installed size breakdown, files a
working `.vscodeignore` usually excludes but which shipped anyway,
`node_modules` directories a bundler should have inlined but didn't, and the
declared license of the extension and of any surviving dependencies.

## Usage

Right-click any `.vsix` file in the Explorer and choose **Inspect VSIX**, or
run the **Inspect VSIX** command from the Command Palette and pick a file.

## Development

```bash
npm install
npm run build      # bundle src/extension.ts -> dist/extension.js
npm test           # type-check + run the analyzer test suite
```

Press F5 in VS Code to launch an Extension Development Host with the
extension loaded.
```

- [ ] **Step 4: Full verification — build, test, and manual smoke test**

Run: `npm run typecheck && npm run build && npm test`
Expected: all pass (12 analyzer/webview tests total across Tasks 2–9).

Then manually smoke-test the extension end to end:
1. Open this project folder in VS Code and press `F5` to launch an Extension Development Host.
2. In the host window, run `vsce package` in the original project's terminal to produce `vsix-inspector-0.0.1.vsix` (a good dogfood target — it is itself a real, small `.vsix`).
3. In the Extension Development Host, open the Explorer, locate the generated `.vsix`, right-click it, and choose **Inspect VSIX**.
4. Confirm a webview opens showing the summary banner and all four tables with plausible values (non-zero size, the extension's own name/version/license, no unbundled packages since `yauzl` is bundled by esbuild).
5. Repeat via the Command Palette entry point with no file pre-selected, confirming the file picker appears and filters to `.vsix`.

- [ ] **Step 5: Commit**

```bash
git add src/extension.ts .vscodeignore README.md
git commit -m "feat: wire up the Inspect VSIX command and webview"
```
