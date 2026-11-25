import { Link, NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useProfile } from "./state";
import { AuthPage } from "./pages/AuthPage";
import { Home } from "./pages/Home";
import { Chapter } from "./pages/Chapter";
import { Learn } from "./pages/Learn";
import { RunPage } from "./pages/RunPage";
import { Match } from "./pages/Match";
import { DrillPage } from "./pages/DrillPage";
import { StatsPage } from "./pages/StatsPage";
import { NotesPage } from "./pages/NotesPage";
import { SearchPage } from "./pages/SearchPage";
import { Settings } from "./pages/Settings";
import { JavaHome } from "./pages/JavaHome";
import { JavaPlay } from "./pages/JavaPlay";
import { JavaLessons } from "./pages/JavaLessons";
import { JavaBrowse } from "./pages/JavaBrowse";

function Hud() {
  const { profile } = useProfile();
  if (!profile) return null;
  const goalPct = Math.min(100, Math.round((profile.xpToday / profile.dailyGoal) * 100));
  return (
    <>
      <header className="top">
        <h1 className="brand"><Link to="/">DDIA Quest</Link></h1>
        <span className="stat" title={`Daily streak (best ${profile.bestStreak})`}><span className={profile.studiedToday ? "" : "dim"}>🔥</span> {profile.streak}</span>
        <span className="stat" title="Level">Lv {profile.level}</span>
        <div className="xpbar"><i style={{ width: `${(profile.into / profile.need) * 100}%` }} /></div>
        <div className="lvl-row"><span>{profile.xp} XP</span><span>{profile.need - profile.into} XP to level {profile.level + 1}</span></div>
        <div className="goal">
          <span>Today {profile.xpToday}/{profile.dailyGoal} XP</span>
          <div className="xpbar"><i style={{ width: `${goalPct}%` }} /></div>
          {goalPct >= 100 && <span>✓ goal</span>}
        </div>
      </header>
      <nav className="tabs">
        <NavLink to="/" end>Map</NavLink>
        <NavLink to="/review">Review {profile.dueCount > 0 && <span className="pill">{profile.dueCount}</span>}</NavLink>
        <NavLink to="/java">Java {profile.javaDue > 0 && <span className="pill">{profile.javaDue}</span>}</NavLink>
        <NavLink to="/stats">Stats</NavLink>
        <NavLink to="/notes">Notes</NavLink>
        <NavLink to="/search">Search</NavLink>
        <NavLink to="/settings">Settings</NavLink>
      </nav>
    </>
  );
}

export function App() {
  const { profile, loading } = useProfile();
  if (loading) return <div className="wrap"><div className="center">Loading…</div></div>;
  if (!profile) return <div className="wrap"><AuthPage /></div>;
  return (
    <div className="wrap">
      <Hud />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/chapter/:id" element={<Chapter />} />
          <Route path="/chapter/:id/learn" element={<Learn />} />
          <Route path="/chapter/:id/quiz" element={<RunPage mode="quiz" />} />
          <Route path="/chapter/:id/boss" element={<RunPage mode="boss" />} />
          <Route path="/chapter/:id/match" element={<Match />} />
          <Route path="/chapter/:id/drill" element={<DrillPage />} />
          <Route path="/review" element={<RunPage mode="review" />} />
          <Route path="/java" element={<JavaHome />} />
          <Route path="/java/play" element={<JavaPlay />} />
          <Route path="/java/c/:id" element={<JavaPlay />} />
          <Route path="/java/lessons" element={<JavaLessons />} />
          <Route path="/java/all" element={<JavaBrowse />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
