/**
 * Relay chat widget. Embed with:
 *   <script src="https://YOUR-RELAY/widget.js" data-site-key="pk_..." async></script>
 * Optional: data-open="true", data-position="left", data-api="https://api.example.com"
 * JS API: window.Relay.open() / .close() / .toggle()
 */
import { styles } from './styles';

interface WidgetConfig {
  name: string;
  botName: string;
  brandColor: string;
  greeting: string;
  consentText: string;
}

interface Citation {
  n: number;
  title: string;
  url: string | null;
}

interface Msg {
  id: string;
  role: 'customer' | 'ai' | 'agent' | 'system';
  content: string;
  citations?: Citation[];
  created_at?: string;
}

(function () {
  const script = (document.currentScript as HTMLScriptElement | null) ?? document.querySelector<HTMLScriptElement>('script[data-site-key]');
  if (!script) return;
  const siteKey = script.dataset.siteKey;
  if (!siteKey || (window as any).__relayLoaded) return;
  (window as any).__relayLoaded = true;
  const api = (script.dataset.api ?? new URL(script.src).origin).replace(/\/$/, '');
  const storeKey = `relay:${siteKey}`;

  const state = {
    token: '',
    cfg: null as WidgetConfig | null,
    conversationId: null as string | null,
    status: 'ai',
    messages: [] as Msg[],
    open: script.dataset.open === 'true',
    typing: false,
    consented: false,
    feedbackFor: null as string | null,
    stream: null as EventSource | null,
    error: '',
  };

  const read = () => {
    try {
      return JSON.parse(localStorage.getItem(storeKey) ?? '{}');
    } catch {
      return {};
    }
  };
  const save = (patch: object) => {
    try {
      localStorage.setItem(storeKey, JSON.stringify({ ...read(), ...patch }));
    } catch {
      /* storage blocked */
    }
  };

  async function call(path: string, init: { method?: string; body?: object } = {}) {
    const res = await fetch(api + path, {
      method: init.method ?? 'GET',
      headers: { 'content-type': 'application/json', ...(state.token ? { authorization: `Bearer ${state.token}` } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
    return data;
  }

  // ---------- DOM ----------
  const host = document.createElement('div');
  host.id = 'relay-widget';
  const root = host.attachShadow({ mode: 'open' });
  const left = script.dataset.position === 'left';
  root.innerHTML = `<style>${styles}</style>
    <button class="launcher ${left ? 'left' : ''}" aria-label="Open chat">
      <svg class="i-chat" viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M12 3C6.5 3 2 6.9 2 11.6c0 2.4 1.2 4.6 3.1 6.2-.1 1.3-.6 2.6-1.6 3.6 1.9-.1 3.6-.8 4.9-1.9 1.1.3 2.3.5 3.6.5 5.5 0 10-3.9 10-8.6S17.5 3 12 3z"/></svg>
      <svg class="i-close" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
    <section class="panel ${left ? 'left' : ''}" role="dialog" aria-label="Support chat">
      <header>
        <div class="avatar">AI</div>
        <div class="titles"><strong class="bot"></strong><span class="sub"></span></div>
        <button class="close" aria-label="Close chat">×</button>
      </header>
      <div class="status" hidden></div>
      <div class="log" aria-live="polite"></div>
      <div class="error" hidden></div>
      <form class="composer">
        <textarea rows="1" placeholder="Type your message…" aria-label="Message" maxlength="2000"></textarea>
        <button type="submit" aria-label="Send"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M3.4 20.4l17.5-7.5c.8-.4.8-1.5 0-1.8L3.4 3.6c-.7-.3-1.4.3-1.3 1l1.4 6.4 9 1-9 1-1.4 6.4c-.1.7.6 1.3 1.3 1z"/></svg></button>
      </form>
      <footer><button class="human" type="button">Talk to a human</button><span>·</span><a href="${api}" target="_blank" rel="noopener">Powered by Relay</a></footer>
    </section>`;
  const $ = <T extends Element>(s: string) => root.querySelector(s) as T;
  const launcher = $<HTMLButtonElement>('.launcher');
  const panel = $<HTMLElement>('.panel');
  const log = $<HTMLDivElement>('.log');
  const input = $<HTMLTextAreaElement>('textarea');
  const form = $<HTMLFormElement>('form');
  const statusEl = $<HTMLDivElement>('.status');
  const errorEl = $<HTMLDivElement>('.error');

  function escapeHtml(s: string) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  }
  function format(s: string) {
    return escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener nofollow">$1</a>')
      .replace(/\n/g, '<br>');
  }

  function render() {
    host.style.setProperty('--brand', state.cfg?.brandColor ?? '#4f46e5');
    launcher.classList.toggle('open', state.open);
    panel.classList.toggle('open', state.open);
    $('.bot').textContent = state.cfg?.botName ?? 'Support';
    $('.sub').textContent = state.status === 'human' ? `${state.cfg?.name ?? ''} team` : `${state.cfg?.name ?? ''} · AI assistant`;
    const banner =
      state.status === 'escalated' ? 'A teammate has been notified and will reply here.' : state.status === 'human' ? "You're chatting with our team." : '';
    statusEl.hidden = !banner;
    statusEl.textContent = banner;
    errorEl.hidden = !state.error;
    errorEl.textContent = state.error;

    const parts: string[] = [];
    if (state.cfg?.greeting) parts.push(`<div class="msg ai"><div class="bubble">${format(state.cfg.greeting)}</div></div>`);
    if (!state.consented && state.cfg?.consentText) parts.push(`<p class="consent">${escapeHtml(state.cfg.consentText)}</p>`);
    const lastAi = [...state.messages].reverse().find((m) => m.role === 'ai');
    for (const m of state.messages) {
      if (m.role === 'system') continue;
      const cites = (m.citations ?? [])
        .map((c) => (c.url ? `<a class="cite" href="${escapeHtml(c.url)}" target="_blank" rel="noopener">${escapeHtml(c.title)}</a>` : `<span class="cite">${escapeHtml(c.title)}</span>`))
        .join('');
      const label = m.role === 'agent' ? '<span class="who">Team</span>' : '';
      const feedback =
        m.role === 'ai' && m === lastAi && state.status === 'ai' && state.feedbackFor !== m.id && state.messages[state.messages.length - 1] === m
          ? `<div class="feedback">Did this help? <button data-fb="yes">👍 Yes</button><button data-fb="no">👎 No</button></div>`
          : m.role === 'ai' && state.feedbackFor === m.id
            ? '<div class="feedback done">Thanks for the feedback!</div>'
            : '';
      parts.push(`<div class="msg ${m.role}">${label}<div class="bubble">${format(m.content)}</div>${cites ? `<div class="cites">Sources: ${cites}</div>` : ''}${feedback}</div>`);
    }
    if (state.typing) parts.push('<div class="msg ai"><div class="bubble typing"><i></i><i></i><i></i></div></div>');
    log.innerHTML = parts.join('');
    log.scrollTop = log.scrollHeight;
  }

  function upsert(m: Msg) {
    if (state.messages.some((x) => x.id === m.id)) return;
    state.messages.push(m);
    if (m.role !== 'customer') state.typing = false;
  }

  function connect() {
    if (!state.conversationId || state.stream) return;
    const es = new EventSource(`${api}/widget/stream?token=${encodeURIComponent(state.token)}&conversationId=${state.conversationId}`);
    state.stream = es;
    // Events published before the stream (re)connected are not replayed: resync on every open.
    es.addEventListener('open', () => void resync());
    es.addEventListener('message', (e) => {
      upsert(JSON.parse((e as MessageEvent).data));
      render();
      if (!state.open) launcher.classList.add('unread');
    });
    es.addEventListener('typing', (e) => {
      state.typing = JSON.parse((e as MessageEvent).data).typing;
      render();
    });
    es.addEventListener('status', (e) => {
      state.status = JSON.parse((e as MessageEvent).data).status;
      render();
    });
    es.onerror = () => {
      // EventSource reconnects automatically; if the conversation vanished, stop.
      if (es.readyState === EventSource.CLOSED) state.stream = null;
    };
  }

  async function resync() {
    try {
      const conv = await call('/widget/conversation');
      if (!conv.conversation || conv.conversation.id !== state.conversationId) return;
      state.status = conv.conversation.status;
      // Merge, never replace: SSE events may have delivered messages newer than this snapshot.
      for (const m of conv.messages as Msg[]) upsert(m);
      state.messages.sort((a, b) => (a.created_at && b.created_at ? a.created_at.localeCompare(b.created_at) : 0));
      const last = state.messages[state.messages.length - 1];
      if (last && last.role !== 'customer') state.typing = false;
      render();
    } catch {
      /* transient; the next reconnect retries */
    }
  }

  async function boot() {
    const saved = read();
    state.consented = Boolean(saved.consented);
    const s = await call('/widget/session', { method: 'POST', body: { siteKey, token: saved.token } });
    state.token = s.token;
    state.cfg = s.config;
    save({ token: s.token });
    const conv = await call('/widget/conversation');
    if (conv.conversation) {
      state.conversationId = conv.conversation.id;
      state.status = conv.conversation.status;
      state.messages = conv.messages;
      connect();
    }
    document.body.appendChild(host);
    render();
  }

  async function send(text: string) {
    state.error = '';
    if (!state.consented) {
      state.consented = true;
      save({ consented: true });
      call('/widget/consent', { method: 'POST', body: { purpose: 'support_chat' } }).catch(() => {});
    }
    const temp: Msg = { id: `tmp-${Date.now()}`, role: 'customer', content: text };
    state.messages.push(temp);
    state.typing = state.status === 'ai';
    render();
    try {
      const r = await call('/widget/messages', { method: 'POST', body: { content: text, conversationId: state.conversationId, pageUrl: location.href.slice(0, 500) } });
      temp.id = r.message.id;
      temp.created_at = r.message.created_at;
      if (state.conversationId !== r.conversationId) {
        state.conversationId = r.conversationId;
        connect();
      }
    } catch (e) {
      state.typing = false;
      state.error = (e as Error).message;
    }
    render();
  }

  // ---------- Events ----------
  const toggle = (open = !state.open) => {
    state.open = open;
    launcher.classList.remove('unread');
    render();
    if (open) setTimeout(() => input.focus(), 50);
  };
  launcher.addEventListener('click', () => toggle());
  $('.close').addEventListener('click', () => toggle(false));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = '';
    void send(text);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  });
  log.addEventListener('click', async (e) => {
    const fb = (e.target as HTMLElement).closest('[data-fb]') as HTMLElement | null;
    if (!fb || !state.conversationId) return;
    const lastAi = [...state.messages].reverse().find((m) => m.role === 'ai');
    state.feedbackFor = lastAi?.id ?? null;
    render();
    await call('/widget/feedback', { method: 'POST', body: { conversationId: state.conversationId, helpful: fb.dataset.fb === 'yes' } }).catch(() => {});
  });
  $('.human').addEventListener('click', async () => {
    if (!state.conversationId) {
      await send('I would like to talk to a human, please.');
      return;
    }
    await call('/widget/handoff', { method: 'POST', body: { conversationId: state.conversationId } }).catch(() => {});
  });

  (window as any).Relay = { open: () => toggle(true), close: () => toggle(false), toggle: () => toggle() };

  const start = () => boot().catch((e) => console.warn('[Relay] widget failed to start:', e.message));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
