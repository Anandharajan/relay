import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { REPO_URL } from '../lib/links';
import { AgentConsole } from '../components/AgentConsole';

const plans = [
  { name: 'Free', price: '₹0', items: ['100 AI conversations', 'Your own AI key: unlimited'] },
  { name: 'Starter', price: '₹999', items: ['1,000 conversations', 'WhatsApp, bookings, queue'] },
  { name: 'Growth', price: '₹3,999', items: ['5,000 conversations', 'Report reading + doctor approvals'], featured: true },
  { name: 'Institution', price: '₹9,999', items: ['20,000 conversations', '100 staff calendars'] },
];

function EarlyAccess() {
  const [f, setF] = useState({ name: '', email: '', orgName: '' });
  const [state, setState] = useState<'idle' | 'sent' | 'error'>('idle');
  const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('/api/public/leads', { body: { ...f, institutionType: 'clinic', source: 'landing' } });
      setState('sent');
    } catch (x) {
      setErr((x as Error).message);
      setState('error');
    }
  };
  if (state === 'sent') return <p className="ok-box" style={{ textAlign: 'center' }}>✅ Thanks, we’ll be in touch within two working days.</p>;
  return (
    <form className="row wrap ea" onSubmit={submit}>
      <input className="input" required placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <input className="input" required type="email" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <input className="input" placeholder="Clinic or institution" value={f.orgName} onChange={(e) => setF({ ...f, orgName: e.target.value })} />
      <button className="btn primary">Get early access</button>
      {state === 'error' && <div className="error-box">{err}</div>}
    </form>
  );
}

export function Landing() {
  const { me } = useSession();
  return (
    <div className="landing">
      <nav className="l-nav">
        <Link to="/" className="brandmark" style={{ padding: 0 }}>
          <img src="/icon.svg" alt="" /> Relay
        </Link>
        <div className="links">
          <a href="#pricing" className="hide-sm">Pricing</a>
          {me && me.role !== 'viewer' ? (
            <Link className="btn primary" to="/app">Open {me.org.name}</Link>
          ) : (
            <>
              <Link to="/login">Sign in</Link>
              <Link className="btn primary" to="/signup">Start free</Link>
            </>
          )}
        </div>
      </nav>

      <header className="hero slim">
        <h1>Give it a task. <em>Watch the agents work.</em></h1>
        <p className="lead">An AI front desk for clinics and institutions. Try it now: no sign-up.</p>
      </header>

      <section className="section console-wrap">
        <AgentConsole mode="public" />
        <p className="small muted" style={{ textAlign: 'center' }}>Runs on a fictional hospital. Please don’t enter real patient details.</p>
      </section>

      <section className="section">
        <div className="grid3 points">
          <div><strong>💬 Answers and books</strong><span>On WhatsApp and chat, in Tamil, Hindi, English and more.</span></div>
          <div><strong>🩺 Reads reports</strong><span>Flags what matters for the doctor. Patients hear only what the doctor approves.</span></div>
          <div><strong>🛡️ Safe by design</strong><span>Emergencies escalate instantly. It never gives medical advice.</span></div>
        </div>
      </section>

      <section className="section" id="pricing">
        <h2>Pricing</h2>
        <div className="grid4">
          {plans.map((p) => (
            <div className={`card price ${p.featured ? 'featured' : ''}`} key={p.name}>
              <h3>{p.name}</h3>
              <div><span className="amount">{p.price}</span> <span className="muted">/month</span></div>
              <ul>{p.items.map((i) => <li key={i}>{i}</li>)}</ul>
            </div>
          ))}
        </div>
        <p className="small muted" style={{ textAlign: 'center' }}>Add-ons: AI reminder calls ₹1,999/mo · camera check-in ₹2,999/mo · free to self-host.</p>
      </section>

      <section className="section">
        <h2>Early access</h2>
        <EarlyAccess />
      </section>

      <footer className="l-footer">
        Open source (AGPL-3.0) · <a href={REPO_URL}>GitHub</a> · <Link to="/demo">See it on a hospital website</Link>
      </footer>
    </div>
  );
}
