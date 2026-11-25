import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type SearchResult } from "../api";

function highlight(text: string, q: string): ReactNode {
  if (!q) return text;
  const lower = text.toLowerCase(), needle = q.toLowerCase();
  const out: ReactNode[] = [];
  let i = 0, k = 0;
  for (let j = lower.indexOf(needle); j >= 0; j = lower.indexOf(needle, i)) {
    out.push(text.slice(i, j), <mark key={k++}>{text.slice(j, j + q.length)}</mark>);
    i = j + q.length;
  }
  out.push(text.slice(i));
  return out;
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [input, setInput] = useState(q);
  const [res, setRes] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const h = setTimeout(() => {
      if (input !== q) setParams(input ? { q: input } : {}, { replace: true });
    }, 250);
    return () => clearTimeout(h);
  }, [input]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    if (q.trim().length < 2) { setRes(null); return; }
    api.get<SearchResult>(`/search?q=${encodeURIComponent(q)}`)
      .then((r) => !cancelled && setRes(r))
      .catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [q]);

  const total = res ? res.cards.length + res.terms.length + res.questions.length : 0;
  const needle = q.trim();
  return (
    <>
      <h2>Search the book</h2>
      <p className="lede">Find any concept card, glossary term or quiz question across all chapters.</p>
      <div className="searchbar">
        <input className="field" autoFocus placeholder="e.g. quorum, LSM, write skew, linearizable…" value={input} onChange={(e) => setInput(e.target.value)} />
      </div>
      {error && <p className="err">{error}</p>}
      {res && total === 0 && <p className="muted">No matches for “{needle}”.</p>}
      {res && res.terms.length > 0 && (<>
        <h3 className="section-h">Terms</h3>
        <div className="list">{res.terms.map((t) => (
          <div key={t.id} className="item">
            <div className="meta"><Link className="chip" to={`/chapter/${t.chapterId}`}>{t.chapterLabel}</Link></div>
            <h4 style={{ marginTop: 6 }}>{highlight(t.term, needle)}</h4><span className="small muted">{highlight(t.meaning, needle)}</span>
          </div>))}
        </div></>)}
      {res && res.cards.length > 0 && (<>
        <h3 className="section-h">Concept cards</h3>
        <div className="list">{res.cards.map((k) => (
          <div key={k.id} className="item">
            <div className="meta"><Link className="chip" to={`/chapter/${k.chapterId}`}>{k.chapterLabel}</Link><Link className="small" to={`/chapter/${k.chapterId}/learn?i=${k.idx}`}>open card →</Link></div>
            <h4 style={{ marginTop: 6 }}>{highlight(k.title, needle)}</h4>
            <ul>{k.bullets.filter((b) => b.toLowerCase().includes(needle.toLowerCase())).slice(0, 3).map((b, i) => <li key={i}>{highlight(b, needle)}</li>)}</ul>
          </div>))}
        </div></>)}
      {res && res.questions.length > 0 && (<>
        <h3 className="section-h">Quiz questions</h3>
        <div className="list">{res.questions.map((x) => (
          <div key={x.id} className="item">
            <div className="meta"><Link className="chip" to={`/chapter/${x.chapterId}`}>{x.chapterLabel}</Link></div>
            <h4 style={{ marginTop: 6 }}>{highlight(x.prompt, needle)}</h4>
            <details className="reveal"><summary>Show answer</summary><p style={{ margin: "6px 0 0" }}><b>{x.answer}</b></p><p className="small muted" style={{ margin: "4px 0 0" }}>{highlight(x.explanation, needle)}</p></details>
          </div>))}
        </div></>)}
    </>
  );
}
