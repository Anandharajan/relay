import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

const products = [
  { name: 'Monsoon Malabar', price: 449, art: '🌧️', bg: '#e8dccb', note: 'Earthy, low acidity · 250g' },
  { name: 'Chikmagalur Estate', price: 799, art: '⛰️', bg: '#dfe7d4', note: 'Chocolate & citrus · 500g' },
  { name: 'Filter Coffee Kit', price: 999, art: '☕', bg: '#f0d9c4', note: '80:20 chicory blend + steel filter' },
  { name: 'Cold Brew Bags', price: 349, art: '🧊', bg: '#d8e4ec', note: '10 bags · steep overnight' },
];

const tries = [
  'How long does delivery take?',
  'डिलीवरी में कितने दिन लगते हैं?',
  'ಉಚಿತ ಶಿಪ್ಪಿಂಗ್ ಇದೆಯೇ?',
  'Where is my order KC-1042?',
  'Cancel my order KC-2001',
  'Do you sell green tea?',
];

/** A fictional D2C store with the Relay widget installed, for the launch demo. */
export function DemoStore() {
  const [siteKey, setSiteKey] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    api<{ demoSiteKey: string | null }>('/api/public/config').then((c) => setSiteKey(c.demoSiteKey), () => setSiteKey(null));
  }, []);

  useEffect(() => {
    if (!siteKey) return;
    const s = document.createElement('script');
    s.src = '/widget.js';
    s.async = true;
    s.dataset.siteKey = siteKey;
    s.dataset.open = window.innerWidth > 700 ? 'true' : 'false';
    document.body.appendChild(s);
    return () => {
      s.remove();
      document.getElementById('relay-widget')?.remove();
      delete (window as any).__relayLoaded;
      delete (window as any).Relay;
    };
  }, [siteKey]);

  return (
    <div className="store">
      <header>
        <div className="wrap row between" style={{ padding: '16px 20px' }}>
          <strong style={{ fontSize: 20, fontFamily: 'Georgia, serif' }}>Kaapi &amp; Co.</strong>
          <span className="small" style={{ opacity: 0.85 }}>Fresh-roasted in Bengaluru · Free shipping over ₹599</span>
        </div>
      </header>
      <main className="wrap stack lg" style={{ padding: '28px 20px 120px' }}>
        <div className="try stack">
          <div className="row between wrap">
            <strong>👋 This is a demo store with the Relay widget installed.</strong>
            <Link to="/" className="small">← Back to Relay</Link>
          </div>
          <p className="small">
            Open the chat (bottom-right) and try any of these — it answers in your language, looks up orders through an Action, and hands off to a human when it doesn't know.
          </p>
          <div className="row wrap" style={{ gap: 6 }}>
            {tries.map((t) => (
              <code key={t}>{t}</code>
            ))}
          </div>
          <p className="small" style={{ color: '#7a5a3c' }}>
            Order IDs like <code>KC-1001</code> to <code>KC-9999</code> work. Then see the other side:{' '}
            <a href="/try" target="_blank" rel="noreferrer"><strong>open the team inbox ↗</strong></a> — your chat shows up there, read-only, no sign-up.
          </p>
          {siteKey === null && <div className="error-box">The demo workspace isn't seeded on this server (set DEMO_SEED=true).</div>}
        </div>
        <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 26 }}>Small-batch coffee from the Western Ghats</h2>
        <div className="products">
          {products.map((p) => (
            <div className="product" key={p.name}>
              <div className="art" style={{ background: p.bg }}>{p.art}</div>
              <strong>{p.name}</strong>
              <span className="small" style={{ color: '#7a5a3c' }}>{p.note}</span>
              <span style={{ fontWeight: 700 }}>₹{p.price}</span>
            </div>
          ))}
        </div>
        <p className="small" style={{ color: '#7a5a3c' }}>Kaapi &amp; Co. is a fictional store created to demonstrate Relay. No real orders are placed.</p>
      </main>
    </div>
  );
}
