import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type NoteItem } from "../api";
import { useLoad } from "../state";

export function NotesPage() {
  const { data, error } = useLoad(() => api.get<NoteItem[]>("/notes"), []);
  const [filter, setFilter] = useState<"all" | "starred" | "notes">("all");
  if (error) return <p className="err">{error}</p>;
  if (!data) return <div className="center">Loading…</div>;

  const shown = data.filter((n) => filter === "all" || (filter === "starred" ? n.starred : !!n.note));
  return (
    <>
      <h2>Notes & starred cards</h2>
      <p className="lede">Everything you've starred or annotated while reading cards, in book order. A good last‑minute revision sheet.</p>
      <div className="row" style={{ marginBottom: 16 }}>
        {(["all", "starred", "notes"] as const).map((f) => (
          <button key={f} className={`iconbtn ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)}>
            {f === "all" ? `All (${data.length})` : f === "starred" ? `★ Starred (${data.filter((n) => n.starred).length})` : `✎ With notes (${data.filter((n) => n.note).length})`}
          </button>
        ))}
        {data.length > 0 && <button className="iconbtn" onClick={() => window.print()}>Print</button>}
      </div>
      {shown.length === 0 ? (
        <p className="muted">Nothing here yet. Open a chapter's <b>Learn</b> mode and use ☆ Star or ✎ Add note on any card.</p>
      ) : (
        <div className="list">
          {shown.map((n) => (
            <div key={n.cardId} className="item">
              <div className="meta">
                <Link className="chip" to={`/chapter/${n.chapterId}`}>{n.chapterLabel}</Link>
                {n.starred && <span>★</span>}
                <Link to={`/chapter/${n.chapterId}/learn?i=${n.cardId % 1000}`} className="small">open card →</Link>
              </div>
              <h4 style={{ marginTop: 6 }}>{n.title}</h4>
              {n.note && <div className="note">{n.note}</div>}
              <details className="reveal"><summary>Card contents</summary><ul>{n.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul></details>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
