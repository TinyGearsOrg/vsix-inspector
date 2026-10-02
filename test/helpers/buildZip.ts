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
