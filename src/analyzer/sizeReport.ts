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
