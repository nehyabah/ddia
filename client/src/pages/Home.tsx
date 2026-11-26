import { Link, useNavigate } from "react-router-dom";
import { api, type ChapterSummary, type JavaOverview } from "../api";
import { useLoad, useProfile } from "../state";
import { Icon, Ring, type IconName } from "../components/ui";

const BADGE_ICON: Record<string, IconName> = {
  first: "check", combo5: "flame", combo10: "flame", perfect: "star", matcher: "puzzle", reader: "book",
  boss: "skull", master: "trophy", streak7: "flame", goal: "bolt", reviewer: "review", explainer: "mic",
  bughunter: "bug", eagle: "search", javaexpert: "code",
};

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Burning the midnight oil" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function Home() {
  const nav = useNavigate();
  const { profile } = useProfile();
  const { data: chapters, error } = useLoad(() => api.get<ChapterSummary[]>("/chapters"), []);
  const { data: java } = useLoad(() => api.get<JavaOverview>("/java"), []);

  if (error) return <p className="err">{error}</p>;
  if (!chapters || !profile) return <div className="center">Loading…</div>;

  const book = chapters.filter((c) => !c.tag);
  const extra = chapters.filter((c) => c.tag);
  const next = chapters.find((c) => c.mastery < 80 && !c.locked);
  const goalPct = Math.min(100, Math.round((profile.xpToday / profile.dailyGoal) * 100));
  const ddiaPct = Math.round(chapters.reduce((a, c) => a + c.mastery, 0) / chapters.length);
  const javaTotal = java ? java.levels.reduce((a, l) => a + l.count, 0) : 0;
  const javaPct = java && javaTotal ? Math.round(java.levels.reduce((a, l) => a + l.mastery * l.count, 0) / javaTotal) : 0;

  // One obvious next step: reviews first, then the next unread/unhealthy chapter.
  const cta = profile.dueCount > 0
    ? { label: `Review ${profile.dueCount} due`, to: "/review", sub: "Spaced repetition works best when you review on time." }
    : profile.javaDue > 0
      ? { label: `Fix ${profile.javaDue} Java ${profile.javaDue === 1 ? "bug" : "bugs"}`, to: "/java/play?mode=review", sub: "Some bugs you missed are back for another look." }
      : next
        ? { label: next.cardsSeen < next.cardCount ? `Read ${next.tag ?? `Ch ${next.id}`}` : `Quiz ${next.tag ?? `Ch ${next.id}`}`,
            to: `/chapter/${next.id}${next.cardsSeen < next.cardCount ? "/learn" : "/quiz"}`, sub: `Up next: ${next.title}` }
        : { label: "Hunt Java bugs", to: "/java/play", sub: "Every chapter is healthy. Time to sharpen your debugging." };

  const goalLeft = Math.max(0, profile.dailyGoal - profile.xpToday);
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  const node = (c: ChapterSummary) => {
    const cls = c.mastery >= 80 ? "up" : c.mastery > 0 ? "warn" : "";
    const label = c.mastery === 0 ? (c.cardsSeen ? `${c.cardsSeen}/${c.cardCount} cards read` : "Not started")
      : c.mastery >= 80 ? "Healthy" : "In progress";
    return (
      <button key={c.id} className={`node ${c.mastery >= 80 ? "done" : ""} ${c.locked ? "locked" : ""}`} disabled={c.locked}
        title={c.locked ? `Reach ${c.unlockAt}% on ${c.unlockAfter} to unlock` : undefined} onClick={() => nav(`/chapter/${c.id}`)}>
        {c.due > 0 && <span className="due pill" title="Questions due for review">{c.due}</span>}
        <span className="nh">
          <span className="num">{c.tag ?? c.id}</span>
          {c.locked ? <span className="lockic"><Icon name="lock" size={16} /></span> : <Ring value={c.mastery} size={38} stroke={4}>{c.mastery}%</Ring>}
        </span>
        <span className="ttl">{c.title}</span>
        <span className="health">{c.locked ? <><Icon name="lock" size={12} />Reach {c.unlockAt}% on {c.unlockAfter}</> : <><span className={`dot ${cls}`} />{label}</>}</span>
        {(c.cardsSeen === c.cardCount || c.mastery >= 80 || c.bossWon) && (
          <span className="donechips">
            {c.cardsSeen === c.cardCount && <span><Icon name="check" size={11} />Read</span>}
            {c.mastery >= 80 && <span><Icon name="check" size={11} />Mastered</span>}
            {c.bossWon && <span><Icon name="check" size={11} />Boss</span>}
          </span>
        )}
      </button>
    );
  };

  return (
    <>
      <section className="hero">
        <div className="hero-main">
          <div className="eyebrow">{today}<span className="greet"> · {greeting()}, {profile.user.username}</span></div>
          <h2>{goalPct >= 100 ? "Daily goal reached." : profile.xpToday === 0 ? "Pick up where you left off." : `${goalLeft} XP to today’s goal.`}</h2>
          <p className="sub">{cta.sub}</p>
          <div className="cta">
            <button className="primary" onClick={() => nav(cta.to)}>{cta.label}<Icon name="arrow" /></button>
            <button className="ghost" onClick={() => nav("/java/play")}><Icon name="bug" />Debug Java</button>
          </div>
        </div>
        <div className="hero-goal" aria-label={`Today ${profile.xpToday} of ${profile.dailyGoal} XP`}>
          <Ring value={goalPct} size={104} stroke={7}>
            <span className="gv">{goalPct}<small>%</small></span>
          </Ring>
          <div className="gcap"><b>{profile.xpToday}</b> / {profile.dailyGoal} XP today</div>
        </div>
      </section>

      <div className="tiles">
        <div className="tile-stat"><span className="ic flame"><Icon name="flame" /></span><span><div className="v">{profile.streak}</div><div className="l">day streak</div></span></div>
        <Link to="/stats" className="tile-stat"><span className="ic bolt"><Icon name="bolt" /></span><span><div className="v">Lv {profile.level}</div><div className="l">{profile.need - profile.into} XP to next</div></span></Link>
        <Link to="/review" className="tile-stat"><span className="ic due"><Icon name="review" /></span><span><div className="v">{profile.dueCount}</div><div className="l">DDIA due</div></span></Link>
        <Link to="/java" className="tile-stat"><span className="ic code"><Icon name="code" /></span><span><div className="v">{profile.javaDue}</div><div className="l">Java due</div></span></Link>
      </div>

      <h3 className="section-h">Tracks</h3>
      <div className="tracks">
        <a className="trackcard" href="#chapters">
          <span className="ti ddia"><Icon name="layers" /></span>
          <span className="tx"><h4>Designing Data‑Intensive Apps</h4><p>{chapters.length} chapters · {ddiaPct}% mastered</p><span className="bar" style={{ display: "block" }}><i style={{ width: `${ddiaPct}%` }} /></span></span>
          <span className="go"><Icon name="arrow" /></span>
        </a>
        <Link className="trackcard" to="/puzzles">
          <span className="ti" style={{ background: "var(--teal)", color: "#fff" }}><Icon name="puzzle" /></span>
          <span className="tx"><h4>Systems puzzles</h4><p>Concurrency · rate limits &amp; retries · distributed</p></span>
          <span className="go"><Icon name="arrow" /></span>
        </Link>
        <Link className="trackcard" to="/java">
          <span className="ti java"><Icon name="bug" /></span>
          <span className="tx"><h4>Java debugging</h4><p>{javaTotal || "…"} challenges · {javaPct}% mastered</p><span className="bar" style={{ display: "block" }}><i style={{ width: `${javaPct}%`, background: "var(--grad-warm)" }} /></span></span>
          <span className="go"><Icon name="arrow" /></span>
        </Link>
      </div>

      <h3 className="section-h" id="chapters">The book <span className="small muted">{book.filter((c) => c.mastery >= 80).length}/{book.length} healthy</span></h3>
      <div className="cluster">{book.map(node)}</div>
      {extra.length > 0 && (<>
        <h3 className="section-h">MongoDB interview track <span className="small muted">{extra.filter((c) => c.mastery >= 80).length}/{extra.length} healthy</span></h3>
        <div className="cluster">{extra.map(node)}</div>
      </>)}

      <h3 className="section-h">Achievements <span className="small muted">{profile.badges.filter((b) => b.earned).length}/{profile.badges.length}</span></h3>
      <div className="badges">
        {profile.badges.map((b) => (
          <span key={b.id} className={`badge ${b.earned ? "got" : ""}`}>
            <span className="bi"><Icon name={BADGE_ICON[b.id] ?? "medal"} /></span>{b.label}
          </span>
        ))}
      </div>
    </>
  );
}
