import { Link, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useProfile } from "./state";
import { Icon, Ring, SvgDefs, type IconName } from "./components/ui";
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

type NavItem = { to: string; label: string; icon: IconName; badge?: number; end?: boolean; desktopOnly?: boolean; mobileOnly?: boolean; match?: string[] };

function Shell() {
  const { profile } = useProfile();
  const { pathname } = useLocation();
  if (!profile) return null;
  const items: NavItem[] = [
    { to: "/", label: "Home", icon: "home", end: true, match: ["/chapter"] },
    { to: "/review", label: "Review", icon: "review", badge: profile.dueCount },
    { to: "/java", label: "Java", icon: "code", badge: profile.javaDue },
    { to: "/stats", label: "Stats", icon: "chart" },
    { to: "/notes", label: "Notes", icon: "notes", desktopOnly: true },
    { to: "/search", label: "Search", icon: "search", desktopOnly: true },
    { to: "/settings", label: "You", icon: "user", match: ["/notes", "/search"] },
  ];
  // Treat nested routes (e.g. /chapter/3) as part of a tab on the bottom bar.
  const isActive = (i: NavItem, mobile: boolean) =>
    (i.end ? pathname === i.to : pathname.startsWith(i.to)) || (i.match ?? []).some((m) => pathname.startsWith(m) && (mobile || !items.some((x) => x.to === m)));
  const levelPct = (profile.into / profile.need) * 100;

  return (
    <>
      <header className="topbar">
        <div className="in">
          <Link to="/" className="brand"><span className="logo"><Icon name="logo" /></span><span className="word">DDIA</span></Link>
          <nav className="tabs" aria-label="Main">
            {items.filter((i) => !i.mobileOnly).map((i) => (
              <NavLink key={i.to} to={i.to} end={i.end} className={() => (isActive(i, false) ? "active" : "")} title={i.label}>
                <Icon name={i.icon} /><span className="lbl">{i.label}</span>
                {!!i.badge && <span className="pill">{i.badge}</span>}
              </NavLink>
            ))}
          </nav>
          <div className="hudchips">
            <span className={`stat flame ${profile.studiedToday ? "" : "cold"}`} title={`${profile.streak}-day streak (best ${profile.bestStreak})`}>
              <Icon name="flame" />{profile.streak}
            </span>
            <Link to="/stats" className="stat lv" title={`${profile.xp} XP · ${profile.need - profile.into} XP to level ${profile.level + 1}`}>
              <Ring value={levelPct} size={26} stroke={3.5}>{profile.level}</Ring>
              {profile.xp.toLocaleString()} XP
            </Link>
          </div>
        </div>
      </header>
      <nav className="bottomnav" aria-label="Main">
        {items.filter((i) => !i.desktopOnly).map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end} className={() => (isActive(i, true) ? "active" : "")}>
            <Icon name={i.icon} />{i.label}
            {!!i.badge && <span className="pill">{i.badge}</span>}
          </NavLink>
        ))}
      </nav>
    </>
  );
}

export function App() {
  const { profile, loading } = useProfile();
  const location = useLocation();
  if (loading) return <div className="wrap"><div className="center">Loading…</div></div>;
  if (!profile) return <div className="wrap"><SvgDefs /><AuthPage /></div>;
  return (
    <>
      <SvgDefs />
      <Shell />
      <div className="wrap">
        <main key={location.pathname} className="page">
          <Routes location={location}>
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
    </>
  );
}
