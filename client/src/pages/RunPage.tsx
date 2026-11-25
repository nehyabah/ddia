import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type AnswerResult, type Run, type RunMode } from "../api";
import { shuffle, useProfile } from "../state";
import { Icon, confetti } from "../components/ui";

export function RunPage({ mode }: { mode: RunMode }) {
  const { id } = useParams();
  const nav = useNavigate();
  const { reward, refresh } = useProfile();
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [lives, setLives] = useState<number | null>(null);
  const [combo, setCombo] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [showSummary, setShowSummary] = useState(false);
  const [shake, setShake] = useState(false);
  const busy = useRef(false);
  const nextBtn = useRef<HTMLButtonElement>(null);

  const backTo = mode === "review" ? "/" : `/chapter/${id}`;

  useEffect(() => {
    let cancelled = false;
    setRun(null); setError(null); setN(0); setPicked(null); setResult(null); setCombo(0); setShowSummary(false);
    api.post<Run>("/runs", mode === "review" ? { mode } : { mode, chapterId: Number(id) })
      .then((r) => { if (!cancelled) { setRun(r); setLives(r.lives); } })
      .catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [mode, id, attempt]);

  const q = run?.questions[n];
  const order = useMemo(() => (q ? shuffle(q.options.map((t, k) => ({ t, k }))) : []), [q]);

  async function choose(k: number) {
    if (!run || !q || result || busy.current) return;
    busy.current = true;
    setPicked(k);
    try {
      const r = await api.post<AnswerResult>(`/runs/${run.runId}/answer`, { questionId: q.id, choice: k });
      setResult(r);
      setLives(r.lives);
      setCombo(r.combo);
      if (r.correct && r.combo > 0 && r.combo % 5 === 0) confetti(50);
      if (!r.correct) { setShake(true); setTimeout(() => setShake(false), 450); }
      if (r.summary && ((run.mode === "boss" && (r.lives ?? 0) > 0) || (run.mode === "quiz" && r.summary.correct === r.summary.total))) setTimeout(() => confetti(120), 300);
      reward(r.xp + (r.summary?.bonus ?? 0), r.newBadges);
      setTimeout(() => nextBtn.current?.focus(), 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busy.current = false;
    }
  }

  function next() {
    if (!result) return;
    if (result.finished) { setShowSummary(true); return; }
    setN((x) => x + 1);
    setPicked(null);
    setResult(null);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!result) {
        const num = Number(e.key);
        if (num >= 1 && num <= order.length) choose(order[num - 1].k);
      } else if (e.key === "Enter" && document.activeElement !== nextBtn.current) {
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (error) {
    return (
      <>
        <Link className="back" to={backTo}>← Back</Link>
        <div className="qcard summary">
          <p className="qtext">{error}</p>
          {mode === "review" && <p className="muted">Questions you answer in quiz runs get scheduled here: misses come back in ~10 minutes, hits after 1, 3, 7, 16 and 35 days.</p>}
          <button className="primary" onClick={() => nav(backTo)}>{mode === "review" ? "Back to the map" : "Back to chapter"}</button>
        </div>
      </>
    );
  }
  if (!run || !q) return <div className="center">Loading…</div>;

  const s = showSummary ? result?.summary : null;
  if (s) {
    return (
      <div className="qcard summary">
        <div className={`trophy ${s.correct === s.answered ? "" : "cool"}`}><Icon name={s.correct === s.answered ? "trophy" : "sparkle"} /></div>
        <span className="bignum">{s.correct}/{s.answered}</span>
        <p className="qtext" style={{ marginTop: 10 }}>{s.message}</p>
        <p className="muted">+{s.xp} XP this run{s.bonus ? ` (incl. +${s.bonus} bonus)` : ""}{s.mastery != null ? ` · node health now ${s.mastery}%` : ""}</p>
        <div className="row">
          <button className="primary" onClick={() => { refresh(); setAttempt((a) => a + 1); }}>
            {mode === "boss" ? "Fight again" : mode === "review" ? "Keep reviewing" : "Run again"}
          </button>
          <button className="ghost" onClick={() => nav(backTo)}>{mode === "review" ? "Back to the map" : "Back to chapter"}</button>
        </div>
      </div>
    );
  }

  const title = mode === "boss" ? "Boss" : mode === "review" ? "Review" : "Question";
  return (
    <>
      <Link className="back" to={backTo}><Icon name="x" size={16} />Quit run</Link>
      <div className="runbar"><i style={{ width: `${((n + (result ? 1 : 0)) / run.questions.length) * 100}%` }} /></div>
      <div className="qhead">
        <span>{title} {n + 1} / {run.questions.length}{mode === "review" ? ` · ${q.chapterLabel}` : ""}</span>
        <span>
          {mode === "boss" && lives != null
            ? <span className="hearts">{"❤️".repeat(lives)}{"🖤".repeat(3 - lives)}</span>
            : combo >= 2 ? <span key={combo} className="combo"><Icon name="flame" />×{combo}</span> : null}
        </span>
      </div>
      <div className={`qcard ${shake ? "shake" : ""}`}>
        <p className="qtext">{q.prompt}</p>
        <div className="opts">
          {order.map((o, j) => {
            const cls = result ? (o.k === result.answer ? "right" : o.k === picked ? "wrong" : "") : "";
            return (
              <button key={o.k} className={`opt ${cls}`} disabled={!!result} onClick={() => choose(o.k)}>
                <span className="k">{j + 1}</span><span className="ot">{o.t}</span>
              </button>
            );
          })}
        </div>
        {result && (
          <>
            <div className={`explain ${result.correct ? "" : "bad"}`}><b><Icon name={result.correct ? "check" : "x"} />{result.correct ? "Correct" : "Not quite"}{result.xp > 0 ? ` · +${result.xp} XP` : ""}</b>{result.explanation}</div>
            <button ref={nextBtn} className="primary" onClick={next}>{result.finished ? "See results" : "Next question"}</button>
          </>
        )}
        {!result && <p className="small muted kbdhint" style={{ marginTop: 14 }}>Press <kbd>1</kbd>–<kbd>{order.length}</kbd> to answer, <kbd>Enter</kbd> to continue.</p>}
      </div>
    </>
  );
}
