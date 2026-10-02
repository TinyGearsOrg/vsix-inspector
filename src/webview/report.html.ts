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

function headerRow(columns: string[]): string {
  return `<tr>${columns.map((column) => `<th>${column}</th>`).join('')}</tr>`;
}

function table(columns: string[], cells: string[][], emptyMessage: string): string {
  if (cells.length === 0) {
    return `<p>${emptyMessage}</p>`;
  }
  return `<table>${headerRow(columns)}\n${rows(cells)}</table>`;
}

export function renderReport(report: VsixReport): string {
  const missingLicenseCount = report.licenses.filter((license) => !license.license).length;
  const name = escapeHtml(report.manifest.name ?? '(unknown)');
  const version = escapeHtml(report.manifest.version ?? '');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
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
  ${table(
    ['Path', 'Size'],
    report.largestFiles.map((f) => [escapeHtml(f.path), formatSize(f.size)]),
    'None found.',
  )}

  <h2>Possible .vscodeignore misses</h2>
  ${table(
    ['Category', 'Path', 'Size'],
    report.ignoreFindings.map((f) => [
      escapeHtml(f.category),
      escapeHtml(f.path),
      f.category === 'unsafe-path' ? '—' : formatSize(f.size),
    ]),
    'None found.',
  )}

  <h2>Unbundled dependencies</h2>
  ${table(
    ['Package', 'Files', 'Size'],
    report.unbundledPackages.map((p) => [escapeHtml(p.name), String(p.fileCount), formatSize(p.size)]),
    'None found.',
  )}

  <h2>Declared licenses</h2>
  ${table(
    ['Package', 'License'],
    report.licenses.map((l) => [escapeHtml(l.name), escapeHtml(l.license ?? 'MISSING')]),
    'None found.',
  )}
</body>
</html>`;
}
