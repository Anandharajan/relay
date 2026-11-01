import { useEffect } from "react";
import { Link } from "react-router-dom";
import "./voice.css";
export function VoiceLanding() {
  useEffect(() => {
    document.title = "Relay Voice: your knowledge, your voice";
  }, []);
  return (
    <main className="vd vd-landing">
      <nav>
        <Link to="/voice">◉ Relay Voice</Link>
        <Link className="btn" to="/login">
          Sign in →
        </Link>
      </nav>
      <div className="vd-eyebrow">A VOICE WORKSPACE FOR EVERY PROFESSIONAL</div>
      <h1>
        Less typing.
        <br />
        More <span>you.</span>
      </h1>
      <p className="vd-lead">
        Ask about your client’s files. Review a clear answer.
        <br />
        Reply in your own voice.
      </p>
      <Link className="vd-primary" to="/app/voice">
        Open your voice desk ↗
      </Link>
      <div className="vd-landing-grid">
        {[
          [
            "01",
            "Bring the context",
            "Upload a lesson, policy, client brief or document. Keep each client’s knowledge together.",
          ],
          [
            "02",
            "Ask out loud",
            "Record a question or type it. Your agent retrieves relevant passages and prepares a sourced draft.",
          ],
          [
            "03",
            "Make it yours",
            "Review, play on your phone, and download the reply in your authorized cloned voice.",
          ],
        ].map(([n, t, d]) => (
          <section className="vd-card" key={n}>
            <div className="vd-eyebrow">{n}</div>
            <h2>{t}</h2>
            <p>{d}</p>
          </section>
        ))}
      </div>
      <p>For educators · care teams · HR · advisors · service businesses</p>
      <small>
        Voice cloning requires a connected speech engine and your explicit
        permission. High-impact replies require review.
      </small>
    </main>
  );
}
