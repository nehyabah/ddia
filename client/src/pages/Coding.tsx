import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Badge } from "../api";
import { useLoad, useProfile } from "../state";
import { GradeBox } from "../components/GradeBox";
import { Editor, runWorker } from "../components/Editor";
import { Prose } from "../components/CodeView";
import { Icon } from "../components/ui";
import { CompanyChip, CompanyFilter, useCompanyFilter } from "./Companies";

type Item = { id: string; due?: boolean; box?: number; pattern?: string | null; javaOnly?: boolean; company: string | null; title: string; level: string; topic: string; solved: boolean; attempts: number; bestPassed: number; total: number; javaScore: number | null };
type Problem = {
  review?: boolean; javaOnly?: boolean; id: string; title: string; level: string; topic: string; prompt: string; fn: string; hints: string[]; complexity: string;
  tests: { name: string; call: string; expected: unknown }[]; code: { js: string; java: string }; starter: { js: string; java: string };
  solved: boolean; attempts: number; solution: { js: string; java: string } | null;
};
type Run = { results: { name: string; ok: boolean; got?: string; expected: string; error?: string; ms: number }[]; logs: string[] };

export function CodingList() {
  const { data } = useLoad(() => api.get<Item[]>("/coding"), []);
  const [company, setCompany] = useCompanyFilter();
  if (!data) return <div className="center">Loading…</div>;
  const list = data.filter((d) => !company || d.company === company || (company === "general" && !d.company));
  const due = data.filter((d) => d.due);
  const solved = data.filter((d) => d.solved).length;
  return (
    <>
      <Link to="/prep" className="back"><Icon name="back" />Prep</Link>
      <h2>Coding</h2>
      <p className="lede">Write a real solution. JavaScript runs against the test cases right here; Java is reviewed like an interviewer would. {solved}/{data.length} solved.</p>
      {due.length > 0 && (<>
        <h3 className="section-h">Due for review <span className="small muted">re-solve from memory</span></h3>
        <div className="list" style={{ marginBottom: 14 }}>
          {due.map((d) => (
            <Link key={d.id} to={`/coding/${d.id}`} className="listrow due">
              <span className="lr-t"><b>{d.title}</b><small>{d.pattern ?? d.topic} · review #{d.box}</small></span><span className="pill">due</span>
            </Link>
          ))}
        </div>
      </>)}
      <CompanyFilter value={company} onChange={setCompany} />
      <div className="list">
        {list.map((d) => (
          <Link key={d.id} to={`/coding/${d.id}`} className="listrow">
            <span className="lr-t"><b>{d.title}</b><small><span className={`lvl ${d.level}`}>{d.level}</span> · {d.pattern ?? d.topic}{d.javaOnly ? " · Java" : ""}{d.solved && !d.due && d.box ? ` · review ${d.box}/6` : ""}{d.attempts && !d.solved ? ` · ${d.bestPassed}/${d.total} tests` : ""}</small></span>
            <CompanyChip id={d.company} />
            {d.solved ? <span className="donemark"><Icon name="check" size={13} /></span> : <Icon name="arrow" />}
          </Link>
        ))}
      </div>
    </>
  );
}

export function CodingPlay() {
  const { id } = useParams();
  const nav = useNavigate();
  const { reward } = useProfile();
  const { data, setData } = useLoad(() => api.get<Problem>(`/coding/${id}`), [id]);
  const [lang, setLang] = useState<"js" | "java">("js");
  const [code, setCode] = useState({ js: "", java: "" });
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hints, setHints] = useState(0);
  const saved = useRef({ js: "", java: "" });
  const { data: list } = useLoad(() => api.get<Item[]>("/coding"), []);

  useEffect(() => { if (data) { setCode(data.code); saved.current = data.code; setRun(null); setHints(0); setErr(null); setLang(data.javaOnly ? "java" : "js"); } }, [data?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!data || code[lang] === saved.current[lang]) return;
    const t = setTimeout(() => api.put(`/coding/${data.id}/code`, { lang, code: code[lang] }).then(() => { saved.current = { ...saved.current, [lang]: code[lang] }; }).catch(() => {}), 1000);
    return () => clearTimeout(t);
  }, [code, lang, data]);

  if (!data) return <div className="center">Loading…</div>;
  const next = list && list[list.findIndex((x) => x.id === data.id) + 1];

  async function runTests() {
    if (!data) return;
    setBusy(true); setErr(null);
    try {
      const r = await runWorker<Run>(() => new Worker(new URL("../workers/codeRunner.ts", import.meta.url), { type: "module" }), { code: code.js, tests: data.tests });
      setRun(r);
      const passed = r.results.filter((x) => x.ok).length;
      const res = await api.post<{ solved: boolean; xp: number; newBadges: Badge[]; solution: Problem["solution"] }>(`/coding/${data.id}/result`, { passed, code: code.js });
      if (res.xp) reward(res.xp, res.newBadges);
      setData({ ...data, solved: data.solved || res.solved, attempts: data.attempts + 1, solution: res.solution ?? data.solution });
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  const passed = run?.results.filter((x) => x.ok).length ?? 0;
  return (
    <>
      <Link to="/coding" className="back"><Icon name="back" />Coding</Link>
      <div className="chips" style={{ marginBottom: 6 }}><span className={`chip lvl ${data.level}`}>{data.level}</span><span className="chip">{data.topic}</span>{data.solved && <span className="done-tag"><Icon name="check" size={11} />Solved</span>}</div>
      <h2>{data.title}</h2>
      {data.review && <div className="coach-tip" style={{ marginBottom: 12 }}><b>Review</b><span>You solved this before. Re-solve it from scratch without looking: passing pushes the next review further out.</span></div>}
      <section className="panel"><Prose text={data.prompt} /></section>

      {data.javaOnly ? <p className="small muted">Java only: write it, then get a code review focused on correctness under concurrency.</p> : <div className="seg" role="tablist">
        <button role="tab" aria-selected={lang === "js"} className={lang === "js" ? "on" : ""} onClick={() => setLang("js")}>JavaScript · runs tests</button>
        <button role="tab" aria-selected={lang === "java"} className={lang === "java" ? "on" : ""} onClick={() => setLang("java")}>Java · reviewed</button>
      </div>}
      <Editor value={code[lang]} onChange={(v) => setCode({ ...code, [lang]: v })} rows={16} />
      <div className="row" style={{ gap: 8, alignItems: "center" }}>
        {lang === "js" && <button className="primary" onClick={runTests} disabled={busy}>{busy ? "Running…" : "Run tests"}</button>}
        <button className="ghost" onClick={() => setCode({ ...code, [lang]: data.starter[lang] })}>Reset</button>
        {hints < data.hints.length && <button className="ghost" onClick={() => setHints(hints + 1)}><Icon name="bulb" />Hint {hints + 1}</button>}
      </div>
      {hints > 0 && <div className="coach-tip" style={{ marginTop: 12 }}><b>Hints</b>{data.hints.slice(0, hints).map((h, i) => <span key={i}>{i + 1}. {h}</span>)}</div>}
      {err && <p className="err">{err}</p>}

      {lang === "js" && run && (
        <section className="panel testres">
          <h3 style={{ marginTop: 0 }}>{passed === run.results.length ? "All tests passed" : `${passed}/${run.results.length} tests passed`}</h3>
          {run.results.map((t) => (
            <div key={t.name} className={`tr ${t.ok ? "ok" : "bad"}`}>
              <span className="tr-i"><Icon name={t.ok ? "check" : "x"} size={14} /></span>
              <span className="tr-t"><b>{t.name}</b>{!t.ok && <small>{t.error ? `Error: ${t.error}` : `Expected ${t.expected}, got ${t.got}`}</small>}</span>
              <span className="tr-ms">{t.ms}ms</span>
            </div>
          ))}
          {run.logs.length > 0 && <pre className="console">{run.logs.join("\n")}</pre>}
        </section>
      )}
      {lang === "java" && <GradeBox kind="coding" id={data.id} answer={code.java} onAnswer={(v) => setCode({ ...code, java: v })} hideInput title="Code review" />}

      {data.solution && (
        <details className="panel" open={data.solved}>
          <summary><b>Reference solution</b> · {data.complexity}</summary>
          <pre className="code prosecode">{data.solution[lang]}</pre>
        </details>
      )}
      {next && <button className="ghost" style={{ width: "100%" }} onClick={() => nav(`/coding/${next.id}`)}>Next: {next.title}<Icon name="arrow" /></button>}
    </>
  );
}
