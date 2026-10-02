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
