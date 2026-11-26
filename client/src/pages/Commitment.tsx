import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useLoad, useProfile } from "../state";
import { Icon } from "../components/ui";

type Day = { day: string; weekday: number; planned: boolean; minutes: number; target: number; status: "kept" | "missed" | "today" | "rest" | "bonus" | "before" };
export type Commit = {
  configured: boolean; perDay: number;
  settings: { studyDays: number[]; weeklyMinutes: number; partnerName: string | null; partnerEmail: string | null };
  today: { planned: boolean; minutes: number; target: number; done: boolean };
  week: { minutes: number; target: number; kept: number; planned: number };
  keptStreak: number; keepRate: number | null; recentMissed: number; needsReflection: string | null; days: Day[];
};
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const REASONS = ["Work ran late", "Too tired", "Lost track of time", "Social / family plans", "Felt unmotivated", "Unwell", "Travel"];
const fmtDay = (d: string) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });

/** Home card: today's commitment, the week, streak, and a reflection prompt after a missed day. */
export function CommitCard() {
  const { data, setData } = useLoad(() => api.get<Commit>("/accountability"), []);
  if (!data) return null;
  if (!data.configured) return (
    <Link to="/commitment" className="listrow commit-cta">
      <span className="lr-t"><b>Make a weekly commitment</b><small>Pick your study days and minutes. Add a partner to keep you honest.</small></span><Icon name="arrow" />
    </Link>
  );
  const pct = data.today.target ? Math.min(100, Math.round((data.today.minutes / data.today.target) * 100)) : 100;
  return (
    <section className="panel commitcard">
      {data.needsReflection && <Reflect day={data.needsReflection} onDone={setData} />}
      <Link to="/commitment" className="cc-h">
        <div>
          <div className="eyebrow">Commitment</div>
          <b>{data.today.planned ? (data.today.done ? "Today: kept" : `Today: ${data.today.minutes} of ${data.today.target} min`) : "Rest day"}</b>
        </div>
        <div className="cc-streak"><b>{data.keptStreak}</b><small>kept in a row</small></div>
      </Link>
      {data.today.planned && <div className="bar"><i style={{ width: `${pct}%`, background: data.today.done ? "var(--teal)" : "var(--accent)" }} /></div>}
      <div className="cc-dots" aria-label="Last 4 weeks">
        {data.days.map((d) => <i key={d.day} className={`dot-${d.status}`} title={`${fmtDay(d.day)}: ${d.status}${d.minutes ? `, ${d.minutes} min` : ""}`} />)}
      </div>
      <div className="cc-foot small muted">
        This week {data.week.minutes}/{data.week.target} min · {data.week.kept}/{data.week.planned} planned days kept{data.keepRate != null ? ` · ${data.keepRate}% over 4 weeks` : ""}
        {data.settings.partnerName && <> · partner: {data.settings.partnerName}</>}
      </div>
    </section>
  );
}

function Reflect({ day, onDone }: { day: string; onDone: (c: Commit) => void }) {
  const [reason, setReason] = useState("");
  const [plan, setPlan] = useState("");
  const [other, setOther] = useState("");
  async function save() { onDone(await api.post<Commit>("/accountability/reflect", { day, reason: reason === "Other" ? other : reason, plan })); }
  return (
    <div className="reflect">
      <b>You missed {fmtDay(day)}. What got in the way?</b>
      <div className="themegrid" style={{ margin: "8px 0" }}>
        {[...REASONS, "Other"].map((r) => <button key={r} type="button" className={`themechip ${reason === r ? "on" : ""}`} onClick={() => setReason(r)}>{r}</button>)}
      </div>
      {reason === "Other" && <input className="field" value={other} onChange={(e) => setOther(e.target.value)} placeholder="What happened?" />}
      {reason && <input className="field" value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="What will you do differently? (optional)" style={{ marginTop: 6 }} />}
      <button className="primary" disabled={!reason || (reason === "Other" && !other.trim())} onClick={save}>Log it and move on</button>
    </div>
  );
}

export function CommitmentPage() {
  const { toast } = useProfile();
  const { data, setData } = useLoad(() => api.get<Commit>("/accountability"), []);
  const { data: refl } = useLoad(() => api.get<{ day: string; reason: string; plan: string }[]>("/accountability/reflections"), [data?.needsReflection]);
  const [f, setF] = useState({ studyDays: [1, 2, 3, 4, 5] as number[], weeklyMinutes: 300, partnerName: "", partnerEmail: "" });
  useEffect(() => {
    if (data) setF({ studyDays: data.configured ? data.settings.studyDays : [1, 2, 3, 4, 5], weeklyMinutes: data.settings.weeklyMinutes, partnerName: data.settings.partnerName ?? "", partnerEmail: data.settings.partnerEmail ?? "" });
  }, [data?.configured]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <div className="center">Loading…</div>;
  async function save(e: FormEvent) {
    e.preventDefault();
    try { setData(await api.put<Commit>("/accountability", f)); toast("Commitment saved"); } catch (err) { toast((err as Error).message); }
  }
  const per = f.studyDays.length ? Math.round(f.weeklyMinutes / f.studyDays.length) : 0;
  const reasons = Object.entries((refl ?? []).reduce<Record<string, number>>((m, r) => ({ ...m, [r.reason]: (m[r.reason] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <Link to="/" className="back"><Icon name="back" />Home</Link>
      <h2>Commitment</h2>
      <p className="lede">Decide when you study and for how long. A planned day counts as kept when you’re active for your daily share. Miss one and you’ll be asked why.</p>
      {data.configured && <CommitCard />}
      <form className="panel" onSubmit={save}>
        <h3>Study days</h3>
        <div className="daypick">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => {
            const on = f.studyDays.includes(d);
            return <button type="button" key={d} className={on ? "on" : ""} aria-pressed={on} onClick={() => setF({ ...f, studyDays: on ? f.studyDays.filter((x) => x !== d) : [...f.studyDays, d] })}>{WD[d]}</button>;
          })}
        </div>
        <label className="lbl" htmlFor="wm">Minutes per week</label>
        <div className="row" style={{ alignItems: "center", gap: 10 }}>
          <input id="wm" className="field" type="number" min={30} max={4000} step={15} value={f.weeklyMinutes} onChange={(e) => setF({ ...f, weeklyMinutes: Number(e.target.value) })} style={{ maxWidth: 130 }} />
          <span className="small muted">≈ {per} min on each study day{f.weeklyMinutes >= 60 ? ` · ${(f.weeklyMinutes / 60).toFixed(1)} h/week` : ""}</span>
        </div>
        <h3 style={{ marginTop: 20 }}>Accountability partner <span className="small muted">optional</span></h3>
        <p className="small muted" style={{ marginTop: 0 }}>They get your weekly report and a heads-up if you miss two planned days in a row. Nothing else.</p>
        <label className="lbl" htmlFor="pn">Their name</label>
        <input id="pn" className="field" value={f.partnerName} onChange={(e) => setF({ ...f, partnerName: e.target.value })} placeholder="e.g. Sam" />
        <label className="lbl" htmlFor="pe">Their email</label>
        <input id="pe" className="field" type="email" value={f.partnerEmail} onChange={(e) => setF({ ...f, partnerEmail: e.target.value })} placeholder="partner@example.com" />
        <button className="primary" disabled={!f.studyDays.length}>{data.configured ? "Update commitment" : "Commit"}</button>
      </form>
      {reasons.length > 0 && (
        <section className="panel">
          <h3>What gets in the way</h3>
          <div className="list">{reasons.map(([r, n]) => <div key={r} className="wbar"><span>{r}</span><i><b style={{ width: `${(n / reasons[0][1]) * 100}%`, background: "var(--amber)" }} /></i><em>{n}</em></div>)}</div>
          {(refl ?? []).filter((r) => r.plan).slice(0, 3).map((r) => <p key={r.day} className="small muted" style={{ margin: "8px 0 0" }}>{fmtDay(r.day)}: “{r.plan}”</p>)}
        </section>
      )}
    </>
  );
}
