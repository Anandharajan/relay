import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { REPO_URL } from '../lib/links';

const institutions = [
  { ico: '🏥', title: 'Hospitals & clinics', text: 'Appointments, tokens and live waiting time, doctor-approved prep instructions, report reading, findings for the doctor, follow-ups and reminder calls.' },
  { ico: '🧪', title: 'Diagnostics & labs', text: 'Report status, home-collection bookings, fasting instructions and result delivery on WhatsApp.' },
  { ico: '🎓', title: 'Schools, colleges & coaching', text: 'Admissions questions, counselling sessions, fee and timetable queries, parent follow-ups.' },
  { ico: '🛠️', title: 'Service businesses', text: 'Salons, repair centres, legal and finance offices: bookings, queues, reminders and status lookups.' },
];

const agents = [
  { ico: '💬', name: 'Front desk', text: 'Answers from your own help content, in the visitor’s language, with citations. Not sure? It hands over with a draft.' },
  { ico: '🗓️', name: 'Booking', text: 'Offers real free slots, books, issues a token and a visit link, and answers “how long is the wait?”.' },
  { ico: '🛡️', name: 'Safety', text: 'Detects emergencies in Tamil, Hindi, English and more, and never gives medical advice. Escalates instantly.' },
  { ico: '📄', name: 'Intake', text: 'Reads uploaded reports and prescriptions into structured results and medicines.' },
  { ico: '🩺', name: 'Findings', text: 'Flags critical, abnormal, worsening and overdue results for the doctor, and drafts a patient message for approval.' },
  { ico: '🔁', name: 'Follow-up', text: 'Checks in after the visit, chases pending tests, recovers no-shows; “worse” replies alert the team.' },
  { ico: '📞', name: 'Telecaller', text: 'Reminder and follow-up calls with keypad answers (add-on).' },
  { ico: '📷', name: 'Arrival', text: 'QR and WhatsApp check-in by default; opt-in camera check-in on-premises (add-on).' },
];

const features = [
  { ico: '💬', title: 'WhatsApp + web chat', text: 'One assistant on the channel people already use. The web widget is a single script tag; WhatsApp Cloud API connects in minutes.' },
  { ico: '👩‍⚕️', title: 'Human in the loop', text: 'AI and staff share one inbox. Clinical messages wait in Approvals until a doctor edits and sends them.' },
  { ico: '⏱️', title: 'Live waiting time', text: 'The queue learns each doctor’s real pace and updates patients when the wait changes by 10 minutes or more.' },
  { ico: '🔐', title: 'DPDP-ready', text: 'Personal and health details are masked before any model call. Consent log, retention, export/erase and a full audit trail.' },
  { ico: '🔑', title: 'BYOK or fully local', text: 'Use your own Claude, OpenAI, Gemini or Groq key, or open models on Ollama. Works with no model at all, for free.' },
  { ico: '📊', title: 'Observable agents', text: 'Every agent step is logged with cost, latency and failure tags, so you can see what it did and why.' },
];

const plans = [
  { name: 'Open source', price: 'Free', note: 'self-host', items: ['Everything, including add-ons', 'Your servers, your data', 'Docker Compose in one command'] },
  { name: 'Free', price: '₹0', note: '/month', items: ['100 AI conversations/mo', '1 staff calendar', 'Unlimited with your own key'] },
  { name: 'Starter', price: '₹999', note: '/month', items: ['1,000 AI conversations', '3 staff calendars', 'WhatsApp, Actions, queue'] },
  { name: 'Growth', price: '₹3,999', note: '/month', items: ['5,000 AI conversations', '15 staff calendars', 'Medical records + AI findings'], featured: true },
  { name: 'Institution', price: '₹9,999', note: '/month', items: ['20,000 AI conversations', '100 staff calendars', '30 seats, priority support'] },
];

function EarlyAccess() {
  const [f, setF] = useState({ name: '', email: '', phone: '', orgName: '', institutionType: 'clinic', size: '', message: '' });
  const [state, setState] = useState<'idle' | 'sent' | 'error'>('idle');
  const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('/api/public/leads', { body: { ...f, phone: f.phone || undefined, source: 'landing' } });
      setState('sent');
    } catch (x) {
      setErr((x as Error).message);
      setState('error');
    }
  };
  if (state === 'sent') return <div className="card pad" style={{ maxWidth: 640, margin: '0 auto', textAlign: 'center' }}>✅ Thanks! We'll reach out within two working days to set up your workspace.</div>;
  return (
    <form className="card pad stack" style={{ maxWidth: 640, margin: '0 auto' }} onSubmit={submit}>
      <div className="grid2">
        <input className="input" required placeholder="Your name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input className="input" required type="email" placeholder="Work email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <input className="input" placeholder="Phone / WhatsApp (optional)" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <input className="input" placeholder="Institution name" value={f.orgName} onChange={(e) => setF({ ...f, orgName: e.target.value })} />
        <select className="select" value={f.institutionType} onChange={(e) => setF({ ...f, institutionType: e.target.value })}>
          <option value="clinic">Clinic</option><option value="hospital">Hospital</option><option value="diagnostics">Diagnostics / lab</option>
          <option value="education">School / college / coaching</option><option value="services">Service business</option><option value="other">Other</option>
        </select>
        <select className="select" value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })}>
          <option value="">Size</option><option>1–5 staff</option><option>6–25 staff</option><option>26–100 staff</option><option>100+ staff</option>
        </select>
      </div>
      <textarea className="textarea" rows={2} placeholder="What would you like the assistant to handle?" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />
      {state === 'error' && <div className="error-box">{err}</div>}
      <button className="btn primary lg">Request early access</button>
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
          <a href="#agents" className="hide-sm">Agents</a>
          <a href="#pricing" className="hide-sm">Pricing</a>
          <a href="#self-host" className="hide-sm">Self-host</a>
          <a href="#early-access" className="hide-sm">Early access</a>
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

      <header className="hero">
        <span className="pill">Open-source agentic front desk · WhatsApp + web chat + calls · BYOK · Self-hostable</span>
        <h1>
          An AI front desk for <em>every institution</em>
        </h1>
        <p className="lead">
          Relay’s team of agents answers questions, books appointments, keeps people updated on the wait, reads reports for your doctors and follows up after
          the visit, in Tamil, Hindi, English and more. Your staff stay in control of every sensitive decision.
        </p>
        <div className="row wrap" style={{ justifyContent: 'center' }}>
          <Link className="btn primary lg" to="/demo">Try the hospital demo →</Link>
          <Link className="btn lg" to="/try">Explore the staff dashboard</Link>
        </div>
        <p className="small muted" style={{ textAlign: 'center' }}>
          No sign-up for the demo. <Link to="/signup">Create a free workspace</Link> or <a href="#early-access">request early access</a>.
        </p>
        <div className="card chat-mock" aria-label="Example conversation">
          <div className="q">அப்பாயின்ட்மென்ட் வேண்டும், சர்க்கரை நோய் மருத்துவர்</div>
          <div className="a">
            Dr. Lakshmi Narayanan அவர்களுடன் கிடைக்கும் நேரங்கள்: 1. செவ்., 10:30 AM · 2. செவ்., 11:15 AM …
            <div className="src">Booking agent · real free slots</div>
          </div>
          <div className="q">I have reached the hospital</div>
          <div className="a">
            You're checked in. Token 4, 2 ahead of you. Estimated wait: about 22 minutes.
            <div className="src">Queue · updates as consultations finish</div>
          </div>
        </div>
      </header>

      <section className="section">
        <h2>Built for institutions that serve people in person</h2>
        <p className="sub">One product, configured per institution. Hospitals and clinics get the full healthcare pack.</p>
        <div className="grid4">
          {institutions.map((f) => (
            <div className="card feature" key={f.title}><div className="ico">{f.ico}</div><h3>{f.title}</h3><p>{f.text}</p></div>
          ))}
        </div>
      </section>

      <section className="section" id="agents">
        <h2>A team of agents, each with one job</h2>
        <p className="sub">They hand work to each other, and to your staff, whenever a decision needs a person.</p>
        <div className="grid4">
          {agents.map((a) => (
            <div className="card feature" key={a.name}><div className="ico">{a.ico}</div><h3>{a.name}</h3><p>{a.text}</p></div>
          ))}
        </div>
      </section>

      <section className="section" id="features">
        <h2>Everything around the conversation</h2>
        <div className="grid3">
          {features.map((f) => (
            <div className="card feature" key={f.title}><div className="ico">{f.ico}</div><h3>{f.title}</h3><p>{f.text}</p></div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Priced in rupees, per institution</h2>
        <p className="sub">Many AI support agents bill in dollars per resolution, plus seats and minimums. Relay is a flat monthly plan in rupees, and free to self-host.</p>
      </section>

      <section className="section" id="pricing">
        <h2>Plans</h2>
        <div className="grid5">
          {plans.map((p) => (
            <div className={`card price ${p.featured ? 'featured' : ''}`} key={p.name}>
              <h3>{p.name}</h3>
              <div><span className="amount">{p.price}</span> <span className="muted">{p.note}</span></div>
              <ul>{p.items.map((i) => <li key={i}>{i}</li>)}</ul>
            </div>
          ))}
        </div>
        <h3 style={{ textAlign: 'center', marginTop: 24 }}>Add-ons</h3>
        <div className="grid2" style={{ maxWidth: 760, margin: '0 auto' }}>
          <div className="card pad stack"><strong>📞 AI telecalling · ₹1,999/month</strong><span className="small muted">Reminder, confirmation and follow-up calls in Indian languages; IVR for inbound calls with transfer to your front desk. Call minutes are billed by your own telephony account. 14-day free trial.</span></div>
          <div className="card pad stack"><strong>📷 Camera check-in · ₹2,999/month per site</strong><span className="small muted">Opt-in face matching at reception on your own premises. Video and face data never leave the building. 14-day free trial.</span></div>
        </div>
      </section>

      <section className="section" id="self-host">
        <h2>Self-host in one command</h2>
        <p className="sub">Postgres + pgvector, any S3-compatible storage, any OpenAI-compatible model server. No vendor lock-in.</p>
        <div className="card pad" style={{ maxWidth: 760, margin: '0 auto' }}>
          <pre>{`git clone ${REPO_URL} relay && cd relay
cp .env.example .env        # set RELAY_SECRET, optionally a model key
docker compose -f deploy/docker-compose.yml up -d
# → http://localhost:8787

# optional: local models with Ollama
docker compose -f deploy/docker-compose.yml --profile ollama up -d`}</pre>
        </div>
      </section>

      <section className="section" id="early-access">
        <h2>Request early access</h2>
        <p className="sub">We’ll set up your workspace, connect your WhatsApp number and load your FAQs with you.</p>
        <EarlyAccess />
      </section>

      <footer className="l-footer">
        Relay is open source (AGPL-3.0; widget SDK MIT). ·{' '}
        <Link to="/demo">Live demo</Link> · <a href={REPO_URL}>GitHub</a>
      </footer>
    </div>
  );
}
