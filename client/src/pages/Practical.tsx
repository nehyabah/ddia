import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Badge } from "../api";
import { useLoad, useProfile } from "../state";
import { Editor, runWorker } from "../components/Editor";
import { Prose } from "../components/CodeView";
import { Icon } from "../components/ui";
import { CompanyChip } from "./Companies";

type PFile = { path: string; code: string };
type Item = { id: string; kind: "bugsquash" | "integration"; title: string; level: string; company: string; total: number; attempts: number; bestPassed: number; solved: boolean };
type Reveal = { fixedFiles: PFile[] | null; solution: string | null; explanation: string | null; keyPoints: string[] | null };
type Detail = {
  id: string; kind: "bugsquash" | "integration"; title: string; level: string; company: string; brief: string; hints: string[];
  tests: { name: string; call: string; expected: unknown }[]; files?: PFile[]; bugs?: number; docs?: string; fakeApi?: string; fn?: string; starter?: string;
  work: PFile[] | string | null; attempts: number; solved: boolean; reveal: Reveal | null;
};
type Run = { results: { name: string; ok: boolean; got?: string; expected: string; error?: string; ms: number }[]; logs: string[] };

const KIND = { bugsquash: { label: "Bug squash", sub: "Fix bugs in an unfamiliar multi-file codebase until the tests pass." }, integration: { label: "Integration", sub: "Read the API docs, then write a client that handles paging, rate limits and retries." } };

export function PracticalList() {
  const { data } = useLoad(() => api.get<Item[]>("/practical"), []);
  if (!data) return <div className="center">Loading…</div>;
  return (
    <>
      <Link to="/prep" className="back"><Icon name="back" />Prep</Link>
      <h2>Practical rounds</h2>
      <p className="lede">Modelled on the hands-on rounds Stripe is commonly reported to run. Everything runs in your browser.</p>
      {(["bugsquash", "integration"] as const).map((k) => (
        <div key={k}>
          <h3 className="section-h">{KIND[k].label}</h3>
          <p className="small muted" style={{ marginTop: -6 }}>{KIND[k].sub}</p>
          <div className="list">
            {data.filter((d) => d.kind === k).map((d) => (
              <Link key={d.id} to={`/practical/${d.id}`} className="listrow">
                <span className="lr-t"><b>{d.title}</b><small><span className={`lvl ${d.level}`}>{d.level}</span>{d.attempts && !d.solved ? ` · ${d.bestPassed}/${d.total} tests` : ""}</small></span>
                <CompanyChip id={d.company} />
                {d.solved ? <span className="donemark"><Icon name="check" size={13} /></span> : <Icon name="arrow" />}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

export function PracticalPlay() {
  const { id } = useParams();
  const nav = useNavigate();
  const { reward } = useProfile();
  const { data, setData } = useLoad(() => api.get<Detail>(`/practical/${id}`), [id]);
  const { data: list } = useLoad(() => api.get<Item[]>("/practical"), []);
  const [files, setFiles] = useState<PFile[]>([]);
  const [code, setCode] = useState("");
  const [tab, setTab] = useState(0);
  const [view, setView] = useState<"code" | "docs">("code");
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [hints, setHints] = useState(0);
  const loaded = useRef("");

  useEffect(() => {
    if (!data || loaded.current === data.id) return;
    loaded.current = data.id;
    if (data.kind === "bugsquash") setFiles(Array.isArray(data.work) ? data.work : data.files ?? []);
    else setCode(typeof data.work === "string" ? data.work : data.starter ?? "");
    setRun(null); setTab(0); setHints(0); setView(data.kind === "integration" ? "docs" : "code");
  }, [data]);
  const work = data?.kind === "bugsquash" ? files : code;
  useEffect(() => {
    if (!data || loaded.current !== data.id) return;
    const t = setTimeout(() => api.put(`/practical/${data.id}/work`, { work }).catch(() => {}), 1200);
    return () => clearTimeout(t);
  }, [work]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <div className="center">Loading…</div>;
  const next = list && list[list.findIndex((x) => x.id === data.id) + 1];

  async function runTests() {
    if (!data) return;
    setBusy(true);
    try {
      const program = data.kind === "bugsquash" ? files.map((f) => `// ---- ${f.path}\n${f.code}`).join("\n\n") : `${data.fakeApi}\n\n${code}`;
      const r = await runWorker<Run>(() => new Worker(new URL("../workers/codeRunner.ts", import.meta.url), { type: "module" }), { code: program, tests: data.tests }, 15000);
      setRun(r);
      const passed = r.results.filter((x) => x.ok).length;
      const res = await api.post<{ solved: boolean; xp: number; newBadges: Badge[]; reveal: Reveal | null }>(`/practical/${data.id}/result`, { passed, work });
      if (res.xp) reward(res.xp, res.newBadges);
      setData({ ...data, solved: data.solved || res.solved, attempts: data.attempts + 1, reveal: res.reveal ?? data.reveal });
    } catch (e) { setRun({ results: [{ name: "run", ok: false, error: (e as Error).message, expected: "" , ms: 0 }], logs: [] }); }
    finally { setBusy(false); }
  }
  function reset() {
    if (!data || !confirm("Reset your changes?")) return;
    if (data.kind === "bugsquash") setFiles(data.files ?? []); else setCode(data.starter ?? "");
  }

  const passed = run?.results.filter((x) => x.ok).length ?? 0;
  return (
    <>
      <Link to="/practical" className="back"><Icon name="back" />Practical rounds</Link>
      <div className="chips" style={{ marginBottom: 6 }}><span className="chip">{KIND[data.kind].label}</span><span className={`chip lvl ${data.level}`}>{data.level}</span>{data.bugs ? <span className="chip">{data.bugs} {data.bugs === 1 ? "bug" : "bugs"}</span> : null}{data.solved && <span className="done-tag"><Icon name="check" size={11} />Solved</span>}</div>
      <h2>{data.title}</h2>
      <section className="panel"><Prose text={data.brief} /></section>

      {data.kind === "integration" && (
        <div className="seg">
          <button className={view === "docs" ? "on" : ""} onClick={() => setView("docs")}>API docs</button>
          <button className={view === "code" ? "on" : ""} onClick={() => setView("code")}>Your code</button>
        </div>
      )}
      {data.kind === "integration" && view === "docs" && <section className="panel docs"><Prose text={data.docs ?? ""} /></section>}
      {data.kind === "integration" && view === "code" && <Editor value={code} onChange={setCode} rows={18} />}

      {data.kind === "bugsquash" && (<>
        <div className="seg scrollseg filetabs">{files.map((f, i) => <button key={f.path} className={tab === i ? "on" : ""} onClick={() => setTab(i)}>{f.path}</button>)}</div>
        {files[tab] && <Editor value={files[tab].code} onChange={(v) => setFiles(files.map((f, i) => (i === tab ? { ...f, code: v } : f)))} rows={18} />}
        <details className="panel"><summary className="small"><b>Tests</b> ({data.tests.length})</summary>
          <pre className="code prosecode small-code">{data.tests.map((t) => `// ${t.name}\n${t.call}\n// expect ${JSON.stringify(t.expected)}`).join("\n\n")}</pre></details>
      </>)}

      <div className="row" style={{ gap: 8 }}>
        <button className="primary" onClick={runTests} disabled={busy}>{busy ? "Running…" : "Run tests"}</button>
        <button className="ghost" onClick={reset}>Reset</button>
        {hints < data.hints.length && <button className="ghost" onClick={() => setHints(hints + 1)}><Icon name="bulb" />Hint {hints + 1}</button>}
      </div>
      {hints > 0 && <div className="coach-tip" style={{ marginTop: 12 }}><b>Hints</b>{data.hints.slice(0, hints).map((h, i) => <span key={i}>{i + 1}. {h}</span>)}</div>}

      {run && (
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

      {data.reveal && (
        <details className="panel" open={data.solved}>
          <summary><b>{data.solved ? "Debrief" : "Answer"}</b></summary>
          {data.reveal.explanation && <Prose text={data.reveal.explanation} />}
          {data.reveal.keyPoints && <ul className="tidy small">{data.reveal.keyPoints.map((k, i) => <li key={i}>{k}</li>)}</ul>}
          {data.reveal.fixedFiles?.map((f) => <div key={f.path}><div className="steplabel"><span>{f.path} (fixed)</span></div><pre className="code prosecode small-code">{f.code}</pre></div>)}
          {data.reveal.solution && <pre className="code prosecode small-code">{data.reveal.solution}</pre>}
        </details>
      )}
      {next && <button className="ghost" style={{ width: "100%" }} onClick={() => nav(`/practical/${next.id}`)}>Next: {next.title}<Icon name="arrow" /></button>}
    </>
  );
}
