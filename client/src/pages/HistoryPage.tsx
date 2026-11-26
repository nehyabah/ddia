import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Icon } from "../components/ui";

type Item = {
  key: string; kind: string; kindLabel: string; title: string; to: string | null; at: number; score: number; outOf: number;
  answer: string; verdict: string; question: string | null; covered: string[]; missed: string[]; mistakes: string[]; tip: string | null; model: string | null;
};
type Page = { items: Item[]; next: number | null; counts: Record<string, number>; labels: Record<string, string> };

const tone = (s: number, outOf: number) => { const v = (s / outOf) * 10; return v >= 8 ? "var(--teal)" : v >= 5 ? "var(--amber)" : "var(--red)"; };
const when = (t: number) => {
  const d = new Date(t), now = new Date();
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return days === 0 ? `Today ${time}` : days === 1 ? `Yesterday ${time}` : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
};

export function HistoryPage() {
  const [kind, setKind] = useState("");
  const [page, setPage] = useState<Page | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(before?: number) {
    setBusy(true);
    try {
      const p = await api.get<Page>(`/history?kind=${kind}${before ? `&before=${before}` : ""}`);
      setPage(p); setItems((xs) => (before ? [...xs, ...p.items] : p.items));
    } finally { setBusy(false); }
  }
  useEffect(() => { setItems([]); load(); }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = page ? Object.values(page.counts).reduce((a, b) => a + b, 0) : 0;
  return (
    <>
      <Link to="/settings" className="back"><Icon name="back" />You</Link>
      <h2>History</h2>
      <p className="lede">Every answer you’ve had reviewed, with the feedback. {total ? `${total} so far.` : ""}</p>
      {page && (
        <div className="seg scrollseg">
          <button className={!kind ? "on" : ""} onClick={() => setKind("")}>All</button>
          {Object.entries(page.counts).filter(([, n]) => n > 0).map(([k, n]) => <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{page.labels[k] ?? k} ({n})</button>)}
        </div>
      )}
      {page && items.length === 0 && <p className="muted small">Nothing yet. Answers you get reviewed (design, coding, behavioural, explanations, mocks) show up here.</p>}
      <div className="list">
        {items.map((it) => (
          <div key={it.key} className={`panel hist ${open === it.key ? "open" : ""}`}>
            <button className="hist-h" onClick={() => setOpen(open === it.key ? null : it.key)} aria-expanded={open === it.key}>
              <span className="hist-score" style={{ color: tone(it.score, it.outOf) }}>{it.score}<small>/{it.outOf}</small></span>
              <span className="lr-t"><b>{it.title}</b><small>{it.kindLabel} · {when(it.at)}</small></span>
            </button>
            {open === it.key && (
              <div className="hist-b">
                {it.question && <p className="small"><b>Interviewer:</b> {it.question}</p>}
                {it.verdict && <p className="small" style={{ fontWeight: 600 }}>{it.verdict}</p>}
                {it.answer && <><div className="steplabel"><span>Your answer</span></div><p className="hist-answer">{it.answer}</p></>}
                {(it.covered.length > 0 || it.missed.length > 0 || it.mistakes.length > 0) && (
                  <ul className="rubric">
                    {it.covered.map((t, i) => <li key={"c" + i} className="ok"><Icon name="check" size={14} /><span>{t}</span></li>)}
                    {it.missed.map((t, i) => <li key={"m" + i} className="warn"><Icon name="bulb" size={14} /><span>{t}</span></li>)}
                    {it.mistakes.map((t, i) => <li key={"x" + i} className="bad"><Icon name="x" size={14} /><span>{t}</span></li>)}
                  </ul>
                )}
                {it.tip && <div className="coach-tip"><b>Next time</b><span>{it.tip}</span></div>}
                {it.model && <details className="coach-model"><summary>Model answer</summary><p>{it.model}</p></details>}
                {it.to && <Link to={it.to} className="ghost" style={{ marginTop: 12 }}>Practise it again<Icon name="arrow" /></Link>}
              </div>
            )}
          </div>
        ))}
      </div>
      {page?.next && <button className="ghost" style={{ width: "100%" }} disabled={busy} onClick={() => load(page.next!)}>{busy ? "Loading…" : "Load more"}</button>}
    </>
  );
}
