import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { config } from '../config.ts';

function isPrivate(ip: string): boolean {
  if (ip.includes(':')) {
    const l = ip.toLowerCase();
    return l === '::1' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') || l === '::' || l.startsWith('::ffff:127.') || l.startsWith('::ffff:10.') || l.startsWith('::ffff:192.168.');
  }
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** SSRF guard for crawler and Actions. Private ranges allowed only when ALLOW_PRIVATE_FETCH is on. */
export async function assertFetchable(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http(s) URLs are allowed');
  if (config.allowPrivateFetch) return url;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addrs.some(isPrivate)) throw new Error('URL resolves to a private network address');
  return url;
}

export async function safeFetch(rawUrl: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const url = await assertFetchable(rawUrl);
  const res = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(init.timeoutMs ?? 15_000) });
  if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
    const next = new URL(res.headers.get('location')!, url).toString();
    return safeFetch(next, init);
  }
  return res;
}
