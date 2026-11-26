import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, type PuzzleCheck, type PuzzleReveal, type PuzzleTrack, type PuzzleView } from "../api";
import { useLoad, useProfile } from "../state";
import { Icon, Ring, confetti, type IconName } from "../components/ui";
import { Md, highlight } from "../components/CodeView";
import { GradeBox, type Grade } from "../components/GradeBox";

const TRACK_ICON: Record<string, IconName> = { concurrency: "layers", resilience: "review", distributed: "logo" };
const TRACK_BLURB: Record<string, string> = {
  concurrency: "Locks, volatile, CAS, executors, latches and semaphores, CompletableFuture, the memory model.",
  resilience: "Token buckets and sliding windows, backoff with jitter, circuit breakers, idempotency, retryable writes.",
  distributed: "Consistent hashing, quorums, Raft-style elections, clocks, causal sessions, outbox and change streams.",
};
const KIND_LABEL = { parsons: "Arrange the lines", blanks: "Fill the blanks", theory: "Explain it" } as const;

/* ---------- hub ---------- */

export function PuzzlesHome() {
  const nav = useNavigate();
  const { data, error } = useLoad(() => api.get<{ tracks: PuzzleTrack[]; passScore: number }>("/puzzles"), []);
  if (error) return <p className="err">{error}</p>;
  if (!data) return <div className="center">Loading…</div>;
  const total = data.tracks.reduce((a, t) => a + t.count, 0), solved = data.tracks.reduce((a, t) => a + t.solved, 0);
  const play = (q: Record<string, string>) => nav(`/puzzles/play?${new URLSearchParams(q)}`);
  return (
    <>
      <h2>Systems puzzles</h2>
      <p className="lede">
        MongoDB‑style interview problems without writing code from scratch: arrange the lines of a working solution, fill the
        blanks, or explain the idea and get it reviewed ({data.passScore}/10 to pass). {solved}/{total} solved.
      </p>
      <div className="levels">
        {data.tracks.map((t) => {
          const pct = t.count ? Math.round((t.solved / t.count) * 100) : 0;
          return (
            <div key={t.id} className="level">
              <div className="lvhead">
                <Ring value={pct} size={52} stroke={6}>{pct}%</Ring>
                <div className="t">
                  <h3><Icon name={TRACK_ICON[t.id]} size={18} /> {t.label} <span className="chip">{t.solved}/{t.count} solved</span></h3>
                  <p className="small muted" style={{ margin: "2px 0 0" }}>{TRACK_BLURB[t.id]}</p>
                </div>
              </div>
              {t.count === 0 ? <p className="small muted">Coming soon.</p> : (
                <>
                  <div className="chips">
                    {t.topics.map((tp) => (
                      <button key={tp.topic} className={`topicbtn ${tp.solved === tp.count ? "done" : ""}`} onClick={() => play({ track: t.id, topic: tp.topic })}>
                        {tp.solved === tp.count && <Icon name="check" size={13} />}{tp.topic}<small>{tp.solved}/{tp.count}</small>
                      </button>
                    ))}
                  </div>
                  <div className="row"><button className="primary" onClick={() => play({ track: t.id })}>{t.solved ? "Continue" : "Start"} {t.label.toLowerCase()}</button></div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ---------- play ---------- */

export function PuzzlePlay() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { refresh } = useProfile();
  const [list, setList] = useState<PuzzleView[] | null>(null);
  const [n, setN] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const [done, setDone] = useState(false);
  const [solvedNow, setSolvedNow] = useState<Record<string, boolean>>({});
  const track = params.get("track"), topic = params.get("topic");

  useEffect(() => {
    let cancel = false;
    setList(null); setN(0); setDone(false); setError(null); setSolvedNow({});
    const p = id ? api.get<PuzzleView>(`/puzzles/${id}`).then((x) => [x])
      : api.post<{ puzzles: PuzzleView[] }>("/puzzles/session", { track, topic }).then((r) => r.puzzles);
    p.then((l) => !cancel && setList(l)).catch((e) => !cancel && setError(e.message));
    return () => { cancel = true; };
  }, [id, track, topic, round]);

  if (error) return <><Link className="back" to="/puzzles"><Icon name="back" size={16} />Puzzles</Link><p className="err">{error}</p></>;
  if (!list) return <div className="center">Loading…</div>;
  if (done) {
    const got = list.filter((p) => p.solved || solvedNow[p.id]).length;
    return (
      <div className="qcard summary">
        <div className={`trophy ${got === list.length ? "" : "cool"}`}><Icon name={got === list.length ? "trophy" : "puzzle"} /></div>
        <span className="bignum">{got}/{list.length}</span>
        <p className="qtext" style={{ marginTop: 10 }}>{got === list.length ? "Set complete." : "Unsolved puzzles stay at the front of the queue."}</p>
        <div className="row">
          {!id && <button className="primary" onClick={() => setRound((r) => r + 1)}>Next set</button>}
          <button className="ghost" onClick={() => nav("/puzzles")}>Back to puzzles</button>
        </div>
      </div>
    );
  }
  const p = list[n];
  const solved = p.solved || !!solvedNow[p.id];
  const next = () => { if (n >= list.length - 1) { setDone(true); refresh(); } else { setN(n + 1); window.scrollTo({ top: 0 }); } };

  return (
    <>
      <Link className="back" to="/puzzles"><Icon name="back" size={16} />Puzzles</Link>
      {list.length > 1 && <div className="runbar"><i style={{ width: `${((n + (solved ? 1 : 0)) / list.length) * 100}%` }} /></div>}
      <div className="qhead">
        <span className="chips"><span className={`chip lv-${p.level}`}>{p.level}</span><span className="chip">{p.topic}</span></span>
        <span>{list.length > 1 ? `${n + 1} / ${list.length}` : KIND_LABEL[p.kind]}</span>
      </div>
      <div className="qcard">
        <div className="steplabel" style={{ marginTop: 0 }}><span>{KIND_LABEL[p.kind]}</span><span className="n">+{p.xp} XP</span></div>
        <h3 style={{ marginBottom: 6 }}>{p.title}</h3>
        <p style={{ margin: 0 }}><Md text={p.prompt} /></p>
        {p.kind === "parsons" && <Parsons key={p.id} p={p} onSolved={() => setSolvedNow((s) => ({ ...s, [p.id]: true }))} />}
        {p.kind === "blanks" && <Blanks key={p.id} p={p} onSolved={() => setSolvedNow((s) => ({ ...s, [p.id]: true }))} />}
        {p.kind === "theory" && <Theory key={p.id} p={p} onSolved={() => setSolvedNow((s) => ({ ...s, [p.id]: true }))} />}
        <div className="stickybar">
          <button className="primary" disabled={!solved} onClick={next}>
            {solved ? (n >= list.length - 1 ? "Finish" : "Next puzzle") : p.kind === "theory" ? `Score ${p.passScore}/10 to continue` : "Solve it to continue"}
          </button>
        </div>
      </div>
    </>
  );
}

function useCheck(p: PuzzleView, onSolved: () => void) {
  const { reward } = useProfile();
  const [res, setRes] = useState<PuzzleCheck | null>(null);
  const [reveal, setReveal] = useState<PuzzleReveal | null>(p.reveal ?? null);
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState(p.attempts);
  async function check(body: object) {
    setBusy(true);
    try {
      const r = await api.post<PuzzleCheck>(`/puzzles/${p.id}/check`, body);
      setRes(r); setAttempts(r.attempts);
      if (r.correct) { setReveal(r.reveal ?? null); onSolved(); reward(r.xp, r.newBadges); if (r.attempts === 1) confetti(50); }
    } finally { setBusy(false); }
  }
  async function doReveal() {
    const r = await api.post<{ reveal: PuzzleReveal }>(`/puzzles/${p.id}/reveal`);
    setReveal(r.reveal);
  }
  return { res, reveal, busy, attempts, check, doReveal };
}

function Explain({ r, p, revealedOnly }: { r: PuzzleReveal; p: PuzzleView; revealedOnly?: boolean }) {
  return (
    <>
      <div className="explain"><b><Icon name={revealedOnly ? "bulb" : "check"} />{revealedOnly ? "Solution" : "Solved"}</b><Md text={r.explanation} /></div>
      {r.solution && (
        <details className="reveal" style={{ marginTop: 10 }}>
          <summary>Full runnable program{r.expectedOutput ? " and its output" : ""}</summary>
          <div className="code" style={{ maxHeight: 420, overflow: "auto" }}>
            {r.solution.replace(/\s+$/, "").split("\n").map((l, i) => <div key={i} className="row"><span className="ln">{i + 1}</span><span className="src">{l ? highlight(l) : " "}</span></div>)}
          </div>
          {r.expectedOutput && <pre className="console ok">{r.expectedOutput}</pre>}
        </details>
      )}
      {revealedOnly && p.kind === "parsons" && r.lines && (
        <div className="code parsons">{r.lines.map((l, i) => <div key={i} className="row hit"><span className="ln">{i + 1}</span><span className="src">{highlight(l)}</span></div>)}</div>
      )}
    </>
  );
}

/* Arrange the lines: tap a line to place it; tap a placed line to send it back; arrows reorder. */
function Parsons({ p, onSolved }: { p: PuzzleView; onSolved: () => void }) {
  const pool0 = useMemo(() => (p.pool ?? []).map((t, i) => ({ t, i })), [p.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [placed, setPlaced] = useState<number[]>([]);
  const { res, reveal, busy, attempts, check, doReveal } = useCheck(p, onSolved);
  const solved = p.solved || !!res?.correct;
  const free = pool0.filter((x) => !placed.includes(x.i));
  const move = (k: number, d: number) => setPlaced((pl) => { const a = pl.slice(); const j = k + d; if (j < 0 || j >= a.length) return a; [a[k], a[j]] = [a[j], a[k]]; return a; });
  const mark = (k: number) => (res && !res.correct ? (res.detail[k] ? "hit" : "miss") : solved ? "hit" : "");

  if (solved && reveal) {
    return (<><div className="code parsons">{(reveal.lines ?? []).map((l, i) => <div key={i} className="row hit"><span className="ln">{i + 1}</span><span className="src">{highlight(l)}</span></div>)}</div><Explain r={reveal} p={p} /></>);
  }
  return (
    <>
      <div className="steplabel"><span>Your solution</span><span className="n">{placed.length}/{p.slots} lines{attempts ? ` · ${attempts} ${attempts === 1 ? "try" : "tries"}` : ""}</span></div>
      <div className="code parsons answer">
        {placed.length === 0 && <div className="row empty"><span className="src muted">Tap lines below to build the solution in order…</span></div>}
        {placed.map((pi, k) => {
          const line = pool0.find((x) => x.i === pi)!.t;
          return (
            <div key={pi} className={`row ${mark(k)}`}>
              <span className="ln">{k + 1}</span>
              <button className="src linebtn" onClick={() => setPlaced((pl) => pl.filter((x) => x !== pi))} title="Send back">{highlight(line)}</button>
              <span className="mv"><button onClick={() => move(k, -1)} aria-label="Move up">↑</button><button onClick={() => move(k, 1)} aria-label="Move down">↓</button></span>
            </div>
          );
        })}
      </div>
      <div className="steplabel"><span>Lines{p.pool && p.slots && p.pool.length > p.slots ? ` (${p.pool.length - p.slots} don't belong)` : ""}</span></div>
      <div className="code parsons pool">
        {free.length === 0 ? <div className="row empty"><span className="src muted">All lines used.</span></div> : free.map((x) => (
          <button key={x.i} className="row linebtn" onClick={() => { setPlaced((pl) => [...pl, x.i]); }}>
            <span className="ln">+</span><span className="src">{highlight(x.t)}</span>
          </button>
        ))}
      </div>
      {res && !res.correct && <p className="err">{res.detail.filter(Boolean).length}/{res.detail.length} lines in the right place. Red ones are wrong or out of order.</p>}
      <div className="row">
        <button className="primary" disabled={busy || placed.length !== p.slots} onClick={() => check({ order: placed.map((pi) => pool0.find((x) => x.i === pi)!.t) })}>
          {placed.length !== p.slots ? `Place ${p.slots! - placed.length} more` : "Check"}
        </button>
        {placed.length > 0 && <button className="ghost" onClick={() => setPlaced([])}>Clear</button>}
        {!solved && attempts >= p.revealAfter && <button className="ghost" onClick={doReveal}>Show solution (no XP)</button>}
      </div>
      {reveal && !solved && <Explain r={reveal} p={p} revealedOnly />}
    </>
  );
}

/* Fill the blanks: dropdowns inline in the code. */
function Blanks({ p, onSolved }: { p: PuzzleView; onSolved: () => void }) {
  const [choice, setChoice] = useState<number[]>(() => (p.blanks ?? []).map(() => -1));
  const { res, reveal, busy, attempts, check, doReveal } = useCheck(p, onSolved);
  const solved = p.solved || !!res?.correct;
  const answers = reveal?.answers;
  const parts = (p.code ?? "").split(/(\[\[\d+\]\])/g);
  const lines: (string | number)[][] = [[]];
  for (const part of parts) {
    const m = /^\[\[(\d+)\]\]$/.exec(part);
    if (m) { lines[lines.length - 1].push(Number(m[1]) - 1); continue; }
    part.split("\n").forEach((seg, i) => { if (i > 0) lines.push([]); if (seg) lines[lines.length - 1].push(seg); });
  }
  return (
    <>
      <div className="code blanks">
        {lines.map((ln, i) => (
          <div key={i} className="row"><span className="ln">{i + 1}</span><span className="src">
            {ln.map((x, j) => typeof x === "string" ? <Fragment key={j}>{highlight(x)}</Fragment> : (
              <select key={j} className={`gap ${solved ? "ok" : res && !res.correct ? (res.detail[x] ? "ok" : "bad") : ""}`} disabled={solved}
                value={solved && answers ? answers[x] : choice[x]} onChange={(e) => setChoice((c) => c.map((v, k) => (k === x ? Number(e.target.value) : v)))}>
                <option value={-1}>[{x + 1}] choose…</option>
                {p.blanks![x].options.map((o, k) => <option key={k} value={k}>{o}</option>)}
              </select>
            ))}
            {ln.length === 0 ? " " : null}
          </span></div>
        ))}
      </div>
      {solved && reveal ? <Explain r={reveal} p={p} /> : (
        <>
          {res && !res.correct && <p className="err">{res.detail.filter(Boolean).length}/{res.detail.length} blanks right. Red ones need another look.</p>}
          <div className="row">
            <button className="primary" disabled={busy || choice.some((c) => c < 0)} onClick={() => check({ choices: choice })}>{choice.some((c) => c < 0) ? "Fill every blank" : "Check"}</button>
            {attempts >= p.revealAfter && <button className="ghost" onClick={doReveal}>Show solution (no XP)</button>}
          </div>
          {reveal && <Explain r={reveal} p={p} revealedOnly />}
        </>
      )}
    </>
  );
}

/* Explain it: graded by Claude; must reach passScore. */
function Theory({ p, onSolved }: { p: PuzzleView; onSolved: () => void }) {
  const [hint, setHint] = useState(false);
  const [best, setBest] = useState(p.bestScore);
  const solved = p.solved || (best ?? 0) >= p.passScore;
  return (
    <>
      <p className="qtext" style={{ marginTop: 14 }}><Md text={p.question ?? ""} /></p>
      {p.hint && !hint && <button className="iconbtn" onClick={() => setHint(true)}><Icon name="bulb" size={15} />Hint</button>}
      {hint && <div className="box-tip"><b><Icon name="bulb" />Hint</b><span><Md text={p.hint ?? ""} /></span></div>}
      {solved && <div className="explain"><b><Icon name="check" />Passed{best != null ? ` with ${best}/10` : ""}</b>You can move on, or keep refining your answer.</div>}
      <GradeBox kind="puzzle" id={p.id} title={`Your answer (${p.passScore}/10 to pass)`}
        onGraded={(g: Grade) => { setBest((b) => Math.max(b ?? 0, g.score)); if (g.score >= p.passScore) onSolved(); }} />
    </>
  );
}
