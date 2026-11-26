import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useLoad, useProfile } from "../state";
import { GradeBox } from "../components/GradeBox";
import { Prose } from "../components/CodeView";
import { Pic } from "../components/Art";
import { Icon, Ring } from "../components/ui";
import { tone } from "./Readiness";

/* ---------- Prep hub ---------- */
export function PrepHome() {
  const { data: plan } = useLoad(() => api.get<Plan>("/plan"), []);
  const tiles: { to: string; title: string; sub: string; icon: string }[] = [
    { to: "/design", title: "Design", sub: "System, object-oriented & API", icon: "chart" },
    { to: "/coding", title: "Coding", sub: "Run tests or get a code review", icon: "computer" },
    { to: "/behavioral", title: "Behavioural", sub: "STAR story bank", icon: "boy" },
    { to: "/practical", title: "Practical rounds", sub: "Bug squash & integration", icon: "lock" },
    { to: "/mongo", title: "MongoDB lab", sub: "Queries & pipelines", icon: "folder" },
    { to: "/mock", title: "Mock interview", sub: "45 minutes, timed", icon: "target" },
    { to: "/companies", title: "Companies", sub: "MongoDB · Microsoft · Stripe", icon: "trophy" },
  ];
  return (
    <>
      <h2>Interview prep</h2>
      <p className="lede">Everything beyond the book: the rounds you’ll actually face.</p>
      {plan && <PlanCard plan={plan} />}
      <div className="preptiles">
        {tiles.map((t) => (
          <Link key={t.to} to={t.to} className="preptile">
            <span className="pt-ic"><Pic name={t.icon} plain /></span>
            <b>{t.title}</b><small>{t.sub}</small>
          </Link>
        ))}
      </div>
      <Link to="/readiness" className="listrow" style={{ marginTop: 12 }}><span className="lr-t"><b>Interview readiness</b><small>Your score by area and by company</small></span><Icon name="arrow" /></Link>
    </>
  );
}

/* ---------- daily plan ---------- */
export type Plan = { date: string | null; daysLeft: number | null; intensity: string; readiness: number; band: string; done: number; total: number;
  tasks: { id: string; label: string; detail: string; to: string; done: boolean; progress: number; target: number }[] };

export function PlanCard({ plan, compact }: { plan: Plan; compact?: boolean }) {
  const nav = useNavigate();
  return (
    <section className="panel plancard">
      <div className="pc-h">
        <div>
          <div className="eyebrow">{plan.daysLeft != null ? (plan.daysLeft > 0 ? `${plan.daysLeft} days to your interview` : plan.daysLeft === 0 ? "Interview day" : "Interview date passed") : "Today’s plan"}</div>
          <b>{plan.done === plan.total && plan.total ? "Plan complete. Nice work." : `${plan.done} of ${plan.total} done`}</b>
        </div>
        <Ring value={plan.total ? (plan.done / plan.total) * 100 : 0} size={44} stroke={5}>{plan.done}</Ring>
      </div>
      <div className="tasks">
        {plan.tasks.map((t) => (
          <button key={t.id} className={`task ${t.done ? "done" : ""}`} onClick={() => nav(t.to)}>
            <span className="tk">{t.done ? <Icon name="check" size={14} /> : null}</span>
            <span className="tt"><b>{t.label}</b><small>{t.detail}{t.target > 1 ? ` · ${t.progress}/${t.target}` : ""}</small></span>
            <Icon name="arrow" size={15} />
          </button>
        ))}
      </div>
      {!compact && plan.date == null && <Link to="/settings#interview" className="small">Set your interview date to pace the plan →</Link>}
    </section>
  );
}

/* ---------- mock interview ---------- */
type MockItem = { kind: "card" | "puzzle" | "design" | "story"; id: string; title: string; question: string; minutes: number };
type Mock = { id: number; startedAt: number; endsAt: number; finishedAt: number | null; items: MockItem[]; scores: (number | null)[]; total: number | null; overtime?: boolean };

export function MockPage() {
  const { reward } = useProfile();
  const { data: overview, reload } = useLoad(() => api.get<{ history: { id: number; startedAt: number; total: number }[]; open: { id: number } | null }>("/mock"), []);
  const [mock, setMock] = useState<Mock | null>(null);
  const [i, setI] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [answers, setAnswers] = useState<Record<number, string>>({});

  useEffect(() => { if (overview?.open && !mock) api.get<Mock>(`/mock/${overview.open.id}`).then(setMock); }, [overview]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!mock || mock.finishedAt) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [mock]);

  async function start() { setMock(await api.post<Mock>("/mock/start")); setI(0); setAnswers({}); }
  async function finish() {
    if (!mock) return;
    const r = await api.post<Mock>(`/mock/${mock.id}/finish`);
    setMock(r); reward(25 + Math.round((r.total ?? 0) / 4), []); reload();
  }

  if (!overview) return <div className="center">Loading…</div>;
  if (!mock) return (
    <>
      <Link to="/prep" className="back"><Icon name="back" />Prep</Link>
      <h2>Mock interview</h2>
      <p className="lede">Four questions, timed like the real thing: a concept, a systems puzzle, a design section and a behavioural question. Each answer is reviewed; you get one scorecard at the end.</p>
      <section className="panel">
        <ul className="tidy small"><li>About 45 minutes. The clock keeps running if you leave.</li><li>Answer out loud first, then type the key points.</li><li>Don’t look anything up. That’s the point.</li></ul>
        <button className="primary" style={{ width: "100%" }} onClick={start}>Start mock interview</button>
      </section>
      {overview.history.length > 0 && (<>
        <h3 className="section-h">Past mocks</h3>
        <div className="mockhist">{overview.history.map((h) => <span key={h.id} title={new Date(h.startedAt).toLocaleDateString()} style={{ height: `${Math.max(6, h.total)}%`, background: tone(h.total) }}><em>{h.total}</em></span>)}</div>
      </>)}
    </>
  );

  if (mock.finishedAt) {
    const sec = Math.round((mock.finishedAt - mock.startedAt) / 1000);
    return (
      <>
        <h2>Scorecard</h2>
        <section className="panel readyhero">
          <Ring value={mock.total ?? 0} size={110} stroke={10} color={tone(mock.total ?? 0)}><span className="rh-v">{mock.total}</span></Ring>
          <div className="rh-t"><h3>{(mock.total ?? 0) >= 75 ? "Strong performance" : (mock.total ?? 0) >= 55 ? "Solid, with gaps" : "Keep practising"}</h3>
            <p className="small muted">{Math.floor(sec / 60)} min {sec % 60}s{mock.overtime ? " · over time" : ""}</p></div>
        </section>
        <div className="list">{mock.items.map((it, k) => (
          <div key={k} className="listrow"><span className="lr-t"><b>{it.title}</b><small>{({ card: "Concept", puzzle: "Systems puzzle", design: "System design", story: "Behavioural" })[it.kind]}</small></span>
            <span className="mx-s" style={{ color: tone((mock.scores[k] ?? 0) * 10) }}>{mock.scores[k] ?? "–"}<small>/10</small></span></div>
        ))}</div>
        <button className="primary" style={{ width: "100%" }} onClick={() => { setMock(null); reload(); }}>Done</button>
      </>
    );
  }

  const left = Math.max(0, mock.endsAt - now);
  const it = mock.items[i];
  const graded = mock.scores.filter((s) => s != null).length;
  return (
    <>
      <div className="mockbar">
        <span className={`timer ${left < 300000 ? "low" : ""}`}>{Math.floor(left / 60000)}:{String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}</span>
        <div className="segbar" style={{ flex: 1 }}>{mock.items.map((_, k) => <i key={k} className={mock.scores[k] != null ? "ok" : k === i ? "part" : ""} onClick={() => setI(k)} />)}</div>
        <span className="small muted">{i + 1}/{mock.items.length}</span>
      </div>
      <section className="panel">
        <div className="eyebrow">{({ card: "Concept", puzzle: "Systems puzzle", design: "System design", story: "Behavioural" })[it.kind]} · ~{it.minutes} min</div>
        <h3 style={{ margin: "4px 0 8px" }}>{it.title}</h3>
        <Prose text={it.question} />
      </section>
      <GradeBox key={`${mock.id}-${i}`} kind={it.kind} id={it.id} answer={answers[i] ?? ""} onAnswer={(v) => setAnswers({ ...answers, [i]: v })} title="Your answer"
        placeholder="Type your answer as you would say it."
        onGraded={(g) => setMock({ ...mock, scores: mock.scores.map((s, k) => (k === i ? Math.max(s ?? 0, g.score) : s)) })} />
      <div className="row" style={{ gap: 8 }}>
        {i < mock.items.length - 1 && <button className="ghost" onClick={() => setI(i + 1)}>Next question<Icon name="arrow" /></button>}
        <button className={graded === mock.items.length ? "primary" : "ghost"} onClick={finish}>Finish{graded < mock.items.length ? ` (${graded}/${mock.items.length} answered)` : ""}</button>
      </div>
    </>
  );
}

export function HomePlan() {
  const { data } = useLoad(() => api.get<Plan>("/plan"), []);
  if (!data || !data.total) return null;
  return <PlanCard plan={data} />;
}
