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
