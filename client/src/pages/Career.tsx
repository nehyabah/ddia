import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Badge } from "../api";
import { useLoad, useProfile } from "../state";
import { GradeBox } from "../components/GradeBox";
import { Prose } from "../components/CodeView";
import { Icon } from "../components/ui";
import { tone } from "./Readiness";

/* ====================== six-month roadmap ====================== */
type Check = { label: string; have: number; need: number; to: string };
type Month = { n: number; phase: string; title: string; target: number; focus: string[]; checks: Check[]; from: string; to: string; done: number; total: number; state: "past" | "now" | "next" };
type Roadmap = { start: string; end: string; totalWeeks: number; week: number; progress: number; fromTracker: boolean; readiness: number; expectedNow: number; status: string; gap: number; current: number; months: Month[] };
const fmt = (d: string) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });
const STATUS_TONE: Record<string, string> = { ahead: "var(--teal)", "on track": "var(--accent)", "slightly behind": "var(--amber)", behind: "var(--red)" };

export function RoadmapCard() {
  const { data } = useLoad(() => api.get<Roadmap>("/roadmap"), []);
  if (!data) return null;
  const m = data.months[data.current];
  return (
    <Link to="/roadmap" className="panel roadcard">
      <div className="rc-row">
        <span className="eyebrow">Week {data.week} of {data.totalWeeks} · {m.phase}</span>
        <span className="rc-status" style={{ color: STATUS_TONE[data.status] }}>● {data.status}</span>
      </div>
      <b>Month {m.n}: {m.title}</b>
      <div className="road-line"><i style={{ width: `${data.progress}%` }} />{data.months.map((x, i) => <span key={i} style={{ left: `${(i / data.months.length) * 100}%` }} />)}</div>
      <small className="muted">{m.done}/{m.total} milestones this month · readiness {data.readiness} (aim {data.expectedNow} now, {m.target} by month end)</small>
    </Link>
  );
}

export function RoadmapPage() {
  const { toast } = useProfile();
  const { data, setData } = useLoad(() => api.get<Roadmap>("/roadmap"), []);
  const [editStart, setEditStart] = useState(false);
  if (!data) return <div className="center">Loading…</div>;
  return (
    <>
      <Link to="/" className="back"><Icon name="back" />Home</Link>
      <h2>Your roadmap</h2>
      <p className="lede">{data.totalWeeks} weeks from {fmt(data.start)} to {fmt(data.end)}{data.fromTracker ? " (your next interview)" : ""}. Each month has a focus, a readiness target and milestones that tick themselves off.</p>
      <section className="panel roadsum">
        <div>
          <div className="eyebrow">Week {data.week} of {data.totalWeeks}</div>
          <h3 style={{ margin: "4px 0", color: STATUS_TONE[data.status] }}>{data.status[0].toUpperCase() + data.status.slice(1)}</h3>
          <p className="small muted" style={{ margin: 0 }}>Readiness {data.readiness} vs {data.expectedNow} expected by now{data.gap < 0 ? `: ${-data.gap} point${data.gap === -1 ? "" : "s"} to catch up` : ""}.</p>
        </div>
        <div className="road-line big"><i style={{ width: `${data.progress}%` }} />{data.months.map((x, i) => <span key={i} style={{ left: `${(i / data.months.length) * 100}%` }} />)}</div>
        <button className="linkbtn" onClick={() => setEditStart(!editStart)}>Started on {fmt(data.start)} · change</button>
        {editStart && (
          <form className="row" style={{ gap: 8, alignItems: "center" }} onSubmit={async (e) => { e.preventDefault(); const v = (e.currentTarget.elements.namedItem("s") as HTMLInputElement).value; setData(await api.put<Roadmap>("/roadmap/start", { start: v })); setEditStart(false); toast("Start date updated"); }}>
            <input name="s" className="field" type="date" defaultValue={data.start} style={{ maxWidth: 200 }} /><button className="primary" style={{ marginTop: 0 }}>Save</button>
          </form>
        )}
        <p className="small muted" style={{ marginBottom: 0 }}>Set a target interview date under You and the roadmap stretches or compresses to fit. Rounds in <Link to="/applications">Applications</Link> drive your daily plan countdown.</p>
      </section>
      <div className="months">
        {data.months.map((m) => (
          <section key={m.n} className={`panel month ${m.state}`}>
            <div className="mo-h">
              <span className="mo-n">{m.state === "past" && m.done === m.total ? <Icon name="check" size={15} /> : m.n}</span>
              <span className="lr-t"><b>{m.title}</b><small>{m.phase} · {fmt(m.from)} – {fmt(m.to)} · target readiness {m.target}</small></span>
              <span className="mo-c">{m.done}/{m.total}</span>
            </div>
            {m.state !== "next" || m.n <= data.current + 2 ? (
              <>
                <div className="themegrid" style={{ margin: "8px 0" }}>{m.focus.map((f) => <span key={f} className="themechip">{f}</span>)}</div>
                <div className="checks">
                  {m.checks.map((c) => (
                    <Link key={c.label} to={c.to} className={`check ${c.have >= c.need ? "ok" : ""}`}>
                      <span className="ck">{c.have >= c.need ? <Icon name="check" size={12} /> : null}</span>
                      <span className="ck-t">{c.label}</span>
                      <span className="ck-n">{c.have}/{c.need}</span>
                      <span className="ck-bar"><i style={{ width: `${(c.have / c.need) * 100}%` }} /></span>
                    </Link>
                  ))}
                </div>
              </>
            ) : null}
          </section>
        ))}
      </div>
    </>
  );
}

/* ====================== application tracker ====================== */
type Round = { id: number; kind: string; at: string; notes: string; reflection: string; outcome: "pending" | "passed" | "failed" };
type App = { id: number; company: string; role: string; url: string; stage: string; referral: string; recruiter: string; notes: string; rounds: Round[] };
type Apps = { stages: string[]; next: { at: string; company: string; kind: string } | null; apps: App[] };
const STAGE_LABEL: Record<string, string> = { interested: "Interested", applied: "Applied", recruiter: "Recruiter call", screen: "Screen", onsite: "Onsite / loop", offer: "Offer 🎉", rejected: "Rejected", withdrawn: "Withdrawn" };
const ROUND_KINDS = ["Recruiter call", "Online assessment", "Phone screen", "Coding", "System design", "Behavioural", "Practical / integration", "Bug squash", "Hiring manager", "Final / as appropriate"];

export function ApplicationsPage() {
  const { data, reload } = useLoad(() => api.get<Apps>("/applications"), []);
  const [edit, setEdit] = useState<Partial<App> | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  if (!data) return <div className="center">Loading…</div>;
  const active = data.apps.filter((a) => !["rejected", "withdrawn"].includes(a.stage));
  const closed = data.apps.filter((a) => ["rejected", "withdrawn"].includes(a.stage));
  return (
    <>
      <Link to="/prep" className="back"><Icon name="back" />Prep</Link>
      <h2>Applications</h2>
      <p className="lede">Track roles, referrals and every interview round. Your next round sets the countdown on your plan and roadmap.</p>
      {data.next && <div className="panel nextround"><span className="eyebrow">Next interview</span><b>{data.next.company} · {data.next.kind}</b><small className="muted">{new Date(data.next.at + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</small></div>}
      <div className="pipeline">
        {data.stages.filter((s) => !["rejected", "withdrawn"].includes(s)).map((s) => <span key={s}><b>{data.apps.filter((a) => a.stage === s).length}</b><small>{STAGE_LABEL[s]}</small></span>)}
      </div>
      {edit ? <AppForm app={edit} stages={data.stages} onDone={() => { setEdit(null); reload(); }} /> : <button className="primary" style={{ width: "100%" }} onClick={() => setEdit({ company: "", stage: "interested" })}>Add an application</button>}
      <div className="list" style={{ marginTop: 12 }}>
        {active.map((a) => <AppRow key={a.id} a={a} open={open === a.id} onToggle={() => setOpen(open === a.id ? null : a.id)} onEdit={() => setEdit(a)} onChange={reload} />)}
      </div>
      {closed.length > 0 && (<><h3 className="section-h">Closed</h3><div className="list">{closed.map((a) => <AppRow key={a.id} a={a} open={open === a.id} onToggle={() => setOpen(open === a.id ? null : a.id)} onEdit={() => setEdit(a)} onChange={reload} />)}</div></>)}
    </>
  );
}

function AppRow({ a, open, onToggle, onEdit, onChange }: { a: App; open: boolean; onToggle: () => void; onEdit: () => void; onChange: () => void }) {
  const [round, setRound] = useState<Partial<Round> | null>(null);
  const upcoming = a.rounds.find((r) => r.at >= new Date().toISOString().slice(0, 10));
  return (
    <div className="panel approw">
      <button className="qrow-h" onClick={onToggle}>
        <span className="lr-t"><b>{a.company}{a.role ? ` · ${a.role}` : ""}</b><small>{STAGE_LABEL[a.stage]}{upcoming ? ` · next: ${upcoming.kind} ${fmt(upcoming.at)}` : ""}{a.referral ? " · referred" : ""}</small></span>
        <span className={`stagechip st-${a.stage}`}>{STAGE_LABEL[a.stage]}</span>
      </button>
      {open && (
        <div className="qrow-b">
          {a.url && <p className="small"><a href={a.url} target="_blank" rel="noreferrer">Job posting ↗</a></p>}
          {(a.referral || a.recruiter) && <p className="small muted">{a.referral && `Referral: ${a.referral}`}{a.referral && a.recruiter ? " · " : ""}{a.recruiter && `Recruiter: ${a.recruiter}`}</p>}
          {a.notes && <p className="small" style={{ whiteSpace: "pre-wrap" }}>{a.notes}</p>}
          <div className="steplabel"><span>Rounds</span></div>
          {a.rounds.length === 0 && <p className="small muted">No rounds yet.</p>}
          {a.rounds.map((r) => (
            <button key={r.id} className={`round out-${r.outcome}`} onClick={() => setRound(r)}>
              <span className="lr-t"><b>{r.kind}</b><small>{fmt(r.at)}{r.outcome !== "pending" ? ` · ${r.outcome}` : ""}{r.reflection ? " · reflection saved" : ""}</small></span><Icon name="arrow" size={14} />
            </button>
          ))}
          {round ? <RoundForm appId={a.id} r={round} onDone={() => { setRound(null); onChange(); }} /> : (
            <div className="row" style={{ gap: 8 }}>
              <button className="ghost" onClick={() => setRound({ kind: "Phone screen", at: new Date().toISOString().slice(0, 10), outcome: "pending" })}>Add round</button>
              <button className="ghost" onClick={onEdit}>Edit</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AppForm({ app, stages, onDone }: { app: Partial<App>; stages: string[]; onDone: () => void }) {
  const [f, setF] = useState<Partial<App>>(app);
  const { toast } = useProfile();
  const set = (k: keyof App) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function save(e: FormEvent) { e.preventDefault(); await api.post("/applications", f); toast("Saved"); onDone(); }
  async function remove() { if (!f.id || !confirm("Delete this application and its rounds?")) return; await api.del(`/applications/${f.id}`); onDone(); }
  return (
    <form className="panel" onSubmit={save}>
      <label className="lbl">Company</label>
      <input className="field" list="cos" value={f.company ?? ""} onChange={set("company")} required placeholder="MongoDB, Microsoft, Stripe…" />
      <datalist id="cos"><option value="MongoDB" /><option value="Microsoft" /><option value="Stripe" /></datalist>
      <label className="lbl">Role</label><input className="field" value={f.role ?? ""} onChange={set("role")} placeholder="Senior Software Engineer, Atlas" />
      <label className="lbl">Stage</label>
      <select className="field" value={f.stage ?? "interested"} onChange={set("stage")}>{stages.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</select>
      <label className="lbl">Job posting link</label><input className="field" value={f.url ?? ""} onChange={set("url")} placeholder="https://" />
      <label className="lbl">Referral</label><input className="field" value={f.referral ?? ""} onChange={set("referral")} placeholder="Who referred you?" />
      <label className="lbl">Recruiter</label><input className="field" value={f.recruiter ?? ""} onChange={set("recruiter")} placeholder="Name / email" />
      <label className="lbl">Notes</label><textarea className="field" rows={3} value={f.notes ?? ""} onChange={set("notes")} />
      <div className="row" style={{ gap: 8 }}>
        <button className="primary">Save</button><button type="button" className="ghost" onClick={onDone}>Cancel</button>
        {f.id ? <button type="button" className="iconbtn danger" style={{ marginTop: 16 }} onClick={remove}>Delete</button> : null}
      </div>
    </form>
  );
}

function RoundForm({ appId, r, onDone }: { appId: number; r: Partial<Round>; onDone: () => void }) {
  const [f, setF] = useState<Partial<Round>>(r);
  async function save(e: FormEvent) { e.preventDefault(); await api.post(`/applications/${appId}/rounds`, { ...f, roundId: f.id }); onDone(); }
  async function remove() { if (!f.id) return; await api.del(`/rounds/${f.id}`); onDone(); }
  const past = !!f.at && f.at <= new Date().toISOString().slice(0, 10);
  return (
    <form className="roundform" onSubmit={save}>
      <div className="row" style={{ gap: 8 }}>
        <select className="field" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} style={{ flex: 2 }}>{ROUND_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
        <input className="field" type="date" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} style={{ flex: 1 }} />
      </div>
      <textarea className="field" rows={2} value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Interviewer, format, what to prepare…" />
      {past && (<>
        <select className="field" value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value as Round["outcome"] })}>
          <option value="pending">Waiting to hear</option><option value="passed">Passed</option><option value="failed">Didn’t pass</option>
        </select>
        <textarea className="field" rows={3} value={f.reflection ?? ""} onChange={(e) => setF({ ...f, reflection: e.target.value })} placeholder="Reflection: what did they ask? what went well? what would you do differently?" />
      </>)}
      <div className="row" style={{ gap: 8 }}>
        <button className="primary" style={{ marginTop: 6 }}>Save round</button>
        <button type="button" className="ghost" style={{ marginTop: 6 }} onClick={onDone}>Cancel</button>
        {f.id ? <button type="button" className="iconbtn danger" style={{ marginTop: 10 }} onClick={remove}>Delete</button> : null}
      </div>
    </form>
  );
}

/* ====================== project deep dive ====================== */
type DDSection = { key: string; title: string; prompt: string; tips: string[]; keyPoints: string[]; text: string; best: number | null };
type DD = { sections: DDSection[]; probes: { id: string; q: string; section: string; why: string; best: number | null }[] };

export function DeepDivePage() {
  const { data, reload } = useLoad(() => api.get<DD>("/deepdive"), []);
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<"write" | "probes">("write");
  if (!data) return <div className="center">Loading…</div>;
  const passed = data.sections.filter((s) => (s.best ?? 0) >= 7).length;
  const current = open ?? data.sections.find((s) => (s.best ?? 0) < 7)?.key ?? data.sections[0]?.key;
  return (
    <>
      <Link to="/prep" className="back"><Icon name="back" />Prep</Link>
      <h2>Project deep dive</h2>
      <p className="lede">Stripe and MongoDB commonly spend a whole round on one project you built. Write up your strongest one section by section, get each part reviewed, then practise the probing questions.</p>
      <div className="segbar" style={{ marginBottom: 12 }}>{data.sections.map((s) => <i key={s.key} className={(s.best ?? 0) >= 7 ? "ok" : s.best != null ? "part" : ""} title={s.title} />)}</div>
      <div className="seg">
        <button className={tab === "write" ? "on" : ""} onClick={() => setTab("write")}>Write-up ({passed}/{data.sections.length})</button>
        <button className={tab === "probes" ? "on" : ""} onClick={() => setTab("probes")}>Probing questions ({data.probes.length})</button>
      </div>
      {tab === "write" ? (
        <div className="steps">
          {data.sections.map((s, i) => <DDSectionCard key={s.key} n={i + 1} s={s} open={current === s.key} onOpen={() => setOpen(s.key)} onGraded={reload} />)}
        </div>
      ) : (
        <div className="list">
          {data.probes.map((p) => (
            <details key={p.id} className="panel qrow">
              <summary className="qrow-h"><span className="lr-t"><b>{p.q}</b><small>{data.sections.find((s) => s.key === p.section)?.title}{p.best != null ? ` · best ${p.best}/10` : ""}</small></span></summary>
              <div className="qrow-b"><p className="small muted">Tests: {p.why}</p><GradeBox kind="probe" id={p.id} title="Your answer" placeholder="Answer about your own project, specifically." /></div>
            </details>
          ))}
        </div>
      )}
    </>
  );
}

function DDSectionCard({ n, s, open, onOpen, onGraded }: { n: number; s: DDSection; open: boolean; onOpen: () => void; onGraded: () => void }) {
  const [text, setText] = useState(s.text);
  const saved = useRef(s.text);
  useEffect(() => {
    if (text === saved.current) return;
    const t = setTimeout(() => api.put(`/deepdive/${s.key}`, { text }).then(() => { saved.current = text; }).catch(() => {}), 800);
    return () => clearTimeout(t);
  }, [text, s.key]);
  const status = (s.best ?? 0) >= 7 ? "ok" : s.best != null ? "part" : "";
  return (
    <section className={`panel step ${open ? "open" : ""}`}>
      <button className="step-h" onClick={onOpen}>
        <span className={`step-n ${status}`}>{status === "ok" ? <Icon name="check" size={14} /> : n}</span>
        <span className="step-t"><b>{s.title}</b>{s.best != null && <small>best {s.best}/10</small>}</span>
      </button>
      {open && (
        <div className="step-b">
          <p className="small muted" style={{ marginTop: 0 }}>{s.prompt}</p>
          <ul className="tidy small muted">{s.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
          <textarea className="field" rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder="Be specific: numbers, names of systems, what YOU decided." />
          <GradeBox kind="project" id={s.key} answer={text} onAnswer={setText} hideInput title={`${s.title} review`} onGraded={onGraded} />
        </div>
      )}
    </section>
  );
}

/* ====================== why us + questions to ask ====================== */
type Why = { id: string; name: string; prompt: string; askThem: { group: string; q: string }[]; best: number | null };
export function WhyUsPage() {
  const { data, reload } = useLoad(() => api.get<Why[]>("/whyus"), []);
  const [co, setCo] = useState<string>("");
  if (!data) return <div className="center">Loading…</div>;
  const c = data.find((x) => x.id === co) ?? data[0];
  if (!c) return <p className="muted">No company content yet.</p>;
  const groups = [...new Set(c.askThem.map((q) => q.group))];
  return (
    <>
      <Link to="/prep" className="back"><Icon name="back" />Prep</Link>
      <h2>Why us &amp; questions to ask</h2>
      <p className="lede">Two moments that decide a lot: “why do you want to work here?” and “do you have any questions for us?”. Prepare both for each company.</p>
      <div className="seg">{data.map((x) => <button key={x.id} className={c.id === x.id ? "on" : ""} onClick={() => setCo(x.id)}>{x.name}{x.best != null ? ` · ${x.best}/10` : ""}</button>)}</div>
      <section className="panel">
        <h3 style={{ marginTop: 0 }}>{c.prompt}</h3>
        <GradeBox key={c.id} kind="why" id={c.id} title="Your answer" placeholder={`Specific reasons: the product, the engineering, and how it connects to what you've built.`} onGraded={reload} />
      </section>
      <h3 className="section-h">Questions to ask {c.name}</h3>
      {groups.map((g) => (
        <section key={g} className="panel askthem">
          <div className="steplabel" style={{ marginTop: 0 }}><span>{g}</span></div>
          <ul className="tidy">{c.askThem.filter((q) => q.group === g).map((q, i) => <li key={i}>{q.q}</li>)}</ul>
        </section>
      ))}
    </>
  );
}

/* ====================== estimation drills ====================== */
type EstItem = { id: string; title: string; level: string; topic: string; company: string | null; solved: boolean; attempts: number };
type EstList = { reference: { group: string; items: [string, string][] }[]; drills: EstItem[] };
type Reveal = { answer: number; steps: string[]; assumptions: string[]; takeaway: string };
type EstDetail = { id: string; title: string; level: string; topic: string; prompt: string; unit: string; tolerance: number; attempts: number; solved: boolean; last: number | null; reveal: Reveal | null };
const human = (n: number) => (n >= 1e12 ? `${+(n / 1e12).toPrecision(3)} trillion` : n >= 1e9 ? `${+(n / 1e9).toPrecision(3)} billion` : n >= 1e6 ? `${+(n / 1e6).toPrecision(3)} million` : n >= 1e4 ? `${+(n / 1e3).toPrecision(3)}k` : `${+n.toPrecision(3)}`);

export function EstimationList() {
  const { data } = useLoad(() => api.get<EstList>("/estimation"), []);
  const [tab, setTab] = useState<"drills" | "ref">("drills");
  if (!data) return <div className="center">Loading…</div>;
  const topics = [...new Set(data.drills.map((d) => d.topic))];
  return (
    <>
      <Link to="/prep" className="back"><Icon name="back" />Prep</Link>
      <h2>Estimation drills</h2>
      <p className="lede">Back-of-envelope maths for system design. Get within the allowed range of the reference answer; the worked solution shows the steps. {data.drills.filter((d) => d.solved).length}/{data.drills.length} solved.</p>
      <div className="seg"><button className={tab === "drills" ? "on" : ""} onClick={() => setTab("drills")}>Drills</button><button className={tab === "ref" ? "on" : ""} onClick={() => setTab("ref")}>Numbers to know</button></div>
      {tab === "ref" ? data.reference.map((g) => (
        <section key={g.group} className="panel refsheet">
          <div className="steplabel" style={{ marginTop: 0 }}><span>{g.group}</span></div>
          {g.items.map(([k, v]) => <div key={k} className="pw-row"><span>{k}</span><b>{v}</b></div>)}
        </section>
      )) : topics.map((t) => (
        <div key={t}>
          <h3 className="section-h">{t}</h3>
          <div className="list">{data.drills.filter((d) => d.topic === t).map((d) => (
            <Link key={d.id} to={`/estimation/${d.id}`} className="listrow"><span className="lr-t"><b>{d.title}</b><small><span className={`lvl ${d.level}`}>{d.level}</span>{d.company ? ` · ${d.company}` : ""}</small></span>
              {d.solved ? <span className="donemark"><Icon name="check" size={13} /></span> : <Icon name="arrow" />}</Link>
          ))}</div>
        </div>
      ))}
    </>
  );
}

export function EstimationPlay() {
  const { id } = useParams();
  const nav = useNavigate();
  const { reward } = useProfile();
  const { data, setData } = useLoad(() => api.get<EstDetail>(`/estimation/${id}`), [id]);
  const { data: list } = useLoad(() => api.get<EstList>("/estimation"), []);
  const [val, setVal] = useState("");
  const [res, setRes] = useState<{ ok: boolean; ratio: number; off: string } | null>(null);
  useEffect(() => { setVal(""); setRes(null); }, [id]);
  if (!data) return <div className="center">Loading…</div>;
  const next = list && list.drills[list.drills.findIndex((x) => x.id === data.id) + 1];
  const parse = (s: string) => { const m = s.trim().toLowerCase().replace(/,/g, "").match(/^([\d.]+)\s*(k|m|b|t|thousand|million|billion|trillion)?$/); if (!m) return NaN; const mult = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, billion: 1e9, t: 1e12, trillion: 1e12 }[m[2] as "k"] ?? 1; return parseFloat(m[1]) * mult; };
  const v = parse(val);
  async function check(e: FormEvent) {
    e.preventDefault();
    const r = await api.post<{ ok: boolean; ratio: number; off: string; xp: number; newBadges: Badge[]; attempts: number; reveal: Reveal | null }>(`/estimation/${data!.id}`, { value: v });
    setRes(r); reward(r.xp, r.newBadges);
    setData({ ...data!, attempts: r.attempts, solved: data!.solved || r.ok, reveal: r.reveal ?? data!.reveal });
  }
  return (
    <>
      <Link to="/estimation" className="back"><Icon name="back" />Estimation</Link>
      <div className="chips" style={{ marginBottom: 6 }}><span className={`chip lvl ${data.level}`}>{data.level}</span><span className="chip">{data.topic}</span>{data.solved && <span className="done-tag"><Icon name="check" size={11} />Solved</span>}</div>
      <h2>{data.title}</h2>
      <section className="panel"><Prose text={data.prompt} /></section>
      <form className="panel estform" onSubmit={check}>
        <label className="lbl" htmlFor="ev">Your estimate ({data.unit})</label>
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <input id="ev" className="field" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} placeholder="e.g. 12000 or 12k" style={{ flex: 1 }} />
          <button className="primary" style={{ marginTop: 0 }} disabled={!(v > 0)}>Check</button>
        </div>
        <small className="muted">{v > 0 ? `= ${human(v)} ${data.unit}` : "You can type 12k, 3.5m, 2b"} · counts if within ×{data.tolerance} of the reference</small>
        {res && <div className={`explain ${res.ok ? "ok" : "bad"}`} style={{ marginTop: 10 }}><b>{res.ok ? (res.ratio <= 1.3 ? "Spot on 🎯" : "Close enough ✓") : `Off by ×${res.ratio}: too ${res.off}.`}</b>{!res.ok && !data.reveal && <span className="small"> Check your assumptions and try once more.</span>}</div>}
      </form>
      {data.reveal && (
        <section className="panel">
          <h3 style={{ marginTop: 0 }}>Reference: {human(data.reveal.answer)} {data.unit}</h3>
          <ol className="tidy small">{data.reveal.steps.map((s, i) => <li key={i}><Prose text={s} /></li>)}</ol>
          {data.reveal.assumptions.length > 0 && <p className="small muted">Assumptions: {data.reveal.assumptions.join("; ")}</p>}
          <div className="coach-tip"><b>So what?</b><span>{data.reveal.takeaway}</span></div>
        </section>
      )}
      {next && <button className="ghost" style={{ width: "100%" }} onClick={() => nav(`/estimation/${next.id}`)}>Next: {next.title}<Icon name="arrow" /></button>}
    </>
  );
}

export { tone };
