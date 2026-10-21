import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, closeStream } from '../lib/api';
import { useSession } from '../lib/session';
import { Loading } from '../components/ui';
import { PatientChat } from './PatientChat';
import { patientSteps } from './steps';

function StepList({ at }: { at: number }) {
  return (
    <ol className="tour-steps">
      {patientSteps.map((s, i) => (
        <li key={s.id} className={i < at ? 'done' : i === at ? 'now' : ''}>
          <span>{i < at ? '✓' : i + 1}</span>
          <div><strong>{s.label}</strong><small>{s.why}</small></div>
        </li>
      ))}
    </ol>
  );
}

function TourNav() {
  return (
    <nav className="l-nav">
      <Link to="/" className="brandmark" style={{ padding: 0 }}><img src="/icon.svg" alt="" /> Relay</Link>
      <div className="links">
        <Link to="/tour/doctor">Doctor demo</Link>
        <Link className="btn primary" to="/signup">Start free</Link>
      </div>
    </nav>
  );
}

/** /tour/patient — the patient journey on the shared demo hospital, about 90 seconds. */
export function PatientTour() {
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  const onProgress = useCallback((n: number) => setAt(n), []);
  useEffect(() => {
    api<{ demoSiteKey: string | null }>('/api/public/config')
      .then((c) => (c.demoSiteKey ? setSiteKey(c.demoSiteKey) : setError('The demo hospital is not available on this server.')))
      .catch((e) => setError((e as Error).message));
  }, []);
  return (
    <div className="landing tour">
      <TourNav />
      <section className="section tour-grid">
        <div className="stack">
          <h1>Be the patient.</h1>
          <p className="lead muted">Tap the suggested reply each time. Everything is fictional; please don’t enter real details.</p>
          {error && <div className="error-box">{error}</div>}
          <StepList at={at} />
          {at >= patientSteps.length && (
            <div className="card pad stack">
              <strong>Now see what the doctor saw.</strong>
              <span className="small muted">Your own private copy of the hospital, signed in as Dr. Narmadha Vasu, with the patient chat beside it.</span>
              <Link className="btn primary" to="/tour/doctor">Open the doctor’s side →</Link>
            </div>
          )}
        </div>
        <PatientChat siteKey={siteKey} steps={patientSteps} title="Poonthalir Hospital" onProgress={onProgress} />
      </section>
    </div>
  );
}

/** /tour/doctor — no sign-up: claim a private sandbox, then open the doctor's Live desk with the patient chatbot docked. */
export function DoctorTour() {
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [waited, setWaited] = useState(0);
  useEffect(() => {
    // A ready sandbox is handed out at once; if none is ready, ask again every few seconds.
    let cancelled = false;
    let pollTimer: number | undefined;
    const started = Date.now();
    const attempt = async () => {
      if (cancelled) return;
      try {
        const r = await api<{ status: 'ready' | 'preparing'; retryAfterMs?: number }>('/api/auth/sandbox', { body: {} });
        if (cancelled) return;
        if (r.status === 'ready') {
          closeStream();
          await refresh();
          if (!cancelled) navigate('/app/desk?chat=open', { replace: true });
          return;
        }
        if (Date.now() - started > 120_000) throw new Error('Preparing a private hospital is taking longer than usual. Please try again in a minute.');
        setWaited(Math.round((Date.now() - started) / 1000));
        pollTimer = window.setTimeout(() => void attempt(), r.retryAfterMs ?? 3000);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };
    void attempt();
    return () => {
      cancelled = true;
      window.clearTimeout(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="auth"><div className="card stack">
        <h1>Sandbox unavailable</h1>
        <p className="muted">{error}</p>
        <Link className="btn primary" to="/">Back to the home page</Link>
      </div></div>
    );
  }
  return <Loading label={waited ? `Building your private hospital (${waited} s, usually under a minute)…` : 'Opening your private hospital…'} />;
}
