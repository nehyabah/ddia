import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Badge, type Profile } from "../api";
import { useProfile } from "../state";
import { Md } from "../components/CodeView";
import { Icon } from "../components/ui";
import type { Plan } from "./Prep";

/* ---------- welcome: emoji + a line that fits the moment ---------- */
function moment(h: number) {
  if (h < 5) return { emoji: "🌙", hi: "Burning the midnight oil" };
  if (h < 12) return { emoji: "☀️", hi: "Good morning" };
  if (h < 18) return { emoji: "👋", hi: "Good afternoon" };
  return { emoji: "🌆", hi: "Good evening" };
}
function firstVisitToday(): boolean {
  const today = new Date().toDateString();
  try {
    const last = localStorage.getItem("ddia-last-visit");
    localStorage.setItem("ddia-last-visit", today);
    return last !== today;
  } catch { return false; }
}
let firstCache: boolean | null = null;

type Mood = { emoji: string; title: string; body: string };
/** The welcome adapts to how much you have done today. */
function mood(p: Profile, first: boolean, minutes: number, hour: number): Mood {
  const pct = p.dailyGoal ? p.xpToday / p.dailyGoal : 0;
  const left = Math.max(0, p.dailyGoal - p.xpToday);
  const streakLine = p.streak > 0 ? `Your ${p.streak}-day streak is on the line.` : "Start a streak today.";
  if (pct >= 1.5) return { emoji: "🏆", title: "Beast mode", body: `${p.xpToday} XP today, way past your goal. Rest counts too: stop while it still feels good.` };
  if (pct >= 1) return { emoji: "🎉", title: "Goal smashed", body: "Anything from here is a bonus. A few reviews keep tomorrow light." };
  if (pct >= 0.6) return { emoji: "💪", title: "On a roll", body: `Only ${left} XP to today’s goal. One more session closes it out.` };
  if (p.xpToday > 0) return { emoji: "🌱", title: "Good start", body: `${minutes ? `${minutes} min in. ` : ""}${left} XP to go. Momentum is easier to keep than to find.` };
  if (hour >= 21) return { emoji: "🌙", title: "Still time", body: `A 10-minute session counts. ${streakLine}` };
  if (first) return { emoji: hour < 12 ? "☀️" : "📚", title: "Ready to study?", body: `Warm up with one question, then pick up where you left off. ${p.streak > 0 ? streakLine : ""}`.trim() };
  return { emoji: "👋", title: "Welcome back", body: `Pick up where you left off. ${streakLine}` };
}

export function Welcome({ cta, onGo }: { cta: { label: string; to: string; sub: string }; onGo: (to: string) => void }) {
  const { profile } = useProfile();
  const [first] = useState(() => (firstCache ??= firstVisitToday()));
  const [minutes, setMinutes] = useState(0);
  useEffect(() => { api.get<{ today: { minutes: number } }>("/accountability").then((c) => setMinutes(c.today.minutes)).catch(() => {}); }, []);
  if (!profile) return null;
  const hour = new Date().getHours();
  const m = moment(hour);
  const md = mood(profile, first, minutes, hour);
  const pct = Math.min(100, Math.round((profile.xpToday / Math.max(1, profile.dailyGoal)) * 100));
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  return (
    <section className="welcome">
      <div className="w-top">
        <div>
          <div className="w-date">{today}</div>
          <div className="w-hi">{m.hi}, {profile.user.username}</div>
        </div>
        <Link to="/settings" className="w-avatar" aria-label="Your profile">{profile.user.username.slice(0, 1).toUpperCase()}</Link>
      </div>
      <div className="w-card panel">
        <h1><span className={`w-emoji ${first ? "wave" : ""}`} aria-hidden="true">{md.emoji}</span> {md.title}</h1>
        <p className="w-sub">{md.body}</p>
        <div className="w-stats">
          <span><b>{profile.xpToday}</b><small>/ {profile.dailyGoal} XP</small></span>
          <span><b>{minutes}</b><small>min today</small></span>
          <span><b>{profile.streak}</b><small>day streak</small></span>
        </div>
        <div className="w-line" aria-label={`${pct}% of today’s goal`}><i style={{ width: `${pct}%` }} /></div>
        <div className="w-cta">
          <button className="primary" onClick={() => onGo(cta.to)}>{cta.label}<Icon name="arrow" /></button>
          <span className="small muted">{cta.sub}</span>
        </div>
      </div>
    </section>
  );
}

/* ---------- warm-up: one tap, instant feedback, keep going ---------- */
type Q = { id: number; prompt: string; options: string[]; chapter: string; chapterTitle: string; answeredToday: number };
type A = { correct: boolean; answer: number; explanation: string; xp: number; newBadges: Badge[] };
const CHEERS = ["Nice! ✨", "Spot on 🎯", "Exactly right 💡", "Nailed it 🙌", "Yes! 🚀"];

export function WarmUp() {
  const { reward } = useProfile();
  const [q, setQ] = useState<Q | null | undefined>(undefined);
  const [pick, setPick] = useState<number | null>(null);
  const [res, setRes] = useState<A | null>(null);
  const [run, setRun] = useState(0);          // correct in a row this session
  const [done, setDone] = useState(0);        // answered this session
  const [seen, setSeen] = useState<number[]>([]);
  const [next, setNext] = useState<Plan["tasks"][number] | null>(null);

  const load = (skip: number[]) => api.get<Q | null>(`/warmup${skip.length ? `?skip=${skip.join(",")}` : ""}`).then((x) => { setQ(x); setPick(null); setRes(null); }).catch(() => setQ(null));
  useEffect(() => { load([]); }, []);

  async function answer(i: number) {
    if (!q || res) return;
    setPick(i);
    const r = await api.post<A>(`/warmup/${q.id}`, { choice: i });
    setRes(r); setDone((d) => d + 1); setSeen((s) => [...s, q.id]);
    setRun((x) => (r.correct ? x + 1 : 0));
    reward(r.xp, r.newBadges);
    if (done + 1 === 3) api.get<Plan>("/plan").then((p) => setNext(p.tasks.find((t) => !t.done) ?? null)).catch(() => {});
  }

  if (q === undefined || q === null) return null;
  return (
    <section className={`panel warmup ${res ? (res.correct ? "is-ok" : "is-bad") : ""}`}>
      <div className="wu-h">
        <span className="eyebrow">⚡ Warm-up · {q.chapter}</span>
        <span className="wu-count">{run >= 2 ? <b className="wu-run">🔥 {run} in a row</b> : done ? `${done} done` : q.answeredToday ? `${q.answeredToday} today` : "1 tap"}</span>
      </div>
      <p className="wu-q"><Md text={q.prompt} /></p>
      <div className="wu-opts">
        {q.options.map((o, i) => {
          const cls = res ? (i === res.answer ? "right" : i === pick ? "wrong" : "dim") : "";
          return <button key={i} className={`wu-opt ${cls}`} disabled={!!res} onClick={() => answer(i)}><Md text={o} /></button>;
        })}
      </div>
      {res && (
        <div className="wu-res">
          <b>{res.correct ? CHEERS[(done + run) % CHEERS.length] : "Not quite. It’ll come back for review. 🔁"}</b>
          <p className="small"><Md text={res.explanation} /></p>
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <button className="primary" style={{ marginTop: 4 }} onClick={() => load(seen)}>{done >= 5 ? "One more" : "Next question"}<Icon name="arrow" /></button>
            {next && <Link to={next.to} className="ghost" style={{ marginTop: 4 }}>Then: {next.label}</Link>}
          </div>
        </div>
      )}
    </section>
  );
}
