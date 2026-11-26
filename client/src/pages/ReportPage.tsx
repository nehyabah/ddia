import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type WeeklyReport } from "../api";
import { useLoad, useProfile } from "../state";
import { Icon } from "../components/ui";

const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
const trend = (now: number, prev: number) => (prev === 0 ? null : Math.round(((now - prev) / prev) * 100));

export function ReportPage() {
  const { toast } = useProfile();
  const [weeksAgo, setWeeksAgo] = useState(0);
  const { data: r, error } = useLoad(() => api.get<WeeklyReport>(`/report?weeksAgo=${weeksAgo}`), [weeksAgo]);
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true);
    try {
      const x = await api.post<{ sentTo: string }>("/report/send", { weeksAgo });
      toast(`Report emailed to ${x.sentTo}`);
    } catch (e) { toast((e as Error).message); } finally { setSending(false); }
  }

  if (error) return <p className="err">{error}</p>;
  if (!r) return <div className="center">Loading…</div>;
  const t = r.totals;
  const maxM = Math.max(1, ...r.days.map((d) => d.minutes));
  const tA = trend(t.activeMinutes, t.prevActiveMinutes), tX = trend(t.xp, t.prevXp);
  const tr = (v: number | null) => v == null ? null : <span className={`trend ${v >= 0 ? "up" : "down"}`}>{v >= 0 ? "▲" : "▼"} {Math.abs(v)}%</span>;

  return (
    <>
      <Link className="back" to="/stats"><Icon name="back" size={16} />Stats</Link>
      <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Weekly report</h2>
        <div className="row" style={{ alignItems: "center" }}>
          <button className="iconbtn" onClick={() => setWeeksAgo((w) => w + 1)} aria-label="Previous week">‹</button>
          <span className="small muted" style={{ minWidth: 130, textAlign: "center" }}>{weeksAgo === 0 ? "This week" : weeksAgo === 1 ? "Last week" : r.range.label}</span>
          <button className="iconbtn" disabled={weeksAgo === 0} onClick={() => setWeeksAgo((w) => Math.max(0, w - 1))} aria-label="Next week">›</button>
        </div>
      </div>
      <p className="lede" style={{ marginTop: 6 }}>{r.range.label} · {t.daysActive}/7 days active · goal hit on {t.goalDays} {t.goalDays === 1 ? "day" : "days"}</p>

      <div className="kpis">
        <div className="kpi"><div className="v">{fmtMin(t.activeMinutes)} {tr(tA)}</div><div className="l">active on the platform</div></div>
        <div className="kpi"><div className="v">{t.xp} {tr(tX)}</div><div className="l">XP earned</div></div>
        <div className="kpi"><div className="v">{t.questions}</div><div className="l">DDIA answers{t.questionAccuracy != null ? ` · ${t.questionAccuracy}% right` : ""}</div></div>
        <div className="kpi"><div className="v">{t.javaSolvedNew}</div><div className="l">new Java bugs solved{t.javaAccuracy != null ? ` · ${t.javaAccuracy}%` : ""}</div></div>
        <div className="kpi"><div className="v">{t.puzzlesSolved}</div><div className="l">systems puzzles solved</div></div>
        <div className="kpi"><div className="v">{t.aiAvg != null ? `${t.aiAvg}/10` : "–"}</div><div className="l">avg written answer · {t.aiPassed}/{t.aiGraded} passed</div></div>
        <div className="kpi"><div className="v">{t.cardsRead}</div><div className="l">concept cards read</div></div>
        <div className="kpi"><div className="v">{t.streak}</div><div className="l">day streak · best {t.bestStreak}</div></div>
      </div>

      <h3 className="section-h">Time on the platform</h3>
      <div className="panel">
        <div className="cols">
          {r.days.map((d) => (
            <div key={d.day} className="c" title={`${d.day}: ${d.minutes} min, ${d.xp} XP`}>
              <b>{d.minutes ? fmtMin(d.minutes) : ""}</b>
              <i className="t" style={{ height: `${(d.minutes / maxM) * 80}%` }} />
              <span>{new Date(d.day + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" })}</span>
            </div>
          ))}
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>Counted only while the app is open and you've interacted in the last minute.</p>
      </div>

      {r.chapters.length > 0 && (<>
        <h3 className="section-h">Chapters you worked on</h3>
        <div className="panel hbars">
          {r.chapters.map((c) => (
            <div key={c.label} className="hbar" title={c.title}>
              <span className="lab">{c.label}</span>
              <span className="track"><i className={c.mastery < 80 ? "warn" : ""} style={{ width: `${c.mastery}%` }} /></span>
              <span className="val">{c.mastery}% · {c.accuracy}% acc</span>
            </div>
          ))}
        </div>
      </>)}

      <h3 className="section-h">Needs work</h3>
      <div className="panel">
        {r.needsWork.length ? <ul className="tidy">{r.needsWork.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="muted" style={{ margin: 0 }}>Nothing flagged this week.</p>}
      </div>

      <h3 className="section-h">Next steps</h3>
      <div className="panel">
        {r.nextSteps.length ? <ol className="tidy">{r.nextSteps.map((x, i) => <li key={i}>{x}</li>)}</ol> : <p className="muted" style={{ margin: 0 }}>You're on top of everything. 🎉</p>}
      </div>

      <div className="row" style={{ marginTop: 8 }}>
        <button className="primary" disabled={sending} onClick={send}><Icon name="notes" />{sending ? "Sending…" : r.user.email ? `Email this to ${r.user.email}` : "Email me this report"}</button>
        {!r.user.email && <Link className="ghost" to="/settings" style={{ textDecoration: "none" }}>Add your email</Link>}
      </div>
    </>
  );
}
