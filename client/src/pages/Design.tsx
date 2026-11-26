import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useLoad } from "../state";
import { GradeBox } from "../components/GradeBox";
import { Icon } from "../components/ui";
import { CompanyChip, CompanyFilter, useCompanyFilter } from "./Companies";

type Item = { id: string; company: string | null; title: string; level: string; brief: string; sections: number; passed: number; started: boolean; avg: number | null };
type Section = { key: string; title: string; prompt: string; answer: string; best: number | null };
type Prompt = { id: string; title: string; level: string; brief: string; constraints: string[]; sections: Section[]; modelSummary: string | null };

export function DesignList() {
  const { data } = useLoad(() => api.get<Item[]>("/design"), []);
  const [company, setCompany] = useCompanyFilter();
  if (!data) return <div className="center">Loading…</div>;
  const list = data.filter((d) => !company || d.company === company || (company === "general" && !d.company));
  return (
    <>
      <Link to="/prep" className="back"><Icon name="back" />Prep</Link>
      <h2>System design</h2>
      <p className="lede">Work through a design section by section, the way an interviewer runs it. Each section is reviewed against what a strong senior answer covers; 7/10 passes.</p>
      <CompanyFilter value={company} onChange={setCompany} />
      <div className="list">
        {list.map((d) => (
          <Link key={d.id} to={`/design/${d.id}`} className="listrow">
            <span className="lr-t"><b>{d.title}</b><small>{d.level === "advanced" ? "Advanced" : "Core"} · {d.passed}/{d.sections} sections passed{d.avg != null ? ` · avg ${d.avg}/10` : ""}</small></span>
            <CompanyChip id={d.company} />
            {d.passed === d.sections ? <span className="donemark"><Icon name="check" size={13} /></span> : <Icon name="arrow" />}
          </Link>
        ))}
      </div>
    </>
  );
}

export function DesignPlay() {
  const { id } = useParams();
  const { data, reload } = useLoad(() => api.get<Prompt>(`/design/${id}`), [id]);
  const [open, setOpen] = useState<string | null>(null);
  if (!data) return <div className="center">Loading…</div>;
  const passed = data.sections.filter((s) => (s.best ?? 0) >= 7).length;
  const current = open ?? data.sections.find((s) => (s.best ?? 0) < 7)?.key ?? data.sections[0].key;
  return (
    <>
      <Link to="/design" className="back"><Icon name="back" />System design</Link>
      <h2>{data.title}</h2>
      <section className="panel">
        <p style={{ marginTop: 0 }}>{data.brief}</p>
        <ul className="tidy small">{data.constraints.map((c, i) => <li key={i}>{c}</li>)}</ul>
        <div className="segbar" aria-label={`${passed} of ${data.sections.length} sections passed`}>
          {data.sections.map((s) => <i key={s.key} className={(s.best ?? 0) >= 7 ? "ok" : s.best != null ? "part" : ""} title={s.title} />)}
        </div>
      </section>
      <div className="steps">
        {data.sections.map((s, i) => (
          <SectionCard key={s.key} n={i + 1} promptId={data.id} s={s} open={current === s.key} onOpen={() => setOpen(s.key)} onGraded={reload} />
        ))}
      </div>
      {data.modelSummary && <section className="panel"><h3>Reference design</h3><p className="small">{data.modelSummary}</p></section>}
    </>
  );
}

function SectionCard({ n, promptId, s, open, onOpen, onGraded }: { n: number; promptId: string; s: Section; open: boolean; onOpen: () => void; onGraded: () => void }) {
  const [answer, setAnswer] = useState(s.answer);
  const saved = useRef(s.answer);
  useEffect(() => {
    if (answer === saved.current) return;
    const t = setTimeout(() => { api.put(`/design/${promptId}/${s.key}`, { answer }).then(() => { saved.current = answer; }).catch(() => {}); }, 800);
    return () => clearTimeout(t);
  }, [answer, promptId, s.key]);
  const status = (s.best ?? 0) >= 7 ? "ok" : s.best != null ? "part" : "";
  return (
    <section className={`panel step ${open ? "open" : ""}`}>
      <button className="step-h" onClick={onOpen} aria-expanded={open}>
        <span className={`step-n ${status}`}>{status === "ok" ? <Icon name="check" size={14} /> : n}</span>
        <span className="step-t"><b>{s.title}</b>{s.best != null && <small>best {s.best}/10</small>}</span>
      </button>
      {open && (
        <div className="step-b">
          <p className="small muted" style={{ marginTop: 0 }}>{s.prompt}</p>
          <textarea className="field" rows={8} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Bullet points are fine. Be specific: numbers, choices and why." />
          <GradeBox kind="design" id={`${promptId}:${s.key}`} answer={answer} onAnswer={setAnswer} hideInput title={`${s.title} review`} onGraded={onGraded} />
        </div>
      )}
    </section>
  );
}
