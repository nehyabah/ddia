import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Badge } from "../api";
import { useLoad, useProfile } from "../state";
import { Editor, runWorker } from "../components/Editor";
import { Prose } from "../components/CodeView";
import { Icon } from "../components/ui";

type Ex = { id: string; title: string; level: string; topic: string; kind: "find" | "aggregate" | "choice"; collection?: string; prompt: string; hints: string[]; options?: string[]; orderMatters?: boolean; solved: boolean; attempts: number };
type Detail = Ex & { answer: string; expectedCount: number | null; solution: unknown; explanation: string | null; correct: number | null };
type Check = { ok: boolean; xp: number; newBadges: Badge[]; attempts: number; solution: unknown; explanation: string | null; correct: number | null; expectedCount: number | null };

let datasetsCache: Record<string, unknown[]> | null = null;

export function MongoList() {
  const { data } = useLoad(() => api.get<Ex[]>("/mongo"), []);
  if (!data) return <div className="center">Loading…</div>;
  const topics = [...new Set(data.map((e) => e.topic))];
  return (
    <>
      <Link to="/prep" className="back"><Icon name="back" />Prep</Link>
      <h2>MongoDB lab</h2>
      <p className="lede">Write real queries and aggregation pipelines. They run against sample collections in your browser and are checked against the expected result. {data.filter((e) => e.solved).length}/{data.length} solved.</p>
      {topics.map((t) => (
        <div key={t}>
          <h3 className="section-h" style={{ textTransform: "capitalize" }}>{t}</h3>
          <div className="list">
            {data.filter((e) => e.topic === t).map((e) => (
              <Link key={e.id} to={`/mongo/${e.id}`} className="listrow">
                <span className="lr-t"><b>{e.title}</b><small><span className={`lvl ${e.level}`}>{e.level}</span> · {e.kind === "choice" ? "concept" : `${e.kind} on ${e.collection}`}</small></span>
                {e.solved ? <span className="donemark"><Icon name="check" size={13} /></span> : <Icon name="arrow" />}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

const TEMPLATE = { find: "{\n  filter: {  },\n  projection: null,\n  sort: null,\n  limit: null\n}", aggregate: "[\n  { $match: {  } }\n]" };

export function MongoPlay() {
  const { id } = useParams();
  const nav = useNavigate();
  const { reward } = useProfile();
  const { data, setData } = useLoad(() => api.get<Detail>(`/mongo/${id}`), [id]);
  const { data: list } = useLoad(() => api.get<Ex[]>("/mongo"), []);
  const [text, setText] = useState("");
  const [out, setOut] = useState<{ ok: boolean; output?: unknown[]; error?: string } | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [showData, setShowData] = useState(false);
  const [datasets, setDatasets] = useState(datasetsCache);

  useEffect(() => { if (!datasetsCache) api.get<Record<string, unknown[]>>("/mongo/datasets").then((d) => { datasetsCache = d; setDatasets(d); }); }, []);
  useEffect(() => { if (data) { setText(data.answer || (data.kind === "choice" ? "" : TEMPLATE[data.kind])); setOut(null); setCheck(null); setChoice(null); } }, [data?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data || !datasets) return <div className="center">Loading…</div>;
  const next = list && list[list.findIndex((x) => x.id === data.id) + 1];

  async function runQuery(): Promise<{ ok: boolean; output?: unknown[]; error?: string }> {
    const r = await runWorker<{ ok: boolean; output?: unknown[]; error?: string }>(() => new Worker(new URL("../workers/mongoRunner.ts", import.meta.url), { type: "module" }),
      { kind: data!.kind, collection: data!.collection, text, datasets }, 5000).catch((e) => ({ ok: false, error: (e as Error).message }));
    setOut(r);
    return r;
  }
  async function submit() {
    setBusy(true);
    try {
      let body: Record<string, unknown>;
      if (data!.kind === "choice") body = { choice, answer: String(choice) };
      else { const r = await runQuery(); if (!r.ok) return; body = { output: r.output, answer: text }; }
      const c = await api.post<Check>(`/mongo/${data!.id}/check`, body);
      setCheck(c);
      if (c.xp) reward(c.xp, c.newBadges);
      if (c.ok) setData({ ...data!, solved: true });
    } finally { setBusy(false); }
  }

  const sample = data.collection ? (datasets[data.collection] ?? []) : [];
  return (
    <>
      <Link to="/mongo" className="back"><Icon name="back" />MongoDB lab</Link>
      <div className="chips" style={{ marginBottom: 6 }}><span className={`chip lvl ${data.level}`}>{data.level}</span><span className="chip">{data.topic}</span>{data.solved && <span className="done-tag"><Icon name="check" size={11} />Solved</span>}</div>
      <h2>{data.title}</h2>
      <section className="panel"><Prose text={data.prompt} />
        {data.collection && <button className="linkbtn" onClick={() => setShowData(!showData)}>{showData ? "Hide" : "Show"} the <code className="ic">{data.collection}</code> collection ({sample.length} docs)</button>}
        {showData && <pre className="code prosecode small-code">{JSON.stringify(sample.slice(0, 6), null, 2)}{sample.length > 6 ? `\n… ${sample.length - 6} more` : ""}</pre>}
      </section>

      {data.kind === "choice" ? (
        <div className="opts">
          {data.options!.map((o, i) => {
            const cls = check ? (i === check.correct ? "right" : i === choice && !check.ok ? "wrong" : "") : i === choice ? "picked" : "";
            return <button key={i} className={`opt ${cls}`} disabled={!!check?.ok} onClick={() => { setChoice(i); setCheck(null); }}><span className="ot"><Prose text={o} /></span></button>;
          })}
        </div>
      ) : (
        <>
          <p className="small muted" style={{ margin: "4px 0" }}>{data.kind === "find" ? <>Write <code className="ic">{"{ filter, projection, sort, limit }"}</code> (or just a filter). Shell syntax is fine.</> : <>Write the pipeline as an array of stages.</>}</p>
          <Editor value={text} onChange={setText} rows={10} />
        </>
      )}
      <div className="row" style={{ gap: 8 }}>
        {data.kind !== "choice" && <button className="ghost" onClick={runQuery} disabled={busy}>Run</button>}
        <button className="primary" onClick={submit} disabled={busy || (data.kind === "choice" && choice == null)}>Check</button>
        {data.hints.length > 0 && <details className="hintd"><summary>Hint</summary><ul className="tidy small">{data.hints.map((h, i) => <li key={i}>{h}</li>)}</ul></details>}
      </div>

      {out && !out.ok && <pre className="console err">{out.error}</pre>}
      {out?.ok && <section className="panel"><div className="steplabel" style={{ marginTop: 0 }}><span>Output</span><span className="n">{out.output!.length} docs{data.expectedCount != null ? ` · expected ${data.expectedCount}` : ""}</span></div>
        <pre className="code prosecode small-code">{JSON.stringify(out.output!.slice(0, 20), null, 2)}{out.output!.length > 20 ? "\n…" : ""}</pre></section>}
      {check && (
        <div className={`explain ${check.ok ? "ok" : "bad"}`}>
          <b>{check.ok ? "Correct." : check.attempts >= 3 ? "Not quite. Here is the answer." : `Not quite${check.expectedCount != null ? ` (expected ${check.expectedCount} docs)` : ""}. Try again.`}</b>
          {check.explanation && <p className="small" style={{ margin: "6px 0 0" }}>{check.explanation}</p>}
          {check.solution != null && data.kind !== "choice" && <pre className="code prosecode small-code">{JSON.stringify(check.solution, null, 2)}</pre>}
        </div>
      )}
      {next && <button className="ghost" style={{ width: "100%" }} onClick={() => nav(`/mongo/${next.id}`)}>Next: {next.title}<Icon name="arrow" /></button>}
    </>
  );
}
