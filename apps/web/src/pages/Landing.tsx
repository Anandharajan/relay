import { Link } from 'react-router-dom';
import { useSession } from '../lib/session';
import { REPO_URL } from '../lib/links';

const features = [
  { ico: '💬', title: 'WhatsApp + web chat', text: 'One AI agent on the channel your customers already use. Web widget is a single script tag; WhatsApp Cloud API connects in minutes.' },
  { ico: '🗣️', title: 'Answers in their language', text: 'Hindi, Kannada, Tamil, Telugu and more — detected automatically and answered from your help content with citations.' },
  { ico: '👥', title: 'Multiplayer inbox', text: 'AI and humans work the same thread. Approve or edit AI drafts in one tap, @AI inside internal notes, see who is viewing what.' },
  { ico: '🧠', title: 'Learns from your team', text: 'Every edited draft becomes knowledge. Low-confidence questions escalate with a suggested answer instead of a guess.' },
  { ico: '⚡', title: 'Actions with a safety net', text: 'Order lookups, cancellations and refunds via your APIs. Sensitive actions need a human to verify before anything happens.' },
  { ico: '🩹', title: 'Self-healing integrations', text: 'When your order API changes shape, Relay detects the schema drift and proposes the fixed mapping for one-click approval.' },
  { ico: '🧪', title: 'Simulations before go-live', text: 'Run 50 test questions through the real pipeline and see the pass rate, answers and sources before customers do.' },
  { ico: '🔐', title: 'DPDP-ready by default', text: 'PII is redacted before any LLM call. Consent log, retention policy, per-customer export/erase and a full audit trail.' },
  { ico: '🔑', title: 'BYOK or fully local', text: 'Bring your Claude, OpenAI or Gemini key — or run open-weight models on Ollama. Works with no LLM at all, for free.' },
];

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
          <a href="#self-host" className="hide-sm">Self-host</a>
          <a href={REPO_URL} className="hide-sm">GitHub</a>
          {me ? (
            <Link className="btn primary" to="/app">Open dashboard</Link>
          ) : (
            <>
              <Link to="/login">Sign in</Link>
              <Link className="btn primary" to="/signup">Start free</Link>
            </>
          )}
        </div>
      </nav>

      <header className="hero">
        <span className="pill">Made for India · Open source · BYOK · Self-hostable</span>
        <h1>
          AI support for the <em>next billion</em> customers
        </h1>
        <p className="lead">
          Relay resolves support conversations on WhatsApp and web chat — in your customers' language — grounded in your help content, working alongside your team. Fin-style resolution, at a price small businesses can actually afford.
        </p>
        <div className="row wrap" style={{ justifyContent: 'center' }}>
          <Link className="btn primary lg" to="/demo">Try the live demo →</Link>
          <Link className="btn lg" to="/signup">Create a free workspace</Link>
        </div>
        <div className="card chat-mock" aria-label="Example conversation">
          <div className="q">डिलीवरी में कितने दिन लगते हैं?</div>
          <div className="a">
            मेट्रो शहरों में डिलीवरी 2-3 कार्यदिवस और बाकी भारत में 4-6 कार्यदिवस में होती है।
            <div className="src">Source: सहायता केंद्र · confidence 98%</div>
          </div>
          <div className="q">Where is my order KC-1042?</div>
          <div className="a">
            Order KC-1042 (Filter Coffee Kit) is out for delivery with Blue Dart, expected Friday.
            <div className="src">Action: Order status · 120 ms</div>
          </div>
        </div>
      </header>

      <section className="section" id="features">
        <h2>Everything Fin does, built for WhatsApp-first businesses</h2>
        <p className="sub">For D2C brands, clinics, coaching institutes and local services that support customers in Hindi, Kannada and Tamil — on a tight budget.</p>
        <div className="grid3">
          {features.map((f) => (
            <div className="card feature" key={f.title}>
              <div className="ico">{f.ico}</div>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Priced for India, not Silicon Valley</h2>
        <p className="sub">Fin charges $0.99 per resolution with a monthly minimum. Relay's overage is about ₹5 (~$0.06) — roughly 16× cheaper — and free if you self-host.</p>
        <div className="card table-wrap" style={{ maxWidth: 760, margin: '0 auto' }}>
          <table className="table compare">
            <thead>
              <tr><th></th><th>Relay</th><th>Fin by Intercom</th></tr>
            </thead>
            <tbody>
              <tr><td>Price per AI resolution</td><td className="yes">~₹5 (~$0.06)</td><td>$0.99</td></tr>
              <tr><td>Monthly minimum</td><td className="yes">None (free tier)</td><td>50 resolutions + seats</td></tr>
              <tr><td>Open source &amp; self-hostable</td><td className="yes">Yes (AGPL)</td><td className="no">No</td></tr>
              <tr><td>Bring your own LLM key / local models</td><td className="yes">Yes</td><td className="no">—</td></tr>
              <tr><td>INR billing with UPI Autopay</td><td className="yes">Yes</td><td className="no">—</td></tr>
              <tr><td>Works with no LLM at all</td><td className="yes">Yes (extractive mode)</td><td className="no">—</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="section" id="pricing">
        <h2>Simple pricing</h2>
        <p className="sub">Start free. Upgrade when the AI is resolving real conversations.</p>
        <div className="grid4">
          {[
            { name: 'Open Source', price: 'Free', note: 'self-host', items: ['Everything', 'Your servers, your data', 'Docker Compose in one command'] },
            { name: 'Cloud Free', price: '₹0', note: '/month', items: ['1 site', '100 AI conversations/mo', 'Unlimited with your own key'] },
            { name: 'Starter', price: '₹999', note: '/month', items: ['1,000 resolutions', 'Relay-provided model', 'WhatsApp channel', 'Actions'], featured: true },
            { name: 'Growth', price: '₹3,999', note: '/month', items: ['5,000 resolutions', 'Actions & simulations', '5 seats', '~₹5 per extra resolution'] },
          ].map((p) => (
            <div className={`card price ${p.featured ? 'featured' : ''}`} key={p.name}>
              <h3>{p.name}</h3>
              <div>
                <span className="amount">{p.price}</span> <span className="muted">{p.note}</span>
              </div>
              <ul>{p.items.map((i) => <li key={i}>{i}</li>)}</ul>
            </div>
          ))}
        </div>
      </section>

      <section className="section" id="self-host">
        <h2>Self-host in one command</h2>
        <p className="sub">Postgres + pgvector, any S3-compatible storage, any OpenAI-compatible model server. No vendor lock-in.</p>
        <div className="card pad" style={{ maxWidth: 760, margin: '0 auto' }}>
          <pre>{`git clone ${REPO_URL} relay && cd relay
cp .env.example .env        # set RELAY_SECRET, optionally a model key
docker compose -f deploy/docker-compose.yml up -d
# → http://localhost:8787   (add --profile ollama for local models)`}</pre>
        </div>
      </section>

      <footer className="l-footer">
        Relay is open source (AGPL-3.0; widget SDK MIT). Made for the next billion customers. ·{' '}
        <Link to="/demo">Live demo</Link> · <a href={REPO_URL}>GitHub</a>
      </footer>
    </div>
  );
}
