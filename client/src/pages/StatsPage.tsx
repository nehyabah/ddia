import { Link } from "react-router-dom";
import { api, type Stats } from "../api";
import { useLoad, useProfile } from "../state";

const BOX_LABELS = ["Missed", "1 day", "3 days", "1 week", "16 days", "35 days"];

export function StatsPage() {
  const { profile } = useProfile();
  const { data: s, error } = useLoad(() => api.get<Stats>("/stats"), []);
  if (error) return <p className="err">{error}</p>;
  if (!s || !profile) return <div className="center">Loading…</div>;

  // Heatmap: pad the front so columns are calendar weeks starting Sunday.
  const firstDow = new Date(s.days[0].day + "T00:00:00").getDay();
  const level = (xp: number) => (xp === 0 ? "" : xp < 50 ? "l1" : xp < 120 ? "l2" : xp < 250 ? "l3" : "l4");
  const activeDays = s.days.filter((d) => d.xp > 0).length;
  const maxForecast = Math.max(1, ...s.forecast.map((f) => f.n));
  const maxBox = Math.max(1, s.unseen, ...s.boxes);

  return (
    <>
      <h2>Your progress</h2>
      <p className="lede">Mastery comes from the spaced‑repetition boxes: a question counts fully once you've answered it right three times in a row.</p>

      <div className="kpis">
        <div className="kpi"><div className="v">{s.totals.learned}<span className="muted small">/{s.totals.questionsTotal}</span></div><div className="l">questions learned (box 3+)</div></div>
        <div className="kpi"><div className="v">{s.totals.accuracy ?? "–"}{s.totals.accuracy != null && "%"}</div><div className="l">accuracy over {s.totals.answered} answers</div></div>
        <div className="kpi"><div className="v">{s.totals.cardsSeen}<span className="muted small">/{s.totals.cardsTotal}</span></div><div className="l">concept cards read</div></div>
        <div className="kpi"><div className="v">{profile.streak}<span className="muted small"> best {profile.bestStreak}</span></div><div className="l">day streak</div></div>
      </div>

      <h3 className="section-h">Activity · last 16 weeks</h3>
      <div className="panel">
        <div className="heat">
          {Array.from({ length: firstDow }, (_, i) => <i key={`p${i}`} className="pad" />)}
          {s.days.map((d) => (
            <i key={d.day} className={level(d.xp)} title={`${d.day}: ${d.xp} XP, ${d.answered} answered${d.answered ? ` (${Math.round((d.correct / d.answered) * 100)}% right)` : ""}`} />
          ))}
        </div>
        <div className="legend">
          <span>{activeDays} active {activeDays === 1 ? "day" : "days"} · Less</span>
          <i style={{ background: "var(--surface2)", border: "1px solid var(--line)" }} /><i className="l1" /><i className="l2" /><i className="l3" /><i className="l4" />
          <span>More</span>
        </div>
      </div>

      <h3 className="section-h">Reviews coming due</h3>
      <div className="panel">
        <div className="cols">
          {s.forecast.map((f) => (
            <div key={f.label} className="c"><b>{f.n}</b><i style={{ height: `${(f.n / maxForecast) * 80}%` }} /><span>{f.label}</span></div>
          ))}
        </div>
        {s.forecast[0].n > 0 && <p className="small" style={{ marginBottom: 0 }}><Link to="/review">Review the {s.forecast[0].n} due now →</Link></p>}
      </div>

      <h3 className="section-h">Where your questions sit</h3>
      <div className="panel">
        <div className="cols">
          <div className="c"><b>{s.unseen}</b><i style={{ height: `${(s.unseen / maxBox) * 80}%`, background: "var(--line)" }} /><span>New</span></div>
          {s.boxes.map((n, b) => (
            <div key={b} className="c"><b>{n}</b><i className={b >= 3 ? "t" : ""} style={{ height: `${(n / maxBox) * 80}%`, ...(b === 0 ? { background: "var(--red)" } : {}) }} /><span>{BOX_LABELS[b]}</span></div>
          ))}
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>Each correct answer moves a question one box right and pushes its next review further out. A miss sends it back to the start.</p>
      </div>

      <h3 className="section-h">Chapter health</h3>
      <div className="panel hbars">
        {s.chapters.map((c) => (
          <Link key={c.id} to={`/chapter/${c.id}`} className="hbar" title={c.title}>
            <span className="lab">{c.label}</span>
            <span className="track"><i className={c.mastery < 80 ? "warn" : ""} style={{ width: `${c.mastery}%` }} /></span>
            <span className="val">{c.mastery}%{c.accuracy != null ? ` · ${c.accuracy}% acc` : ""}</span>
          </Link>
        ))}
      </div>

      <h3 className="section-h">Questions that keep tripping you up</h3>
      {s.weakest.length === 0 ? <p className="muted">Nothing yet — misses will show up here so you can target them.</p> : (
        <div className="list">
          {s.weakest.map((q) => (
            <div key={q.id} className="item">
              <div className="meta"><Link className="chip" to={`/chapter/${q.chapterId}`}>{q.chapterLabel}</Link><span>missed {q.lapses} of {q.reps}</span></div>
              <h4 style={{ marginTop: 6 }}>{q.prompt}</h4>
              <details className="reveal"><summary>Show answer</summary><p style={{ margin: "6px 0 0" }}><b>{q.answer}</b></p><p className="small muted" style={{ margin: "4px 0 0" }}>{q.explanation}</p></details>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
