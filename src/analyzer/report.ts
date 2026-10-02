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
  try {
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
  } finally {
    archive.close();
  }
}
