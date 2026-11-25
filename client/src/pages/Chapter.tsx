import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type ChapterDetail } from "../api";
import { useLoad } from "../state";

export function useChapter() {
  const { id } = useParams();
  return useLoad(() => api.get<ChapterDetail>(`/chapters/${id}`), [id]);
}

export function Chapter() {
  const nav = useNavigate();
  const { data: c, error } = useChapter();
  if (error) return <p className="err">{error}</p>;
  if (!c) return <div className="center">Loading…</div>;

  const seen = c.cards.filter((k) => k.seen).length;
  const bossOpen = c.mastery >= 50;
  const go = (p: string) => nav(`/chapter/${c.id}/${p}`);

  return (
    <>
      <Link className="back" to="/">← All chapters</Link>
      <h2>{c.tag ? "" : `${c.id}. `}{c.title}</h2>
      <p className="lede">{c.blurb}</p>
      <div className="mastery">
        <div className="ring" style={{ ["--p" as string]: c.mastery }}><span>{c.mastery}%</span></div>
        <div>
          <strong>Node health</strong><br />
          <span className="muted" style={{ fontSize: ".92rem" }}>
            {seen}/{c.cards.length} concept cards read · {c.quizCount} quiz questions · {c.due} due · {c.bossWon ? "boss defeated" : "boss unbeaten"}
          </span>
        </div>
      </div>
      <div className="modes">
        <button className="mode" onClick={() => go("learn")}><strong>📖 Learn</strong><small>Flip concept cards covering the whole chapter. Star the tricky ones and add notes.</small></button>
        <button className="mode" onClick={() => go("quiz")}><strong>⚡ Quiz run</strong><small>10 questions: due first, then new, then weakest. Combos multiply XP.</small></button>
        <button className="mode" onClick={() => go("match")}><strong>🧩 Term match</strong><small>Pair terms with meanings against the clock.</small></button>
        {c.drills.length > 0 && <button className="mode" onClick={() => go("drill")}><strong>🎤 Explain it</strong><small>Answer as you would in the interview, then check the key points.</small></button>}
        <button className="mode boss" disabled={!bossOpen} onClick={() => go("boss")}>
          <strong>👾 Boss fight</strong><small>{bossOpen ? `${c.bossCount} real‑world scenarios. 3 lives.` : "Unlocks at 50% node health."}</small>
        </button>
      </div>

      <h3 className="section-h">Glossary</h3>
      <div className="list">
        {c.terms.map((t) => (
          <div key={t.id} className="item"><h4>{t.term}</h4><span className="muted small">{t.meaning}</span></div>
        ))}
      </div>
    </>
  );
}
