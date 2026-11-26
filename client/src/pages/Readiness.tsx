import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useLoad } from "../state";
import { Icon, Ring } from "../components/ui";

type Signals = { knowledge: number | null; accuracy: number | null; practice: number | null; explanation: number | null; coverage: number | null };
type AreaR = {
  id: string; label: string; weight: number; score: number; band: string; confidence: "low" | "medium" | "high"; evidence: number;
  idleDays: number | null; decayed: boolean; signals: Signals; items: { questions: number; java: number; puzzles: number };
  weakest?: keyof Signals; action: { label: string; to: string };
};
export type Readiness = {
  overall: number; uncapped: number; band: string; capped: boolean; confidence: "low" | "medium" | "high";
  strongest: string[]; focus: { id: string; label: string; score: number; action: { label: string; to: string } }[];
  weights: Record<keyof Signals, number>; areas: AreaR[];
};

const COLS: { k: keyof Signals; label: string; short: string; help: string }[] = [
  { k: "knowledge", label: "Knowledge", short: "Know", help: "Spaced-repetition strength of the questions and bugs in this area." },
  { k: "accuracy", label: "Accuracy", short: "Acc", help: "Your quiz and bug-fix accuracy over the last 30 days." },
  { k: "practice", label: "Practice", short: "Prac", help: "Puzzles solved and Java bugs you can reliably fix." },
  { k: "explanation", label: "Explaining", short: "Expl", help: "Best review scores on written answers in this area." },
  { k: "coverage", label: "Coverage", short: "Cov", help: "How much of the area’s material you’ve touched at all." },
];

export const tone = (s: number) => (s >= 80 ? "var(--teal)" : s >= 65 ? "var(--accent)" : s >= 45 ? "var(--amber)" : "var(--red)");
const heat = (v: number | null) => (v == null ? "na" : v >= 80 ? "h4" : v >= 60 ? "h3" : v >= 40 ? "h2" : v >= 15 ? "h1" : "h0");

/** Compact card for Home. */
export function ReadinessCard() {
  const { data } = useLoad(() => api.get<Readiness>("/readiness"), []);
  if (!data) return null;
  return (
    <Link to="/readiness" className="readycard">
      <Ring value={data.overall} size={68} stroke={7} color={tone(data.overall)}><b>{data.overall}</b></Ring>
      <span className="rc-t">
        <span className="eyebrow">Interview readiness</span>
        <b>{data.band}</b>
        <small>Focus next: {data.focus[0]?.label}</small>
      </span>
      <span className="rc-mini">
        {data.areas.slice(0, 6).map((a) => <i key={a.id} style={{ height: `${Math.max(8, a.score)}%`, background: tone(a.score) }} title={`${a.label}: ${a.score}`} />)}
      </span>
      <Icon name="arrow" />
    </Link>
  );
}

export function ReadinessPage() {
  const nav = useNavigate();
  const { data, error } = useLoad(() => api.get<Readiness>("/readiness"), []);
  if (error) return <p className="err">{error}</p>;
  if (!data) return <div className="center">Loading…</div>;
  const sorted = [...data.areas].sort((a, b) => b.weight - a.weight || b.score - a.score);

  return (
    <>
      <h2>Interview readiness</h2>
      <p className="lede">Calculated from every quiz, bug fix, puzzle and reviewed answer you’ve done. It only rises with real evidence.</p>

      <section className="panel readyhero">
        <Ring value={data.overall} size={132} stroke={11} color={tone(data.overall)}>
          <span className="rh-v">{data.overall}<small>/100</small></span>
        </Ring>
        <div className="rh-t">
          <div className="eyebrow">Overall</div>
          <h3>{data.band}</h3>
          <p className="small muted">
            Confidence: <b>{data.confidence}</b> ({data.confidence === "low" ? "do more work to firm this up" : data.confidence === "medium" ? "a fair picture" : "plenty of evidence"}).
            {data.capped && <> Held at {data.overall} because a core area is far behind; without that it would be {data.uncapped}.</>}
          </p>
          {data.strongest.length > 0 && data.overall > 0 && <p className="small" style={{ margin: "6px 0 0" }}><b>Strongest:</b> {data.strongest.join(", ")}</p>}
        </div>
      </section>

      <h3 className="section-h">Focus next</h3>
      <div className="focuslist">
        {data.focus.map((f, i) => (
          <button key={f.id} className="focusrow" onClick={() => nav(f.action.to)}>
            <span className="fr-n">{i + 1}</span>
            <span className="fr-t"><b>{f.label}</b><small>{f.score}/100 · {f.action.label}</small></span>
            <Icon name="arrow" />
          </button>
        ))}
      </div>

      <h3 className="section-h">Readiness matrix</h3>
      <div className="matrix panel">
        <div className="mx-head">
          <span>Area</span>
          {COLS.map((c) => <span key={c.k} title={c.help}>{c.short}</span>)}
          <span>Score</span>
        </div>
        {sorted.map((a) => (
          <div key={a.id} className="mx-row">
            <span className="mx-l">
              <b>{a.label}</b>
              <small>{a.confidence} confidence{a.decayed ? ` · idle ${a.idleDays}d` : ""}{a.weight >= 1.1 ? " · core" : ""}</small>
            </span>
            {COLS.map((c) => {
              const v = a.signals[c.k];
              return <span key={c.k} className={`mx-c ${heat(v)} ${a.weakest === c.k ? "weak" : ""}`} title={`${c.label}: ${v == null ? "n/a" : v + "%"}`}>{v == null ? "–" : v}</span>;
            })}
            <span className="mx-s" style={{ color: tone(a.score) }}>{a.score}</span>
            <Link to={a.action.to} className="mx-a">{a.action.label}<Icon name="arrow" size={13} /></Link>
          </div>
        ))}
        <div className="mx-legend">
          <span><i className="mx-c h0" />0–14</span><span><i className="mx-c h1" />15–39</span><span><i className="mx-c h2" />40–59</span><span><i className="mx-c h3" />60–79</span><span><i className="mx-c h4" />80+</span>
          <span className="muted">Outlined = weakest signal</span>
        </div>
      </div>

      <details className="panel howcalc">
        <summary>How it’s calculated</summary>
        <ul className="tidy small">
          {COLS.map((c) => <li key={c.k}><b>{c.label}</b> ({Math.round(data.weights[c.k] * 100)}%): {c.help}</li>)}
          <li>Anything you haven’t attempted counts as 0. Accuracy is smoothed, so 2 out of 2 isn’t treated as 100%.</li>
          <li>Areas you haven’t practised for over 14 days lose up to 30%, because memory fades.</li>
          <li>The overall score weights core areas more: concurrency and consistency ×1.2, replication and sharding ×1.1, Java ×0.8.</li>
          <li>An interview finds your weakest area, so the overall score can’t sit more than 20 points above your weakest core area.</li>
          <li>Bands: 80+ interview ready · 65+ nearly there · 45+ developing · anything above 0 early.</li>
        </ul>
      </details>
    </>
  );
}
