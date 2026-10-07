import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { AwsClient } from 'aws4fetch';
import { config } from '../config.ts';

/** Raw uploads and crawl snapshots. Keys are always prefixed `org/<org_id>/`. */
export interface BlobStore {
  put(key: string, data: Uint8Array, contentType?: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

function fsStore(root: string): BlobStore {
  const path = (key: string) => {
    const p = normalize(join(root, key));
    if (!p.startsWith(normalize(root))) throw new Error('Invalid blob key');
    return p;
  };
  return {
    async put(key, data) {
      const p = path(key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, data);
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(path(key)));
      } catch {
        return null;
      }
    },
    async delete(key) {
      await rm(path(key), { force: true });
    },
  };
}

/** S3-compatible: MinIO, Garage, Cloudflare R2, AWS S3. */
function s3Store(): BlobStore {
  const b = config.blob;
  const aws = new AwsClient({ accessKeyId: b.s3AccessKey, secretAccessKey: b.s3SecretKey, region: b.s3Region, service: 's3' });
  const url = (key: string) => `${b.s3Endpoint.replace(/\/$/, '')}/${b.s3Bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
  return {
    async put(key, data, contentType = 'application/octet-stream') {
      const res = await aws.fetch(url(key), { method: 'PUT', body: data as BodyInit, headers: { 'content-type': contentType } });
      if (!res.ok) throw new Error(`S3 put failed: ${res.status}`);
    },
    async get(key) {
      const res = await aws.fetch(url(key));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`S3 get failed: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async delete(key) {
      await aws.fetch(url(key), { method: 'DELETE' });
    },
  };
}

let store: BlobStore | null = null;
export function getBlobStore(): BlobStore {
  if (!store) store = config.blob.s3Endpoint ? s3Store() : fsStore(join(config.dataDir, 'blobs'));
  return store;
}
