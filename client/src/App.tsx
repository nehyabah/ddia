import { useEffect, useState } from "react";
import { pendingDrafts } from "./api";
import { Link, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useProfile } from "./state";
import { Icon, SvgDefs, type IconName } from "./components/ui";
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
import { PuzzlePlay, PuzzlesHome } from "./pages/Puzzles";
import { ReportPage } from "./pages/ReportPage";
import { ReadinessPage } from "./pages/Readiness";
import { DesignList, DesignPlay } from "./pages/Design";
import { CodingList, CodingPlay } from "./pages/Coding";
import { MongoList, MongoPlay } from "./pages/Mongo";
import { BehavioralPage } from "./pages/Behavioral";
import { CompaniesPage, CompanyPage } from "./pages/Companies";
import { MockPage, PrepHome } from "./pages/Prep";
import { CommitmentPage } from "./pages/Commitment";
import { PracticalList, PracticalPlay } from "./pages/Practical";
import { HistoryPage } from "./pages/HistoryPage";

type NavItem = { to: string; label: string; icon: IconName; badge?: number; end?: boolean; desktopOnly?: boolean; mobileOnly?: boolean; match?: string[] };

/** One-tap light/dark switch, kept in sync with Settings and with the OS when on "system". */

function Shell() {
  const { profile } = useProfile();
  const { pathname } = useLocation();
  if (!profile) return null;
  const items: NavItem[] = [
    { to: "/", label: "Home", icon: "home", end: true, match: ["/chapter"] },
    { to: "/review", label: "Review", icon: "review", badge: profile.dueCount },
    { to: "/prep", label: "Prep", icon: "brief", match: ["/design", "/coding", "/mongo", "/behavioral", "/mock", "/companies", "/practical"] },
    { to: "/java", label: "Java", icon: "code", badge: profile.javaDue },
    { to: "/puzzles", label: "Puzzles", icon: "puzzle" },
    { to: "/stats", label: "Stats", icon: "chart", desktopOnly: true, match: ["/report", "/readiness"] },
    { to: "/notes", label: "Notes", icon: "notes", desktopOnly: true },
    { to: "/search", label: "Search", icon: "search", desktopOnly: true },
    { to: "/settings", label: "You", icon: "user", match: ["/notes", "/search", "/stats", "/report", "/readiness", "/history", "/commitment"] },
  ];
  // Treat nested routes (e.g. /chapter/3) as part of a tab on the bottom bar.
  const isActive = (i: NavItem, mobile: boolean) =>
    (i.end ? pathname === i.to : pathname.startsWith(i.to)) || (i.match ?? []).some((m) => pathname.startsWith(m) && (mobile || !items.some((x) => x.to === m)));

  return (
    <>
      <header className="topbar">
        <div className="in">
          <Link to="/" className="brand"><span className="logo"><img src="/logo-app.png" alt="" /></span><span className="word">DDIA</span></Link>
          <nav className="tabs" aria-label="Main">
            {items.filter((i) => !i.mobileOnly).map((i) => (
              <NavLink key={i.to} to={i.to} end={i.end} className={() => (isActive(i, false) ? "active" : "")} title={i.label}>
                <Icon name={i.icon} /><span className="lbl">{i.label}</span>
                {!!i.badge && <span className="pill">{i.badge}</span>}
              </NavLink>
            ))}
          </nav>
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

function OfflineBar() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [queued, setQueued] = useState(() => pendingDrafts());
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false), q = () => setQueued(pendingDrafts());
    window.addEventListener("online", on); window.addEventListener("offline", off); window.addEventListener("ddia:outbox", q);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); window.removeEventListener("ddia:outbox", q); };
  }, []);
  if (online && !queued) return null;
  return (
    <div className={`offlinebar ${online ? "syncing" : ""}`} role="status">
      {online ? `Back online · saving ${queued} draft${queued === 1 ? "" : "s"}…` : `Offline · you can read and write drafts${queued ? ` (${queued} waiting to save)` : ""}. Reviews need a connection.`}
    </div>
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
      <div className="ambient" aria-hidden="true"><i /><i /><i /></div>
      <Shell />
      <OfflineBar />
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
            <Route path="/puzzles" element={<PuzzlesHome />} />
          <Route path="/puzzles/play" element={<PuzzlePlay />} />
          <Route path="/puzzles/p/:id" element={<PuzzlePlay />} />
          <Route path="/report" element={<ReportPage />} />
          <Route path="/readiness" element={<ReadinessPage />} />
          <Route path="/prep" element={<PrepHome />} />
          <Route path="/commitment" element={<CommitmentPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/practical" element={<PracticalList />} />
          <Route path="/practical/:id" element={<PracticalPlay />} />
          <Route path="/design" element={<DesignList />} />
          <Route path="/design/:id" element={<DesignPlay />} />
          <Route path="/coding" element={<CodingList />} />
          <Route path="/coding/:id" element={<CodingPlay />} />
          <Route path="/mongo" element={<MongoList />} />
          <Route path="/mongo/:id" element={<MongoPlay />} />
          <Route path="/behavioral" element={<BehavioralPage />} />
          <Route path="/mock" element={<MockPage />} />
          <Route path="/companies" element={<CompaniesPage />} />
          <Route path="/companies/:id" element={<CompanyPage />} />
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
