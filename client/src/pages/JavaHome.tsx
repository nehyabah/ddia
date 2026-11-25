import { Link, useNavigate } from "react-router-dom";
import { api, type JavaOverview } from "../api";
import { useLoad } from "../state";

const BLURB: Record<string, string> = {
  beginner: "Off‑by‑ones, == vs equals, integer division, reading your first stack traces.",
  intermediate: "Collections traps, equals/hashCode, exceptions, strings, BigDecimal and dates.",
  advanced: "Races, visibility, deadlocks, executors, streams, memory leaks and thread dumps.",
  expert: "Overflow, narrowing, erasure, init order and other puzzlers that bite seniors.",
};

export function JavaHome() {
  const nav = useNavigate();
  const { data, error } = useLoad(() => api.get<JavaOverview>("/java"), []);
  if (error) return <p className="err">{error}</p>;
  if (!data) return <div className="center">Loading…</div>;

  const total = data.levels.reduce((a, l) => a + l.count, 0);
  const play = (q: Record<string, string>) => nav(`/java/play?${new URLSearchParams(q)}`);

  return (
    <>
      {data.due > 0 && (
        <div className="banner">
          <div><strong>{data.due} Java {data.due === 1 ? "bug" : "bugs"} due</strong><br /><span className="small" style={{ opacity: .8 }}>Re‑solve them before they fade.</span></div>
          <button className="primary" onClick={() => play({ mode: "review" })}>Review</button>
        </div>
      )}
      <h2>Java debugging</h2>
      <p className="lede">
        {total} broken programs, beginner to expert. Read the bug report, tap the line you think is wrong, pick the root cause —
        then see the explanation, the fix and the debugging technique that would have found it.
      </p>
      {data.totals.answered > 0 && (
        <p className="small muted" style={{ marginTop: -10 }}>
          {data.totals.correct}/{data.totals.answered} solved · {data.totals.exact} bug lines pinpointed exactly
        </p>
      )}
      <div className="row" style={{ marginBottom: 18 }}>
        <button className="primary" style={{ marginTop: 0 }} onClick={() => play({})}>Mixed practice</button>
        <Link className="ghost" style={{ marginTop: 0, textDecoration: "none" }} to="/java/lessons">Debugging skills</Link>
        <Link className="ghost" style={{ marginTop: 0, textDecoration: "none" }} to="/java/all">All challenges</Link>
      </div>

      <div className="levels">
        {data.levels.map((l) => (
          <div key={l.id} className="level">
            <h3><span>{l.label}</span><span className="small muted">{l.tried}/{l.count} tried · {l.mastery}%</span></h3>
            <p className="small muted" style={{ margin: 0 }}>{BLURB[l.id]}</p>
            <div className="bar"><i style={{ width: `${l.mastery}%` }} /></div>
            <div className="chips">
              {l.topics.map((t) => (
                <button key={t.topic} className="topicbtn" onClick={() => play({ level: l.id, topic: t.topic })}>
                  {t.topic}<small>{t.count}</small>
                </button>
              ))}
            </div>
            <div className="row">
              <button className="primary" disabled={!l.count} onClick={() => play({ level: l.id })}>Practice {l.label.toLowerCase()}</button>
              {l.due > 0 && <button className="ghost" onClick={() => play({ level: l.id, mode: "review" })}>Review {l.due} due</button>}
              {l.lessons > 0 && <Link className="ghost" style={{ textDecoration: "none" }} to={`/java/lessons#${l.id}`}>Lessons {l.lessonsRead}/{l.lessons}</Link>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
