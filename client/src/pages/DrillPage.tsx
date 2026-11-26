import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Badge } from "../api";
import { shuffle, useProfile } from "../state";
import { useChapter } from "./Chapter";
import { GradeBox } from "../components/GradeBox";
import { Icon } from "../components/ui";

export function DrillPage() {
  const nav = useNavigate();
  const { reward } = useProfile();
  const { data: c, error } = useChapter();
  const [n, setN] = useState(0);
  const [answer, setAnswer] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [checked, setChecked] = useState<boolean[]>([]);
  const [graded, setGraded] = useState<{ covered: number; total: number; ratio: number } | null>(null);

  // Least-practised prompts first, computed once per chapter load.
  const order = useMemo(
    () => (c ? shuffle(c.drills).sort((a, b) => a.level - b.level) : []),
    [c?.id], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const d = order[n];
  const [gate, setGate] = useState<{ best: number | null; passScore: number; passed: boolean } | null>(null);
  useEffect(() => {
    if (!d) return;
    setGate(null);
    api.get<{ best: number | null; passScore: number; passed: boolean }>(`/ai/best?kind=drill&id=${d.id}`).then(setGate).catch(() => setGate({ best: null, passScore: 7, passed: true }));
  }, [d?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setAnswer(""); setRevealed(false); setGraded(null);
    setChecked(d ? d.points.map(() => false) : []);
  }, [d?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function grade() {
    if (!d) return;
    const covered = checked.filter(Boolean).length;
    const r = await api.post<{ xp: number; ratio: number; covered: number; total: number; newBadges: Badge[] }>(`/drills/${d.id}`, { covered, answer });
    setGraded(r);
    reward(r.xp, r.newBadges);
  }

  if (error) return <p className="err">{error}</p>;
  if (!c) return <div className="center">Loading…</div>;
  if (!d) return <p>This chapter has no drills. <Link to={`/chapter/${c.id}`}>Back</Link></p>;

  const last = n === order.length - 1;
  return (
    <>
      <Link className="back" to={`/chapter/${c.id}`}><Icon name="back" size={16} />{c.label}</Link>
      <div className="qhead"><span>Prompt {n + 1} of {order.length}</span><span>Say it out loud or type it</span></div>
      <div className="qcard">
        <p className="qtext">{d.prompt}</p>
        <textarea className="field" rows={7} placeholder="Your answer…" value={answer} onChange={(e) => setAnswer(e.target.value)} disabled={!!graded} />
        {d.lastAnswer && !revealed && (
          <details className="reveal"><summary>Your previous answer{d.lastRatio != null ? ` (${Math.round(d.lastRatio * 100)}%)` : ""}</summary>
            <p className="small" style={{ whiteSpace: "pre-wrap" }}>{d.lastAnswer}</p>
          </details>
        )}
        <GradeBox kind="drill" id={d.id} answer={answer} onAnswer={setAnswer} hideInput
          onGraded={(g) => setGate((x) => ({ passScore: x?.passScore ?? 7, best: Math.max(x?.best ?? 0, g.score), passed: Math.max(x?.best ?? 0, g.score) >= (x?.passScore ?? 7) }))} />
        {gate && !gate.passed && <p className="small muted" style={{ marginTop: 8 }}><Icon name="lock" size={13} /> Score {gate.passScore}/10 with Claude to unlock the next prompt{gate.best != null ? ` (best so far: ${gate.best}/10)` : ""}.</p>}
        {!revealed ? (
          <button className="ghost" onClick={() => setRevealed(true)}>Self-check key points</button>
        ) : (
          <>
            <div className="explain">
              <b>Did you cover these?</b>
              <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
                {d.points.map((p, j) => (
                  <label key={j} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <input type="checkbox" checked={checked[j] ?? false} disabled={!!graded}
                      onChange={(e) => setChecked((cs) => cs.map((x, k) => (k === j ? e.target.checked : x)))} />
                    <span>{p}</span>
                  </label>
                ))}
              </div>
            </div>
            {!graded ? (
              <div className="row"><button className="primary" onClick={grade}>Score my answer</button></div>
            ) : (
              <>
                <p style={{ marginTop: 12 }}>
                  <b>{graded.covered}/{graded.total} points.</b>{" "}
                  {graded.ratio >= 0.8 ? "Interview‑ready." : graded.ratio >= 0.5 ? "Close. Rehearse the missing points." : "Revisit the cards for this topic, then try again."}
                </p>
                <button className="primary" disabled={!gate?.passed} onClick={() => (last ? nav(`/chapter/${c.id}`) : setN(n + 1))}>{!gate?.passed ? `Score ${gate?.passScore ?? 7}/10 to continue` : last ? "Finish" : "Next prompt"}</button>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
