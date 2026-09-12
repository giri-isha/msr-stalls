// FOUNDATION STUB — a MediaStore that keeps objects in a directory. Stands in
// for the host's S3 store in development and tests. Discarded at migration.
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import {
  type HeadResult,
  KeyOutsideNamespaceError,
  type MediaStore,
  type PresignedUpload,
  assertNamespace,
  keyWithinNamespace,
} from './media-namespace';

export const DEV_MEDIA_ROUTE = '/api/dev-media';

/** Resolves a key to a path under `root` and refuses anything that escapes it.
 *  The namespace check is the boundary; this is the belt to its braces. */
export function devMediaPath(root: string, key: string, namespace: string): string | null {
  if (!keyWithinNamespace(key, namespace)) return null;
  const abs = resolve(root, key);
  const base = resolve(root);
  if (abs !== base && !abs.startsWith(base + sep)) return null;
  return abs;
}

export class DiskMediaStore implements MediaStore {
  constructor(
    private readonly root: string,
    private readonly namespace: string,
    private readonly publicBase = DEV_MEDIA_ROUTE,
  ) {
    assertNamespace(namespace);
  }

  configured(): boolean {
    return true;
  }

  private pathFor(key: string): string {
    const p = devMediaPath(this.root, key, this.namespace);
    if (!p) throw new KeyOutsideNamespaceError(key, this.namespace);
    return p;
  }

  async presignUpload(o: { key: string; contentType: string; bytes: number }) {
    this.pathFor(o.key);
    const upload: PresignedUpload = {
      url: `${this.publicBase}/${o.key}`,
      headers: { 'content-type': o.contentType, 'content-length': String(o.bytes) },
      expiresIn: 900,
    };
    return upload;
  }

  async presignView(key: string): Promise<string> {
    this.pathFor(key);
    return `${this.publicBase}/${key}`;
  }

  async head(key: string): Promise<HeadResult | null> {
    try {
      const s = await stat(this.pathFor(key));
      return { bytes: s.size, contentType: undefined };
    } catch {
      return null;
    }
  }

  async deleteMany(keys: string[]): Promise<void> {
    await Promise.all(keys.map((k) => rm(this.pathFor(k), { force: true })));
  }

  /** Used by the dev-media routes the standalone app.ts mounts. */
  async put(key: string, bytes: Uint8Array): Promise<void> {
    const p = this.pathFor(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, bytes);
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return await readFile(this.pathFor(key));
    } catch {
      return null;
    }
  }
}

export function devMediaDir(): string | undefined {
  return process.env.MSR_DEV_MEDIA_DIR || undefined;
}

export { join as joinPath };
