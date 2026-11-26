import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useLoad, useProfile } from "../state";
import { GradeBox } from "../components/GradeBox";
import { Icon } from "../components/ui";
import { CompanyChip, CompanyFilter, useCompanyFilter } from "./Companies";

type Story = { id: number; title: string; themes: string[]; situation: string; task: string; action: string; result: string; best: number | null };
type Q = { id: string; text: string; themes: string[]; level: string; assesses: string; strongSignals: string[]; redFlags: string[]; followUps: string[]; company?: string; value?: string };
type Data = { themes: { id: string; label: string; description: string }[]; questions: Q[]; starGuide: Record<string, string>; stories: Story[]; links: { question_id: string; story_id: number; best_score: number | null }[] };

const storyText = (s: Story) => `Situation: ${s.situation}\nTask: ${s.task}\nAction: ${s.action}\nResult: ${s.result}`;
const EMPTY: Story = { id: 0, title: "", themes: [], situation: "", task: "", action: "", result: "", best: null };

export function BehavioralPage() {
  const { data, reload } = useLoad(() => api.get<Data>("/behavioral"), []);
  const [tab, setTab] = useState<"stories" | "questions">("stories");
  const [edit, setEdit] = useState<Story | null>(null);
  const [theme, setTheme] = useState<string>("");
  const [company, setCompany] = useCompanyFilter();
  const [openQ, setOpenQ] = useState<string | null>(null);
  if (!data) return <div className="center">Loading…</div>;

  const covered = new Set(data.stories.flatMap((s) => s.themes));
  const qs = data.questions.filter((q) => (!theme || q.themes.includes(theme)) && (!company || q.company === company || (company === "general" && !q.company)));
  const label = (id: string) => data.themes.find((t) => t.id === id)?.label ?? id;

  return (
    <>
      <Link to="/prep" className="back"><Icon name="back" />Prep</Link>
      <h2>Behavioural</h2>
      <p className="lede">Build 6–8 strong STAR stories, then map them to the questions they answer and get each one reviewed.</p>
      <div className="themegrid">
        {data.themes.map((t) => <span key={t.id} className={`themechip ${covered.has(t.id) ? "on" : ""}`} title={t.description}>{covered.has(t.id) && <Icon name="check" size={11} />}{t.label}</span>)}
      </div>
      <div className="seg">
        <button className={tab === "stories" ? "on" : ""} onClick={() => setTab("stories")}>Story bank ({data.stories.length})</button>
        <button className={tab === "questions" ? "on" : ""} onClick={() => setTab("questions")}>Questions ({data.questions.length})</button>
      </div>

      {tab === "stories" && (edit ? (
        <StoryForm story={edit} themes={data.themes} guide={data.starGuide} onDone={() => { setEdit(null); reload(); }} />
      ) : (
        <>
          <button className="primary" style={{ width: "100%" }} onClick={() => setEdit(EMPTY)}><Icon name="notes" />New story</button>
          <div className="list" style={{ marginTop: 12 }}>
            {data.stories.length === 0 && <p className="muted small">No stories yet. Start with your proudest project, a failure you learned from, and a disagreement you resolved.</p>}
            {data.stories.map((s) => (
              <button key={s.id} className="listrow" onClick={() => setEdit(s)}>
                <span className="lr-t"><b>{s.title}</b><small>{s.themes.map(label).join(" · ") || "No themes"}{s.best != null ? ` · best ${s.best}/10` : ""}</small></span>
                <Icon name="arrow" />
              </button>
            ))}
          </div>
        </>
      ))}

      {tab === "questions" && (
        <>
          <CompanyFilter value={company} onChange={setCompany} />
          <select className="field" value={theme} onChange={(e) => setTheme(e.target.value)} style={{ marginBottom: 10 }}>
            <option value="">All themes</option>
            {data.themes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <div className="list">
            {qs.map((q) => {
              const link = data.links.find((l) => l.question_id === q.id);
              const story = data.stories.find((s) => s.id === link?.story_id);
              return (
                <div key={q.id} className={`panel qrow ${openQ === q.id ? "open" : ""}`}>
                  <button className="qrow-h" onClick={() => setOpenQ(openQ === q.id ? null : q.id)}>
                    <span className="lr-t"><b>{q.text}</b><small>{q.themes.map(label).join(" · ")}{q.value ? ` · ${q.value}` : ""}{link?.best_score != null ? ` · best ${link.best_score}/10` : story ? " · story linked" : ""}</small></span>
                    <CompanyChip id={q.company ?? null} />
                  </button>
                  {openQ === q.id && <QuestionDetail q={q} stories={data.stories} story={story} onChange={reload} />}
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

function QuestionDetail({ q, stories, story, onChange }: { q: Q; stories: Story[]; story?: Story; onChange: () => void }) {
  return (
    <div className="qrow-b">
      <p className="small"><b>What they’re testing:</b> {q.assesses}</p>
      <details><summary className="small">Strong signals, red flags and follow-ups</summary>
        <ul className="tidy small">{q.strongSignals.map((x, i) => <li key={i}>✓ {x}</li>)}{q.redFlags.map((x, i) => <li key={"r" + i}>✗ {x}</li>)}</ul>
        <p className="small muted">Follow-ups: {q.followUps.join(" · ")}</p>
      </details>
      <label className="lbl">Answer with</label>
      <select className="field" value={story?.id ?? ""} onChange={(e) => api.put(`/behavioral/${q.id}/link`, { storyId: Number(e.target.value) || null }).then(onChange)}>
        <option value="">Choose a story…</option>
        {stories.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
      </select>
      {story && <GradeBox kind="story" id={q.id} answer={storyText(story)} onAnswer={() => {}} hideInput title="Story review" onGraded={onChange} />}
    </div>
  );
}

function StoryForm({ story, themes, guide, onDone }: { story: Story; themes: Data["themes"]; guide: Record<string, string>; onDone: () => void }) {
  const { toast } = useProfile();
  const [s, setS] = useState(story);
  async function save(e: FormEvent) {
    e.preventDefault();
    await api.post("/stories", s.id ? s : { ...s, id: undefined });
    toast("Story saved");
    onDone();
  }
  async function remove() {
    if (!confirm("Delete this story?")) return;
    await api.del(`/stories/${s.id}`);
    onDone();
  }
  const field = (k: "situation" | "task" | "action" | "result", label: string, rows: number) => (
    <>
      <label className="lbl" htmlFor={k}>{label}</label>
      <p className="small muted" style={{ margin: "0 0 4px" }}>{guide[k]}</p>
      <textarea id={k} className="field" rows={rows} value={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.value })} />
    </>
  );
  return (
    <form className="panel" onSubmit={save}>
      <label className="lbl" htmlFor="st">Title</label>
      <input id="st" className="field" value={s.title} onChange={(e) => setS({ ...s, title: e.target.value })} placeholder="e.g. Cutting p99 latency on the billing API" required />
      <label className="lbl">Themes it shows</label>
      <div className="themegrid">
        {themes.map((t) => {
          const on = s.themes.includes(t.id);
          return <button type="button" key={t.id} className={`themechip ${on ? "on" : ""}`} onClick={() => setS({ ...s, themes: on ? s.themes.filter((x) => x !== t.id) : [...s.themes, t.id] })}>{t.label}</button>;
        })}
      </div>
      {field("situation", "Situation", 3)}
      {field("task", "Task", 2)}
      {field("action", "Action (what YOU did)", 6)}
      {field("result", "Result (numbers)", 3)}
      <div className="row" style={{ gap: 8 }}>
        <button className="primary">Save</button>
        <button type="button" className="ghost" onClick={onDone}>Cancel</button>
        {s.id ? <button type="button" className="iconbtn danger" onClick={remove} style={{ marginTop: 16 }}>Delete</button> : null}
      </div>
    </form>
  );
}
