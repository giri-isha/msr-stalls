// FOUNDATION — copied verbatim from msr-app-replit/apps/api/src/storage/media-namespace.ts.
// This is the ONE storage file the stalls module may import (the interface and
// the namespace guard). Implementations — S3 in the host, disk here — are
// injected through StallsDeps.

export interface PresignedUpload {
  url: string;
  /** Headers the browser MUST send on the PUT. They are part of the signature:
   *  send different ones and S3 rejects the request, which is what makes the
   *  size and type checks unforgeable rather than advisory. */
  headers: Record<string, string>;
  expiresIn: number;
}

export interface HeadResult {
  bytes: number;
  contentType: string | undefined;
}

/** What a module needs of the bucket. Implemented once for real, once for
 *  development, and as a fake wherever a test needs one. */
export interface MediaStore {
  /** False when the store cannot serve objects — no bucket configured and no
   *  dev directory either. Callers degrade rather than throwing a credential
   *  error at whoever is waiting on the page. */
  configured(): boolean;
  presignUpload(o: { key: string; contentType: string; bytes: number }): Promise<PresignedUpload>;
  presignView(key: string, expiresIn?: number): Promise<string>;
  /** Null when the object is not there — an upload the browser never finished. */
  head(key: string): Promise<HeadResult | null>;
  deleteMany(keys: string[]): Promise<void>;
}

/** Thrown when a key falls outside the namespace the store was built for. A
 *  programming error or an attempt to reach across the boundary — never
 *  something a caller should catch and continue from. */
export class KeyOutsideNamespaceError extends Error {
  constructor(key: string, namespace: string) {
    super(
      `Object key ${JSON.stringify(key)} is outside the namespace ${JSON.stringify(namespace)}`,
    );
    this.name = 'KeyOutsideNamespaceError';
  }
}

/** `..` is refused anywhere in the key, not just at the front: S3 keys are
 *  opaque strings and do not resolve `..` themselves, but the key is also what
 *  ends up in logs and in any future code that treats it as a path. The
 *  development store DOES resolve the key as a path, which turns that reasoning
 *  from prudent into load-bearing. */
export function keyWithinNamespace(key: string, namespace: string): boolean {
  if (!key.startsWith(namespace)) return false;
  return !key.split('/').includes('..');
}

/** The namespace must end in `/`, so `stalls/` cannot also match
 *  `stalls-archive/x` — a prefix without the separator is a boundary that leaks
 *  into its own neighbours. */
export function assertNamespace(namespace: string): void {
  if (!namespace.endsWith('/') || namespace === '/' || namespace.split('/').includes('..')) {
    throw new Error(
      `A media namespace must be a non-empty prefix ending in "/" — got ${JSON.stringify(namespace)}`,
    );
  }
}
