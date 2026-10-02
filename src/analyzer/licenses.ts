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
