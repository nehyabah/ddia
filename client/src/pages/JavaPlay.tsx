import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, type JavaChallenge, type JavaResult } from "../api";
import { useProfile } from "../state";
import { CodeView, DiffView, Md, type LineMark } from "../components/CodeView";
import { Icon, confetti } from "../components/ui";
import { GradeBox } from "../components/GradeBox";

const KIND_LABEL = { bug: "Find the bug", output: "Predict the output", trace: "Read the stack trace" } as const;

/** Plays a session of challenges (/java/play?level=&topic=&mode=) or a single one (/java/c/:id). */
export function JavaPlay() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { reward, refresh } = useProfile();
  const [list, setList] = useState<JavaChallenge[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const [lines, setLines] = useState<number[]>([]);
  const [choice, setChoice] = useState<number | null>(null);
  const [result, setResult] = useState<JavaResult | null>(null);
  const [score, setScore] = useState({ correct: 0, exact: 0, xp: 0 });
  const [done, setDone] = useState(false);
  const [round, setRound] = useState(0);
  const busy = useRef(false);
  const top = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const mode = params.get("mode") === "review" ? "review" : "practice";
  const level = params.get("level"), topic = params.get("topic");

  useEffect(() => {
    let cancelled = false;
    setList(null); setError(null); setN(0); setDone(false); setScore({ correct: 0, exact: 0, xp: 0 });
    const p = id
      ? api.get<JavaChallenge>(`/java/challenges/${id}`).then((c) => [c])
      : api.post<{ challenges: JavaChallenge[] }>("/java/session", { mode, level, topic }).then((r) => r.challenges);
    p.then((l) => !cancelled && setList(l)).catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [id, mode, level, topic, round]);

  const c = list?.[n];
  useEffect(() => { setLines([]); setChoice(null); setResult(null); }, [c?.id]);

  const marks = useMemo(() => {
    const m = new Map<number, LineMark>();
    if (!result) { lines.forEach((l) => m.set(l, "sel")); return m; }
    result.bugLines.forEach((l) => m.set(l, lines.includes(l) ? "hit" : "bug"));
    lines.forEach((l) => { if (!result.bugLines.includes(l)) m.set(l, "miss"); });
    return m;
  }, [lines, result]);

  function toggleLine(l: number) {
    if (result) return;
    setLines((cur) => (cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l].slice(-3)));
  }

  async function check() {
    if (!c || choice == null || result || busy.current) return;
    busy.current = true;
    try {
      const r = await api.post<JavaResult>(`/java/challenges/${c.id}/answer`, { choice, lines });
      setResult(r);
      setScore((s) => ({ correct: s.correct + (r.correct ? 1 : 0), exact: s.exact + (r.linesExact ? 1 : 0), xp: s.xp + r.xp }));
      reward(r.xp, r.newBadges);
      if (r.correct && r.linesExact) confetti(40);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busy.current = false;
    }
  }

  function next() {
    if (!list) return;
    if (n >= list.length - 1) {
      setDone(true); refresh();
      if (list.length > 1 && score.correct === list.length) setTimeout(() => confetti(120), 200);
      return;
    }
    setN(n + 1);
    top.current?.scrollIntoView({ block: "start" });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "TEXTAREA") return;
      if (!result && /^[1-4]$/.test(e.key)) setChoice(Number(e.key) - 1);
      else if (e.key === "Enter" && !(e.target as HTMLElement).closest?.(".code")) {
        if (!result && choice != null) { e.preventDefault(); check(); }
        else if (result) { e.preventDefault(); next(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (error) {
    return (
      <>
        <Link className="back" to="/java"><Icon name="back" size={16} />Java</Link>
        <div className="qcard"><p className="qtext">{error}</p><button className="primary" onClick={() => nav("/java")}>Back to Java</button></div>
      </>
    );
  }
  if (!list || !c) return <div className="center">Loading…</div>;

  if (done) {
    return (
      <div className="qcard summary">
        <div className={`trophy ${score.correct === list.length ? "" : "cool"}`}><Icon name={score.correct === list.length ? "trophy" : "bug"} /></div>
        <span className="bignum">{score.correct}/{list.length}</span>
        <p className="qtext" style={{ marginTop: 10 }}>
          {score.correct === list.length ? "Every bug squashed." : "Misses come back in about 10 minutes — the fastest way to make them stick."}
        </p>
        <p className="muted">+{score.xp} XP · {score.exact} bug {score.exact === 1 ? "line" : "lines"} pinpointed exactly</p>
        <div className="row">
          {!id && <button className="primary" onClick={() => setRound((r) => r + 1)}>Another set</button>}
          <button className="ghost" onClick={() => nav("/java")}>Back to Java</button>
        </div>
      </div>
    );
  }

  const isTrace = c.kind === "trace";
  return (
    <div ref={top}>
      <Link className="back" to={id ? "/java/all" : "/java"}><Icon name="back" size={16} />{id ? "All challenges" : "Java"}</Link>
      {list.length > 1 && <div className="runbar"><i style={{ width: `${((n + (result ? 1 : 0)) / list.length) * 100}%`, background: "var(--grad-warm)" }} /></div>}
      <div className="qhead">
        <span className="chips">
          <span className={`chip lv-${c.level}`}>{c.level}</span>
          <span className="chip">{c.topic}</span>
        </span>
        <span>{list.length > 1 ? `${n + 1} / ${list.length}` : KIND_LABEL[c.kind]}</span>
      </div>

      <div className="qcard">
        <h3 style={{ marginBottom: 6 }}>{c.title}</h3>
        <p style={{ margin: 0 }}><Md text={c.scenario} /></p>
        {c.symptom && (<>
          <div className="steplabel">{isTrace ? "Stack trace" : "What you see"}</div>
          <pre className="console err">{c.symptom}</pre>
        </>)}

        <div className="steplabel">
          <span>1 · {c.kind === "output" ? "Tap the line that causes it" : "Tap the buggy line"}</span>
          <span className="n">{result ? (result.linesExact ? "✓ exact" : result.linesPartial ? "≈ close" : lines.length ? "✗ missed" : "skipped") : `${c.bugLineCount} ${c.bugLineCount === 1 ? "line" : "lines"} · optional`}</span>
        </div>
        <CodeView code={c.code} marks={marks} onLine={result ? undefined : toggleLine} label="Source code; tap a line to mark it" />

        <div className="steplabel"><span>2 · <Md text={c.question} /></span></div>
        <div className="opts">
          {c.options.map((o, k) => {
            const cls = result ? (k === result.answer ? "right" : k === choice ? "wrong" : "") : k === choice ? "picked" : "";
            return (
              <button key={k} className={`opt ${cls}`} disabled={!!result} onClick={() => setChoice(k)}
                style={c.kind === "output" ? { fontFamily: "ui-monospace,Menlo,Consolas,monospace", whiteSpace: "pre-wrap" } : undefined}>
                <span className="k">{k + 1}</span><span className="ot">{c.kind === "output" ? o : <Md text={o} />}</span>
              </button>
            );
          })}
        </div>

        {!result && (
          <div className={choice == null ? "submitbar" : "stickybar"}>
            <button className="primary" disabled={choice == null} onClick={check}>{choice == null ? "Pick an answer" : "Check"}</button>
          </div>
        )}

        {result && (
          <div ref={resultRef}>
            <div className={`explain ${result.correct ? "" : "bad"}`}>
              <b><Icon name={result.correct ? "check" : "x"} />{result.correct ? "Correct" : "Not quite"}{result.xp > 0 ? ` · +${result.xp} XP` : ""}</b>
              <Md text={result.explanation} />
            </div>

            {(result.buggyOutput != null || result.fixedOutput != null) && (
              <div className="outs" style={{ marginTop: 12 }}>
                {result.buggyOutput != null && (
                  <div><div className="k">Buggy version prints{result.throws ? ` (then throws ${result.throws.split(".").pop()})` : ""}</div>
                    <pre className="console err">{result.buggyOutput || "(nothing)"}</pre></div>
                )}
                {result.fixedOutput != null && (
                  <div><div className="k">Fixed version prints</div><pre className="console ok">{result.fixedOutput || "(nothing)"}</pre></div>
                )}
              </div>
            )}

            <div className="steplabel"><span>The fix</span></div>
            <p className="small" style={{ margin: "0 0 4px" }}><Md text={result.fixNote} /></p>
            <DiffView before={c.code} after={result.fix} />

            <div className="box-tip"><b><Icon name="bulb" />How you'd catch it</b><span><Md text={result.debugTip} /></span></div>
            <details className="reveal explainbox"><summary>✦ Explain this bug to Claude (interview practice)</summary>
              <GradeBox kind="java" id={c.id} placeholder="What is the bug, why does Java behave this way, and how would you fix and catch it?" />
            </details>

            <div className="stickybar">
              <button className="primary" onClick={next}>{n >= list.length - 1 ? "Finish" : "Next bug"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
