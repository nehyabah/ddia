import { useNavigate } from "react-router-dom";
import { api, type ChapterSummary } from "../api";
import { useLoad, useProfile } from "../state";

export function Home() {
  const nav = useNavigate();
  const { profile } = useProfile();
  const { data: chapters, error } = useLoad(() => api.get<ChapterSummary[]>("/chapters"), []);

  if (error) return <p className="err">{error}</p>;
  if (!chapters || !profile) return <div className="center">Loading…</div>;

  const book = chapters.filter((c) => !c.tag);
  const extra = chapters.filter((c) => c.tag);
  // Suggest the first chapter that isn't healthy yet.
  const next = chapters.find((c) => c.mastery < 80);

  const node = (c: ChapterSummary) => {
    const cls = c.mastery >= 80 ? "up" : c.mastery > 0 ? "warn" : "";
    const label = c.mastery === 0 ? (c.cardsSeen ? `${c.cardsSeen}/${c.cardCount} cards read` : "Not started")
      : c.mastery >= 80 ? `Healthy ${c.mastery}%` : `Syncing ${c.mastery}%`;
    return (
      <button key={c.id} className="node active" onClick={() => nav(`/chapter/${c.id}`)}>
        {c.due > 0 && <span className="due pill" title="Questions due for review">{c.due}</span>}
        <span className="num">{c.tag ?? c.id}</span>
        <span className="ttl">{c.title}</span>
        <span className="bar"><i style={{ width: `${c.mastery}%` }} /></span>
        <span className="health"><span className={`dot ${cls}`} />{label}{c.bossWon ? " · 👾" : ""}</span>
      </button>
    );
  };

  return (
    <>
      {profile.dueCount > 0 ? (
        <div className="banner">
          <div><strong>{profile.dueCount} {profile.dueCount === 1 ? "question" : "questions"} due</strong><br /><span className="small" style={{ opacity: .8 }}>Spaced repetition works best when you review on time.</span></div>
          <button className="primary" onClick={() => nav("/review")}>Start review</button>
        </div>
      ) : next ? (
        <div className="banner calm">
          <div><strong>Up next: {next.tag ?? `Chapter ${next.id}`}</strong><br /><span className="small muted">{next.title}</span></div>
          <button className="primary" style={{ margin: 0 }} onClick={() => nav(`/chapter/${next.id}${next.cardsSeen < next.cardCount ? "/learn" : "/quiz"}`)}>
            {next.cardsSeen < next.cardCount ? "Read cards" : "Quiz run"}
          </button>
        </div>
      ) : null}

      <h2>Your study cluster</h2>
      <p className="lede">All 12 chapters plus six MongoDB interview nodes. Bring each to full health by answering questions until they stick — anything you miss comes back sooner.</p>
      <div className="cluster">{book.map(node)}</div>
      {extra.length > 0 && (<><h3 className="section-h">MongoDB interview track</h3><div className="cluster">{extra.map(node)}</div></>)}

      <div className="badges">
        {profile.badges.map((b) => <span key={b.id} className={`badge ${b.earned ? "got" : ""}`}>{b.earned ? "🏅 " : ""}{b.label}</span>)}
      </div>
    </>
  );
}
