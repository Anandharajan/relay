// Load test the customer-facing path: widget session → message → AI reply.
// Run: k6 run -e BASE=http://localhost:8787 -e SITE_KEY=pk_... deploy/k6/widget-load.js
// Note: per-visitor/IP rate limits apply (20 msgs/min per visitor, 40/min per IP). Run from several IPs
// or raise them for the test; the defaults exist to protect the free tier on launch day.
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    chatters: { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: '1m', target: 50 }, { duration: '3m', target: 50 }, { duration: '30s', target: 0 }] },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:message}': ['p(95)<800'],
    'checks{check:ai_replied}': ['rate>0.95'],
  },
};

const BASE = __ENV.BASE || 'http://localhost:8787';
const questions = ['How long does delivery take?', 'क्या कैश ऑन डिलीवरी उपलब्ध है?', 'ಉಚಿತ ಶಿಪ್ಪಿಂಗ್ ಇದೆಯೇ?', 'Where is my order KC-1042?', 'Which grind for french press?'];

export default function () {
  const json = { headers: { 'content-type': 'application/json' } };
  const s = http.post(`${BASE}/widget/session`, JSON.stringify({ siteKey: __ENV.SITE_KEY }), { ...json, tags: { name: 'session' } });
  check(s, { session: (r) => r.status === 200 });
  const auth = { headers: { 'content-type': 'application/json', authorization: `Bearer ${s.json('token')}` } };
  const q = questions[Math.floor(Math.random() * questions.length)];
  const m = http.post(`${BASE}/widget/messages`, JSON.stringify({ content: q }), { ...auth, tags: { name: 'message' } });
  check(m, { message: (r) => r.status === 200 });
  sleep(2);
  const c = http.get(`${BASE}/widget/conversation`, { ...auth, tags: { name: 'poll' } });
  check(c, { ai_replied: (r) => (r.json('messages') || []).some((x) => x.role === 'ai') });
  sleep(1);
}
