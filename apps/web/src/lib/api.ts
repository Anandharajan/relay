import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-relay-csrf': '1' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(path, {
    method: opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET'),
    headers,
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    credentials: 'same-origin',
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

/** Fetch-on-mount with reload. */
export function useApi<T = any>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const seq = useRef(0);
  const reload = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(path);
      if (n === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current) setError((e as Error).message);
    } finally {
      if (n === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

type Handlers = Record<string, (data: any) => void>;

/** One shared EventSource for the dashboard realtime stream; components subscribe to event types. */
const listeners = new Set<Handlers>();
let source: EventSource | null = null;
const knownEvents = ['message.created', 'conversation.created', 'conversation.updated', 'draft.created', 'draft.updated', 'presence', 'attention', 'knowledge.updated', 'simulation.progress'];

function ensureSource() {
  if (source) return;
  source = new EventSource('/api/inbox/stream');
  for (const ev of knownEvents) {
    source.addEventListener(ev, (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      for (const l of listeners) l[ev]?.(data);
    });
  }
}

export function closeStream() {
  source?.close();
  source = null;
}

export function useEvents(handlers: Handlers) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const proxy: Handlers = {};
    for (const ev of knownEvents) proxy[ev] = (d) => ref.current[ev]?.(d);
    listeners.add(proxy);
    ensureSource();
    return () => {
      listeners.delete(proxy);
    };
  }, []);
}

export function timeAgo(iso: string | Date): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** Sentence form: "just now", "5m ago", "3 Oct". */
export function ago(iso: string | Date): string {
  const short = timeAgo(iso);
  return short === 'just now' || /[a-z]{3}/i.test(short) ? short : `${short} ago`;
}

export const inr =(n: number, digits = 0) => `₹${(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
export const pct = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n * 100)}%`);

export const langLabel: Record<string, string> = {
  en: 'English', hi: 'हिंदी Hindi', kn: 'ಕನ್ನಡ Kannada', ta: 'தமிழ் Tamil', te: 'తెలుగు Telugu', ml: 'Malayalam', bn: 'Bengali', gu: 'Gujarati', pa: 'Punjabi', ur: 'Urdu',
};
