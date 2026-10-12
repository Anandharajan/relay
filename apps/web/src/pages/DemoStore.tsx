import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

const departments = [
  { ta: 'பொது மருத்துவம்', en: 'General Medicine', icon: '🩺', doc: 'Dr. Meenakshi Sundaram' },
  { ta: 'இதய நலம்', en: 'Cardiology', icon: '❤️', doc: 'Dr. Arjun Ramanathan' },
  { ta: 'நீரிழிவு & ஹார்மோன்', en: 'Diabetology & Endocrinology', icon: '🩸', doc: 'Dr. Lakshmi Narayanan' },
  { ta: 'குழந்தைகள் நலம்', en: 'Paediatrics', icon: '🧒', doc: 'Dr. Kavitha Selvaraj' },
  { ta: 'எலும்பு & மூட்டு', en: 'Orthopaedics', icon: '🦴', doc: 'Dr. Farhan Ali' },
  { ta: 'மகப்பேறு & பெண்கள் நலம்', en: 'Obstetrics & Gynaecology', icon: '🤰', doc: 'Dr. Narmadha Vasu' },
  { ta: 'மயக்கவியல்', en: 'Anaesthesiology', icon: '💉', doc: 'Dr. Kannan' },
];

const tries = [
  'அப்பாயின்ட்மென்ட் வேண்டும், சர்க்கரை நோய் மருத்துவர்',
  'வெளிநோயாளர் பிரிவு நேரம் என்ன?',
  'Do you accept health insurance?',
  'Is my report LAB-2041 ready?',
  'Can I take paracetamol with my BP tablets?',
  'I have reached the hospital',
  'परामर्श शुल्क कितना है?',
];

/** A fictional Chennai hospital website with the Relay assistant installed, for the live demo. */
export function DemoStore() {
  const [siteKey, setSiteKey] = useState<string | null | undefined>(undefined);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('relay-demo-theme') || 'system'; } catch { return 'system'; }
  });
  useEffect(() => {
    const host = document.getElementById('relay-widget');
    if (host) host.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    api<{ demoSiteKey: string | null }>('/api/public/config').then((c) => setSiteKey(c.demoSiteKey), () => setSiteKey(null));
  }, []);

  useEffect(() => {
    if (!siteKey) return;
    const s = document.createElement('script');
    s.src = '/widget.js';
    s.async = true;
    s.onload = () => {
      const host = document.getElementById('relay-widget');
      if (host) host.dataset.theme = document.querySelector<HTMLElement>('.hospital')?.dataset.theme || 'system';
    };
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
    <div className="hospital" data-theme={theme}>
      <div className="strip">🚑 அவசர சிகிச்சை 24 மணி நேரமும் · 24×7 Emergency: call 108</div>
      <header className="top">
        <div className="wrap row between wrap" style={{ padding: '14px 20px', gap: 8 }}>
          <div>
            <strong style={{ fontSize: 19 }}>பூந்தளிர் மருத்துவமனை</strong>
            <div className="small" style={{ opacity: 0.9 }}>Poonthalir Hospital · Anna Nagar, Chennai</div>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <span className="small">OPD திங்கள்–சனி 8AM–8PM · ஞாயிறு 9AM–1PM</span>
            <label className="theme-picker">Appearance{' '}
              <select aria-label="Demo appearance" value={theme} onChange={(e) => {
                setTheme(e.target.value);
                try { localStorage.setItem('relay-demo-theme', e.target.value); } catch { /* Storage is optional. */ }
              }}>
                <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
              </select>
            </label>
          </div>
        </div>
      </header>
      <main className="wrap stack lg" style={{ padding: '22px 20px 120px' }}>
        <div className="ta-banner">
          <h1>உங்கள் நலமே எங்கள் முதல் கடமை</h1>
          <p>வாட்ஸ்அப்பில் முன்பதிவு · நேரடி காத்திருப்பு நேரம் · உங்கள் மொழியில் உதவி</p>
          <p className="small" style={{ opacity: 0.9 }}>Book on WhatsApp · live waiting time · help in Tamil, English and Hindi</p>
        </div>

        <div className="try stack">
          <div className="row between wrap">
            <strong>👋 இது ஒரு டெமோ மருத்துவமனை இணையதளம் · This is a demo hospital website with the Relay assistant.</strong>
            <Link to="/" className="small">← Back to Relay</Link>
          </div>
          <p className="small">
            Open the chat (bottom-right) and try these. It answers from the hospital's help desk with citations, books appointments with a token and a live
            visit page, checks lab report status through an Action, refuses medical advice, and escalates emergencies.
          </p>
          <p className="small"><strong>Demo chats are public and visible to other visitors. Please don't enter real names, phone numbers or health details.</strong></p>
          <div className="row wrap" style={{ gap: 6 }}>
            {tries.map((t) => <code key={t}>{t}</code>)}
          </div>
          <p className="small">
            Lab IDs like <code>LAB-2041</code> work. Then see the hospital's side:{' '}
            <a href="/try" target="_blank" rel="noreferrer"><strong>open the staff dashboard ↗</strong></a> (live queue, doctor brief, AI findings, approvals). Read-only, no sign-up.
          </p>
          {siteKey === null && <div className="error-box">The demo workspace isn't seeded on this server (set DEMO_SEED=true).</div>}
        </div>

        <h2>எங்கள் துறைகள் · Departments</h2>
        <div className="depts">
          {departments.map((d) => (
            <div className="dept" key={d.en}>
              <span style={{ fontSize: 26 }}>{d.icon}</span>
              <strong>{d.ta}</strong>
              <span className="small muted">{d.en}</span>
              <span className="small">{d.doc}</span>
            </div>
          ))}
        </div>

        <div className="grid3">
          <div className="dept"><strong>🧪 பரிசோதனைக் கூடம் · Lab</strong><span className="small">காலை 7 – இரவு 9 · வீட்டிலேயே மாதிரி சேகரிப்பு ₹150</span></div>
          <div className="dept"><strong>💳 காப்பீடு · Insurance</strong><span className="small">பணமில்லா சிகிச்சை · Cashless with major insurers and TPAs</span></div>
          <div className="dept"><strong>💊 மருந்தகம் · Pharmacy</strong><span className="small">24 மணி நேரமும் · Open 24×7</span></div>
        </div>
        <p className="small muted">Poonthalir Hospital is fictional, created to demonstrate Relay. Doctors, patients, phone numbers and reports in this demo are synthetic. No real appointments are made.</p>
      </main>
    </div>
  );
}
