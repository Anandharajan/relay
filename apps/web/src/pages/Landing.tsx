import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { REPO_URL } from '../lib/links';
import { AgentConsole } from '../components/AgentConsole';

const plans = [
  { name: 'Free', price: '₹0', for: 'Try your first front desk', items: ['100 AI conversations / month', '2 staff logins · 1 calendar', 'FAQ answers, bookings and queue'], featured: false },
  { name: 'Starter', price: '₹999', for: 'For a small practice', items: ['1,000 AI conversations / month', '3 staff logins · 3 calendars', 'WhatsApp, bookings and action lookups'], featured: false },
  { name: 'Growth', price: '₹3,999', for: 'For clinics with report workflows', items: ['5,000 AI conversations / month', '8 staff logins · 15 calendars', 'Report intake, findings and doctor approvals'], featured: true },
  { name: 'Institution', price: '₹9,999', for: 'For larger clinical teams', items: ['20,000 AI conversations / month', '30 staff logins · 100 calendars', 'Report intake, findings and doctor approvals'], featured: false },
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
          <a href="#features" className="hide-sm">Features</a>
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
        <span className="pill">For patients, doctors and the people running your clinic</span>
        <h1>From the first question <em>to the doctor’s next step.</em></h1>
        <p className="lead">Relay answers routine questions, books appointments and brings patient reports to the right doctor. One shared workspace, with people in control of clinical decisions.</p>
        <div className="row wrap" style={{ justifyContent: 'center', gap: 12 }}>
          <Link to="/tour/doctor" className="btn primary">Open the doctor workspace →</Link>
          <a href="#console" className="btn">Give the agents a task</a>
        </div>
        <p className="small muted">No sign-up for demos · Fictional patient data · Bring your own AI key or start without one</p>
      </header>

      <section className="section">
        <div className="grid2 roles">
          <Link to="/tour/doctor" className="card role">
            <span className="role-icon">🩺</span>
            <strong>I’m a doctor</strong>
            <span className="small muted">Your own private hospital, no sign-up. Type as a patient in the chatbot and watch agents collect records, write your analysis and reply to the patient.</span>
          </Link>
          <a href="#console" className="card role">
            <span className="role-icon">🏥</span>
            <strong>I run a clinic</strong>
            <span className="small muted">Give the agents any task below, then start free with your own FAQ and doctors.</span>
          </a>
        </div>
      </section>

      <section className="section" id="features">
        <h2>One connected patient journey</h2>
        <p className="sub">The patient’s question, booking and report stay connected, so your team can pick up with context.</p>
        <div className="grid3">
          <article className="card feature"><span className="ico" aria-hidden="true">💬</span><h3>Help before the visit</h3><p>Answer from your clinic’s FAQs in Tamil, Hindi, English and more. Offer available appointments, issue a token and share the visit page.</p></article>
          <article className="card feature"><span className="ico" aria-hidden="true">📄</span><h3>Reports reach the team</h3><p>Patients attach requested reports in chat. Intake organises readable results, and the review queue tracks reports until a clinician marks them reviewed.</p></article>
          <article className="card feature"><span className="ico" aria-hidden="true">🩺</span><h3>The doctor sees what’s next</h3><p>Link each doctor’s calendar to their login. Route bookings and reports to them, with saved notifications and the patient details needed to act.</p></article>
          <article className="card feature"><span className="ico" aria-hidden="true">🤝</span><h3>Staff can take over</h3><p>Reply in the same conversation, keep internal notes private and review clinical drafts before they are sent. Medical questions go to the team.</p></article>
          <article className="card feature"><span className="ico" aria-hidden="true">⏱️</span><h3>A clearer waiting room</h3><p>Use appointment queues, patient check-in and live waiting estimates. Keep bookings, follow-ups and pending reviews in the same workspace.</p></article>
          <article className="card feature"><span className="ico" aria-hidden="true">🔑</span><h3>Your choice of AI</h3><p>Connect Gemini or another supported provider with your own key, use a local model, or start with knowledge-based answers without an LLM.</p></article>
        </div>
      </section>

      <section className="section console-wrap" id="console">
        <h2>See the agents work on a sample task</h2>
        <p className="sub">Preview an answer or report analysis below. Use the guided demos above to try the connected patient and doctor flow.</p>
        <AgentConsole mode="public" />
        <p className="small muted" style={{ textAlign: 'center' }}>Runs on a fictional hospital. Please don’t enter real patient details.</p>
      </section>

      <section className="section" id="pricing">
        <h2>A plan for your clinic’s size</h2>
        <p className="sub">Monthly software plans in rupees, per workspace. Start free; ask us about a hosted plan when you’re ready.</p>
        <div className="grid4">
          {plans.map((p) => (
            <div className={`card price ${p.featured ? 'featured' : ''}`} key={p.name}>
              <h3>{p.name}</h3>
              <p className="small muted">{p.for}</p>
              <div><span className="amount">{p.price}</span> <span className="muted">/month</span></div>
              <ul>{p.items.map((i) => <li key={i}>{i}</li>)}</ul>
              {p.name === 'Free' ? <Link className="btn" to="/signup">Start free</Link> : <a className={`btn ${p.featured ? 'primary' : ''}`} href="#early-access">Ask about {p.name}</a>}
            </div>
          ))}
        </div>
        <div className="pricing-notes card pad stack">
          <h3>Know what you’re paying for</h3>
          <p><strong>Bring your own key:</strong> Relay’s AI conversation cap is lifted when you use your own provider key. Your provider bills model usage separately; staff, calendar and feature limits still follow your plan.</p>
          <p><strong>Channel costs:</strong> WhatsApp/provider charges, AI usage on your own key and phone-call minutes are separate from the Relay subscription. Doctor notifications currently arrive in the workspace, not as WhatsApp alerts.</p>
          <p><strong>Optional add-ons:</strong> AI reminder calls ₹1,999/month, plus your telephony usage. Camera check-in ₹2,999/month per site. Neither is needed for the core chat and booking flow.</p>
          <p><strong>Self-host:</strong> No Relay subscription fee. You manage hosting, storage and any model or channel costs. <a href={REPO_URL}>View the open-source setup →</a></p>
        </div>
        <div className="landing-faq">
          <details><summary>Can I use Relay without an AI API key?</summary><p>Yes. Start with knowledge-based FAQ answers and structured booking tools. Add a model key later for model-backed responses. The fallback does not offer the same flexibility as an LLM.</p></details>
          <details><summary>Does an AI report replace a doctor’s review?</summary><p>No. Report intake organises information for the clinician. Clinical messages require authorised review, and unreadable documents need manual intake. The public console is a preview and does not alert a doctor.</p></details>
          <details><summary>What do I need to connect WhatsApp?</summary><p>A WhatsApp Business Platform connection and its credentials. The web demos work immediately; your own WhatsApp channel needs setup in Settings.</p></details>
        </div>
      </section>

      <section className="section" id="early-access">
        <h2>Early access</h2>
        <EarlyAccess />
      </section>

      <footer className="l-footer">
        Open source (AGPL-3.0) · <a href={REPO_URL}>GitHub</a> · <Link to="/demo">See it on a hospital website</Link>
      </footer>
    </div>
  );
}
