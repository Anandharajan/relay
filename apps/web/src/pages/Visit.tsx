import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Loading } from '../components/ui';

/** Patient-facing strings: Tamil and English (other languages fall back to English). */
const L = {
  en: {
    title: 'Your visit', token: 'Token', with: 'with', checkin: "I've arrived, check me in", checkedIn: 'Checked in', ahead: 'ahead of you', wait: 'Estimated wait',
    min: 'min', now: "It's your turn: please go to the consultation room", done: 'Visit completed', notToday: 'Check-in opens on the day of your visit.',
    prep: 'Messages from the hospital', tests: 'Tests your doctor asked for', upload: 'Upload a report', uploadHint: 'PDF or photo of a lab report, prescription or scan. Your doctor sees it before your visit.',
    uploaded: 'Uploaded. Thank you!', camera: 'Faster check-in with the reception camera', cameraHint: 'Optional. If you agree, the camera at reception recognises you on arrival and checks you in. Your face data stays on the hospital premises and is deleted after your visit. You can withdraw anytime.',
    agree: 'I agree', withdraw: 'Withdraw consent', rate: 'How was your visit?', rateDoctor: 'Doctor', rateAssistant: 'Assistant (WhatsApp/chat)', send: 'Send', thanks: 'Thank you for your feedback!',
    emergency: 'Emergency? Call', cancelled: 'This appointment was cancelled.', noShow: 'We missed you. Reply "appointment" on WhatsApp to book again.', updated: 'updates every 20 seconds',
  },
  ta: {
    title: 'உங்கள் வருகை', token: 'டோக்கன்', with: '', checkin: 'நான் வந்துவிட்டேன், செக்-இன் செய்', checkedIn: 'செக்-இன் ஆனது', ahead: 'பேர் உங்களுக்கு முன்', wait: 'காத்திருப்பு நேரம் (சுமார்)',
    min: 'நிமிடம்', now: 'உங்கள் முறை வந்துவிட்டது: ஆலோசனை அறைக்குச் செல்லவும்', done: 'வருகை முடிந்தது', notToday: 'உங்கள் சந்திப்பு நாளில் செக்-இன் திறக்கும்.',
    prep: 'மருத்துவமனையிலிருந்து செய்திகள்', tests: 'மருத்துவர் பரிந்துரைத்த பரிசோதனைகள்', upload: 'அறிக்கையைப் பதிவேற்றவும்', uploadHint: 'பரிசோதனை அறிக்கை, மருந்துச் சீட்டு அல்லது ஸ்கேன் PDF / புகைப்படம். வருகைக்கு முன் மருத்துவர் பார்ப்பார்.',
    uploaded: 'பதிவேற்றப்பட்டது. நன்றி!', camera: 'வரவேற்பு கேமரா மூலம் விரைவான செக்-இன்', cameraHint: 'விருப்பத்தேர்வு. நீங்கள் ஒப்புக்கொண்டால், வரவேற்பில் உள்ள கேமரா உங்களை அடையாளம் கண்டு செக்-இன் செய்யும். உங்கள் முக தரவு மருத்துவமனையிலேயே இருக்கும், வருகைக்குப் பின் நீக்கப்படும். எப்போது வேண்டுமானாலும் திரும்பப் பெறலாம்.',
    agree: 'ஒப்புக்கொள்கிறேன்', withdraw: 'ஒப்புதலைத் திரும்பப் பெறு', rate: 'உங்கள் வருகை எப்படி இருந்தது?', rateDoctor: 'மருத்துவர்', rateAssistant: 'உதவியாளர் (வாட்ஸ்அப்/அரட்டை)', send: 'அனுப்பு', thanks: 'உங்கள் கருத்துக்கு நன்றி!',
    emergency: 'அவசரமா? அழைக்கவும்', cancelled: 'இந்தச் சந்திப்பு ரத்து செய்யப்பட்டது.', noShow: 'நீங்கள் வரவில்லை. மீண்டும் முன்பதிவு செய்ய வாட்ஸ்அப்பில் "appointment" என்று அனுப்பவும்.', updated: '20 வினாடிக்கு ஒருமுறை புதுப்பிக்கப்படும்',
  },
};

function Stars({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="row" style={{ gap: 4 }} role="radiogroup" aria-label={label}>
      <span className="small" style={{ minWidth: 150 }}>{label}</span>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" className={`star ${n <= value ? 'on' : ''}`} aria-label={`${n}`} onClick={() => onChange(n)}>★</button>
      ))}
    </div>
  );
}

export function Visit() {
  const { code } = useParams();
  const [d, setD] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<'en' | 'ta'>('en');
  const [note, setNote] = useState<string | null>(null);
  const [rating, setRating] = useState({ rating: 0, aiRating: 0, comment: '' });
  const fileRef = useRef<HTMLInputElement>(null);
  const load = () =>
    api(`/api/public/visit/${code}`).then(
      (x) => {
        setD(x);
        setError(null);
      },
      (e) => setError(e.message),
    );
  useEffect(() => {
    void load().then(() => {});
    const t = window.setInterval(load, 20_000);
    return () => window.clearInterval(t);
  }, [code]);
  useEffect(() => {
    if (d?.client?.lang === 'ta') setLang('ta');
  }, [d?.client?.lang]);
  if (error && !d) return <div className="visit"><div className="card pad">{error}</div></div>;
  if (!d) return <Loading />;
  const t = L[lang];
  const v = d.visit;
  const brand = d.org.brandColor;
  const when = new Date(v.startsAt).toLocaleString(lang === 'ta' ? 'ta-IN' : 'en-IN', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
  const doCheckin = async () => {
    try {
      const r = await api(`/api/public/visit/${code}/checkin`, { body: {} });
      setNote(`${t.checkedIn}: ${t.token} ${r.token}`);
      await load();
    } catch (e) {
      setNote((e as Error).message);
    }
  };
  const upload = async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    try {
      await api(`/api/public/visit/${code}/records`, { form });
      setNote(t.uploaded);
      setTimeout(load, 2500);
    } catch (e) {
      setNote((e as Error).message);
    }
  };
  const consent = async (optIn: boolean) => {
    await api(`/api/public/visit/${code}/camera-consent`, { body: { optIn } }).catch(() => {});
    await load();
  };
  const rate = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api(`/api/public/visit/${code}/rating`, { body: { rating: rating.rating, aiRating: rating.aiRating || undefined, comment: rating.comment } });
      setNote(t.thanks);
      await load();
    } catch (err) {
      setNote((err as Error).message);
    }
  };

  return (
    <div className="visit" style={{ ['--vbrand' as any]: brand }}>
      <header className="visit-head">
        <div>
          <strong>{d.org.name}</strong>
          <div className="small">{t.title}</div>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <button className={`btn sm ${lang === 'ta' ? 'primary' : ''}`} onClick={() => setLang('ta')}>தமிழ்</button>
          <button className={`btn sm ${lang === 'en' ? 'primary' : ''}`} onClick={() => setLang('en')}>EN</button>
        </div>
      </header>

      <div className="card pad stack visit-main">
        <div className="row between">
          <div>
            <div className="small muted">{d.staff?.specialty}</div>
            <h2>{d.staff?.name}</h2>
            <div>{when}</div>
          </div>
          <div className="token">
            <span>{t.token}</span>
            <strong>{v.token}</strong>
          </div>
        </div>

        {v.status === 'in_progress' && <div className="banner ok">{t.now}</div>}
        {v.status === 'done' && <div className="banner ok">✅ {t.done}</div>}
        {v.status === 'cancelled' && <div className="banner">{t.cancelled}</div>}
        {v.status === 'no_show' && <div className="banner">{t.noShow}</div>}

        {d.live && v.status === 'checked_in' && (
          <div className="eta">
            <div><span className="big">{d.live.ahead}</span> {t.ahead}</div>
            <div><span className="small muted">{t.wait}</span><span className="big">~{d.live.etaMin}</span> {t.min}</div>
            <div className="small muted">{t.updated}</div>
          </div>
        )}
        {v.status === 'booked' && (v.today ? <button className="btn primary lg" onClick={doCheckin}>{t.checkin}</button> : <div className="small muted">{t.notToday}</div>)}
        {note && <div className="banner">{note}</div>}
      </div>

      {v.status === 'done' && !d.rated && (
        <form className="card pad stack" onSubmit={rate}>
          <h3>{t.rate}</h3>
          <Stars label={t.rateDoctor} value={rating.rating} onChange={(n) => setRating({ ...rating, rating: n })} />
          <Stars label={t.rateAssistant} value={rating.aiRating} onChange={(n) => setRating({ ...rating, aiRating: n })} />
          <textarea className="textarea" rows={2} value={rating.comment} onChange={(e) => setRating({ ...rating, comment: e.target.value })} />
          <button className="btn primary" disabled={!rating.rating}>{t.send}</button>
        </form>
      )}

      {d.investigations.length > 0 && (
        <div className="card pad stack">
          <h3>{t.tests}</h3>
          {d.investigations.map((i: any, n: number) => (
            <div key={n} className="row between">
              <span>{i.status === 'resulted' ? '✅' : '⬜'} {i.label}{i.due_by ? ` · ${new Date(i.due_by).toLocaleDateString(lang === 'ta' ? 'ta-IN' : 'en-IN')}` : ''}</span>
              <span className="small muted">{i.instructions}</span>
            </div>
          ))}
        </div>
      )}

      {d.messages.length > 0 && (
        <div className="card pad stack">
          <h3>{t.prep}</h3>
          {d.messages.map((m: any, n: number) => (
            <div key={n} className="outbox-item small" style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
          ))}
        </div>
      )}

      {d.org.vertical === 'healthcare' && ['booked', 'checked_in'].includes(v.status) && (
        <div className="card pad stack">
          <h3>{t.upload}</h3>
          <p className="small muted">{t.uploadHint}</p>
          <button className="btn" onClick={() => fileRef.current?.click()}>📎 {t.upload}</button>
          <input ref={fileRef} type="file" hidden accept=".pdf,.jpg,.jpeg,.png,.heic,.webp,.docx" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          {d.uploads.map((u: any, n: number) => <div key={n} className="small">📄 {u.title} · {u.status}</div>)}
        </div>
      )}

      {d.org.cameraCheckin && ['booked'].includes(v.status) && (
        <div className="card pad stack">
          <h3>{t.camera}</h3>
          <p className="small muted">{t.cameraHint}</p>
          {d.client.cameraOptIn ? <button className="btn" onClick={() => consent(false)}>{t.withdraw}</button> : <button className="btn" onClick={() => consent(true)}>{t.agree}</button>}
        </div>
      )}

      {d.org.vertical === 'healthcare' && (
        <p className="small muted" style={{ textAlign: 'center' }}>
          {t.emergency} <a href={`tel:${d.org.emergencyNumber}`}>{d.org.emergencyNumber}</a>
        </p>
      )}
    </div>
  );
}

/** Reception QR: one printed code per location. */
export function Checkin() {
  const { siteKey } = useParams();
  const [org, setOrg] = useState<any | null>(null);
  const [f, setF] = useState({ code: '', phoneLast4: '', token: '' });
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api(`/api/public/checkin/${siteKey}`).then(setOrg, (e) => setError(e.message));
  }, [siteKey]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const body = f.code ? { code: f.code.trim() } : { phoneLast4: f.phoneLast4, token: Number(f.token) };
      setResult(await api(`/api/public/checkin/${siteKey}`, { body }));
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <div className="visit">
      <header className="visit-head"><strong>{org?.name ?? '…'}</strong><span className="small">செக்-இன் · Check-in</span></header>
      {result ? (
        <div className="card pad stack visit-main">
          <h2>✅ செக்-இன் ஆனது · Checked in</h2>
          <div className="token"><span>Token</span><strong>{result.token}</strong></div>
          <div className="eta"><div><span className="big">{result.ahead}</span> ahead · முன்</div><div><span className="big">~{result.etaMin}</span> min</div></div>
          <a className="btn primary" href={`/v/${result.code}`}>Live waiting time · நேரடி காத்திருப்பு</a>
        </div>
      ) : (
        <form className="card pad stack visit-main" onSubmit={submit}>
          <p>உங்கள் வருகைக் குறியீட்டை உள்ளிடவும் (உறுதிப்படுத்தல் செய்தியில் உள்ளது). Enter the visit code from your confirmation message.</p>
          <input className="input" placeholder="Visit code, e.g. AB12CD" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
          <div className="small muted">அல்லது · or</div>
          <div className="row">
            <input className="input" placeholder="Phone last 4 digits" inputMode="numeric" value={f.phoneLast4} onChange={(e) => setF({ ...f, phoneLast4: e.target.value })} />
            <input className="input" placeholder="Token no." inputMode="numeric" value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} />
          </div>
          {error && <div className="error-box">{error}</div>}
          <button className="btn primary lg">Check in · செக்-இன்</button>
        </form>
      )}
    </div>
  );
}
