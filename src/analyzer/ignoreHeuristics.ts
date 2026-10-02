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
