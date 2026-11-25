import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type JavaListItem } from "../api";
import { useLoad } from "../state";
import { Icon } from "../components/ui";

const LEVELS = ["all", "beginner", "intermediate", "advanced", "expert"] as const;

const status = (c: JavaListItem) =>
  c.box == null ? { cls: "", label: "new" } : c.box === 0 ? { cls: "missed", label: "missed last time" }
  : c.box >= 3 ? { cls: "learned", label: "learned" } : { cls: "learning", label: "learning" };

export function JavaBrowse() {
  const { data, error } = useLoad(() => api.get<JavaListItem[]>("/java/challenges"), []);
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("all");
  const [q, setQ] = useState("");
  const [hideSolved, setHideSolved] = useState(false);
  if (error) return <p className="err">{error}</p>;
  if (!data) return <div className="center">Loading…</div>;

  const needle = q.trim().toLowerCase();
  const shown = data.filter((c) => (level === "all" || c.level === level) && (!hideSolved || !c.solved)
    && (!needle || c.title.toLowerCase().includes(needle) || c.topic.toLowerCase().includes(needle)));

  return (
    <>
      <Link className="back" to="/java"><Icon name="back" size={16} />Java</Link>
      <h2>All challenges</h2>
      <p className="lede">Pick any bug to solve directly. Dots: grey new · amber learning · teal learned · red missed last time.</p>
      <div className="chips" style={{ marginBottom: 10 }}>
        {LEVELS.map((l) => (
          <button key={l} className={`iconbtn ${level === l ? "on" : ""}`} onClick={() => setLevel(l)}>
            {l[0].toUpperCase() + l.slice(1)} ({l === "all" ? data.length : data.filter((c) => c.level === l).length})
          </button>
        ))}
        <button className={`iconbtn ${hideSolved ? "on" : ""}`} onClick={() => setHideSolved((h) => !h)}>Hide solved ({data.filter((c) => c.solved).length})</button>
      </div>
      <input className="field" placeholder="Filter by title or topic…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 14 }} />
      <div className="list browse">
        {shown.map((c) => {
          const s = status(c);
          return (
            <Link key={c.id} to={`/java/c/${c.id}`}>
              <span className={`statusdot ${s.cls}`} title={s.label} />
              <span className="t">{c.title}<small>{c.topic} · {c.kind === "bug" ? "find the bug" : c.kind === "output" ? "predict output" : "stack trace"}</small></span>
              {c.solved && <span className="donemark" title="Solved"><Icon name="check" size={14} /></span>}
              <span className={`chip lv-${c.level}`}>{c.level.slice(0, 3)}</span>
            </Link>
          );
        })}
        {shown.length === 0 && <p className="muted">No challenges match.</p>}
      </div>
    </>
  );
}
