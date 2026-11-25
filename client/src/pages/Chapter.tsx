import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type ChapterDetail } from "../api";
import { useLoad } from "../state";
import { Icon, Ring } from "../components/ui";

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
      <Link className="back" to="/"><Icon name="back" size={16} />All chapters</Link>
      <h2>{c.tag ? "" : `${c.id}. `}{c.title}</h2>
      <p className="lede">{c.blurb}</p>
      <div className="mastery">
        <Ring value={c.mastery} size={74} stroke={8}>{c.mastery}%</Ring>
        <div>
          <strong>Node health</strong><br />
          <span className="muted" style={{ fontSize: ".92rem" }}>
            {seen}/{c.cards.length} concept cards read · {c.quizCount} quiz questions · {c.due} due · {c.bossWon ? "boss defeated" : "boss unbeaten"}
          </span>
        </div>
      </div>
      <div className="modes">
        <button className="mode" onClick={() => go("learn")}><span className="mi"><Icon name="cards" /></span><strong>Learn{seen === c.cards.length && <span className="done-tag"><Icon name="check" size={12} />Done</span>}</strong><small>Flip concept cards covering the whole chapter. Star the tricky ones and add notes.</small></button>
        <button className="mode" onClick={() => go("quiz")}><span className="mi"><Icon name="bolt" /></span><strong>Quiz run{c.mastery >= 80 && <span className="done-tag"><Icon name="check" size={12} />Mastered</span>}</strong><small>10 questions: due first, then new, then weakest. Combos multiply XP.</small></button>
        <button className="mode" onClick={() => go("match")}><span className="mi"><Icon name="puzzle" /></span><strong>Term match</strong><small>Pair terms with meanings against the clock.</small></button>
        {c.drills.length > 0 && <button className="mode" onClick={() => go("drill")}><span className="mi"><Icon name="mic" /></span><strong>Explain it</strong><small>Answer as you would in the interview, then check the key points.</small></button>}
        <button className="mode boss" disabled={!bossOpen} onClick={() => go("boss")}>
          <span className="mi"><Icon name="skull" /></span><strong>Boss fight{c.bossWon && <span className="done-tag"><Icon name="check" size={12} />Beaten</span>}</strong><small>{bossOpen ? `${c.bossCount} real‑world scenarios. 3 lives.` : "Unlocks at 50% node health."}</small>
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
