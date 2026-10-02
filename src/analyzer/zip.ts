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
