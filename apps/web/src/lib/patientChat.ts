import { useCallback, useEffect, useRef, useState } from 'react';

/** One agent decision, shown inside the chat in demo workspaces. */
export interface AgentActivity {
  agent: string;
  status: 'ok' | 'handoff' | 'failed';
  outcome: string;
  steps: { name: string; detail?: string }[];
  latencyMs: number;
  at: string;
}

export interface ChatMessage {
  id: string;
  role: 'customer' | 'ai' | 'agent';
  content: string;
  created_at: string;
}

async function call<T>(path: string, token: string | null, init: { body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(path, {
    method: init.body !== undefined || init.form ? 'POST' : 'GET',
    headers,
    body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

/**
 * A patient's chat with a workspace, over the same public widget API the website chat uses.
 * One fresh visitor per mount, so every tour starts from an empty conversation.
 */
export function usePatientChat(siteKey: string | null) {
  const [token, setToken] = useState<string | null>(null);
  const [greeting, setGreeting] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typing, setTyping] = useState(false);
  const [activity, setActivity] = useState<AgentActivity[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conversationId = useRef<string | null>(null);
  const stream = useRef<EventSource | null>(null);

  // Patients only see the conversation itself, never internal system lines.
  const add = useCallback((m: ChatMessage) => {
    if (!['customer', 'ai', 'agent'].includes(m.role)) return;
    setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]));
  }, []);

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    call<{ token: string; config: { greeting: string } }>('/widget/session', null, { body: { siteKey } })
      .then((s) => {
        if (cancelled) return;
        setToken(s.token);
        setGreeting(s.config.greeting);
      })
      .catch((e) => setError((e as Error).message));
    return () => {
      cancelled = true;
      stream.current?.close();
    };
  }, [siteKey]);

  const listen = useCallback((tok: string, convId: string) => {
    if (stream.current) return;
    const es = new EventSource(`/widget/stream?token=${encodeURIComponent(tok)}&conversationId=${convId}`);
    es.addEventListener('message', (e) => add(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('agents', (e) => setActivity((list) => [...list, JSON.parse((e as MessageEvent).data)]));
    es.addEventListener('typing', (e) => setTyping(Boolean(JSON.parse((e as MessageEvent).data).typing)));
    stream.current = es;
  }, [add]);

  const send = useCallback(async (content: string) => {
    if (!token || !content.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await call<{ conversationId: string; message: ChatMessage }>('/widget/messages', token, { body: { content, conversationId: conversationId.current } });
      conversationId.current = r.conversationId;
      add(r.message);
      listen(token, r.conversationId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [token, add, listen]);

  const attach = useCallback(async (file: File) => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      if (conversationId.current) form.append('conversationId', conversationId.current);
      await call('/widget/records', token, { form });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [token]);

  return { ready: Boolean(token), greeting, messages, activity, typing, busy, error, send, attach };
}
