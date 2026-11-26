import { useEffect, useState, type FormEvent } from "react";
import { applyTheme as setThemePref, getThemePref, type ThemePref } from "../theme";
import { api, type Profile } from "../api";
import { useProfile } from "../state";
import { Link } from "react-router-dom";
import { Icon } from "../components/ui";
import { canListen, canSpeak, setVoiceOn, voiceOn } from "../components/Voice";

const SNIPPET = `copy(localStorage.getItem("ddia-quest-v1"))`;

export function Settings() {
  const { profile, setProfile, refresh, toast } = useProfile();
  const [goal, setGoal] = useState(String(profile?.dailyGoal ?? 150));
  const [legacy, setLegacy] = useState("");
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [theme, setTheme] = useState<string>(() => getThemePref());

  if (!profile) return null;

  async function saveGoal(e: FormEvent) {
    e.preventDefault();
    try {
      setProfile(await api.put<Profile>("/me/settings", { dailyGoal: Number(goal) }));
      toast("Daily goal saved");
    } catch (err) { toast((err as Error).message); }
  }

  async function doImport(e: FormEvent) {
    e.preventDefault();
    setImportMsg(null);
    try {
      const r = await api.post<{ imported: Record<string, number>; profile: Profile }>("/me/import-legacy", { data: legacy.trim() });
      setProfile(r.profile);
      const i = r.imported;
      setImportMsg({ ok: true, text: `Imported ${i.questions} question boxes, ${i.cards} read cards, ${i.badges} badges, ${i.bossWins} boss wins and ${i.drills} drills.` });
      setLegacy("");
    } catch (err) { setImportMsg({ ok: false, text: (err as Error).message }); }
  }

  async function changePw(e: FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    try {
      await api.post("/me/password", pw);
      setPw({ current: "", next: "" });
      setPwMsg({ ok: true, text: "Password changed." });
    } catch (err) { setPwMsg({ ok: false, text: (err as Error).message }); }
  }

  useEffect(() => {
    const on = (e: Event) => setTheme((e as CustomEvent<string>).detail);
    window.addEventListener("ddia:theme", on);
    return () => window.removeEventListener("ddia:theme", on);
  }, []);

  function applyTheme(t: string) {
    setTheme(t);
    setThemePref(t as ThemePref);
  }

  async function reset() {
    if (!confirm("Erase all XP, streaks, notes and progress for this account? This can't be undone.")) return;
    setProfile(await api.post<Profile>("/me/reset"));
    toast("Progress reset");
  }

  async function logout() {
    await api.post("/auth/logout");
    navigator.serviceWorker?.controller?.postMessage("clear-api-cache");
    await refresh();
  }

  return (
    <>
      <h2>{profile.user.username}</h2>
      <p className="lede">Level {profile.level} · {profile.xp.toLocaleString()} XP · best streak {profile.bestStreak} {profile.bestStreak === 1 ? "day" : "days"}</p>
      <div className="morelinks">
        <Link to="/notes" className="trackcard"><span className="ti ddia" style={{ width: 40, height: 40 }}><Icon name="notes" /></span><span className="tx"><h4>Notes & stars</h4><p style={{ margin: 0 }}>Your revision sheet</p></span><span className="go"><Icon name="arrow" /></span></Link>
        <Link to="/search" className="trackcard"><span className="ti java" style={{ width: 40, height: 40 }}><Icon name="search" /></span><span className="tx"><h4>Search</h4><p style={{ margin: 0 }}>Cards, terms, questions</p></span><span className="go"><Icon name="arrow" /></span></Link>
        <Link to="/stats" className="trackcard"><span className="ti ddia" style={{ width: 40, height: 40 }}><Icon name="chart" /></span><span className="tx"><h4>Stats</h4><p style={{ margin: 0 }}>Progress, weekly report</p></span><span className="go"><Icon name="arrow" /></span></Link>
        <Link to="/history" className="trackcard"><span className="ti ddia" style={{ width: 40, height: 40 }}><Icon name="review" /></span><span className="tx"><h4>History</h4><p style={{ margin: 0 }}>Past answers and feedback</p></span><span className="go"><Icon name="arrow" /></span></Link>
        <Link to="/readiness" className="trackcard"><span className="ti ddia" style={{ width: 40, height: 40 }}><Icon name="trophy" /></span><span className="tx"><h4>Readiness</h4><p style={{ margin: 0 }}>By area and company</p></span><span className="go"><Icon name="arrow" /></span></Link>
      </div>

      <InterviewSettings />
      <EmailSettings />

      <form className="panel" onSubmit={saveGoal}>
        <h3>Daily goal</h3>
        <p className="small muted">XP to earn each day. A 10‑question quiz run is roughly 100–150 XP.</p>
        <div className="row" style={{ alignItems: "center" }}>
          <input className="field" type="number" min={10} max={5000} step={10} value={goal} onChange={(e) => setGoal(e.target.value)} style={{ maxWidth: 140 }} />
          <button className="primary" style={{ marginTop: 0 }}>Save</button>
        </div>
      </form>

      <VoiceSettings />

      <div className="panel">
        <h3>Theme</h3>
        <div className="row">
          {["system", "light", "dark"].map((t) => (
            <button key={t} className={`iconbtn ${theme === t ? "on" : ""}`} onClick={() => applyTheme(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
          ))}
        </div>
      </div>

      <form className="panel" onSubmit={doImport}>
        <h3>Import progress from the old single‑file app</h3>
        <ol className="small" style={{ paddingLeft: 20 }}>
          <li>Open the original <code>ddia-quest.html</code> in the same browser you used before.</li>
          <li>Open DevTools (<kbd>F12</kbd>) → Console, run <code>{SNIPPET}</code> — this copies your saved progress.</li>
          <li>Paste it below. Boxes, read cards, badges, boss wins, XP and streak are merged (whichever is higher wins).</li>
        </ol>
        <textarea className="field" rows={4} placeholder='{"xp":…,"boxes":{…},…}' value={legacy} onChange={(e) => setLegacy(e.target.value)} />
        <button className="primary" disabled={!legacy.trim()}>Import</button>
        {importMsg && <p className={importMsg.ok ? "okmsg" : "err"}>{importMsg.text}</p>}
      </form>

      <form className="panel" onSubmit={changePw}>
        <h3>Change password</h3>
        <label className="lbl" htmlFor="cur">Current password</label>
        <input id="cur" className="field" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required />
        <label className="lbl" htmlFor="nw">New password</label>
        <input id="nw" className="field" type="password" autoComplete="new-password" minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required />
        <button className="primary">Change password</button>
        {pwMsg && <p className={pwMsg.ok ? "okmsg" : "err"}>{pwMsg.text}</p>}
      </form>

      <div className="panel">
        <h3>Your data</h3>
        <div className="row">
          <a className="iconbtn" href="/api/me/export" style={{ textDecoration: "none" }}>Download backup (JSON)</a>
          <button className="iconbtn" onClick={logout}>Sign out</button>
          <button className="iconbtn danger" onClick={reset}>Reset all progress</button>
        </div>
      </div>
    </>
  );
}

function EmailSettings() {
  const { toast } = useProfile();
  const [email, setEmail] = useState("");
  const [weekly, setWeekly] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    api.get<{ email: string | null; weeklyEmail: boolean; configured: boolean }>("/me/email").then((r) => {
      setEmail(r.email ?? ""); setWeekly(r.weeklyEmail); setConfigured(r.configured); setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);
  async function save(e: FormEvent) {
    e.preventDefault();
    try { await api.put("/me/email", { email, weeklyEmail: weekly }); toast(email ? "Email saved" : "Email removed"); }
    catch (err) { toast((err as Error).message); }
  }
  if (!loaded) return null;
  return (
    <form className="panel" onSubmit={save}>
      <h3>Weekly email</h3>
      <p className="small muted">Every Sunday evening: time on the platform, what you did, what needs work and next steps. Preview it any time on <Link to="/report">the weekly report</Link>.</p>
      <label className="lbl" htmlFor="em">Your email</label>
      <input id="em" className="field" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
      <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
        <input type="checkbox" checked={weekly} onChange={(e) => setWeekly(e.target.checked)} /> Send me the weekly report
      </label>
      {!configured && <p className="small muted">Sending is not set up on the server yet (RESEND_API_KEY). Your address is saved for when it is.</p>}
      <button className="primary">Save</button>
    </form>
  );
}

export function InterviewSettings() {
  const { toast } = useProfile();
  const [date, setDate] = useState("");
  const [hour, setHour] = useState(19);
  const [push, setPush] = useState<{ supported: boolean; subscribed: boolean; busy?: boolean }>({ supported: false, subscribed: false });
  useEffect(() => {
    api.get<{ date: string | null; reminderHour: number }>("/me/interview").then((r) => { setDate(r.date ?? ""); setHour(r.reminderHour); }).catch(() => {});
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (supported) api.get<{ subscribed: boolean }>("/push/status").then((s) => setPush({ supported, subscribed: s.subscribed })).catch(() => setPush({ supported, subscribed: false }));
  }, []);
  async function save(e: FormEvent) {
    e.preventDefault();
    try { await api.put("/me/interview", { date: date || null, reminderHour: hour }); toast("Saved"); } catch (err) { toast((err as Error).message); }
  }
  async function enablePush() {
    setPush({ ...push, busy: true });
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error("Notifications are blocked. Allow them in your browser or phone settings.");
      const reg = await navigator.serviceWorker.ready;
      const { key } = await api.get<{ key: string }>("/push/key");
      const pad = "=".repeat((4 - (key.length % 4)) % 4);
      const raw = atob((key + pad).replace(/-/g, "+").replace(/_/g, "/"));
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, (c) => c.charCodeAt(0)) });
      await api.post("/push/subscribe", { subscription: sub.toJSON(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
      await api.post("/push/test");
      setPush({ supported: true, subscribed: true });
      toast("Reminders on. A test notification is on its way.");
    } catch (err) { toast((err as Error).message); setPush({ ...push, busy: false }); }
  }
  async function disablePush() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    await api.post("/push/unsubscribe", { endpoint: sub?.endpoint });
    await sub?.unsubscribe();
    setPush({ supported: true, subscribed: false });
  }
  return (
    <form className="panel" id="interview" onSubmit={save}>
      <h3>Interview & reminders</h3>
      <label className="lbl" htmlFor="idate">Interview date</label>
      <p className="small muted" style={{ margin: "0 0 4px" }}>Paces your daily plan: more mocks and design practice as the date gets closer.</p>
      <input id="idate" className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 220 }} />
      <label className="lbl" htmlFor="rhour">Daily reminder time</label>
      <select id="rhour" className="field" value={hour} onChange={(e) => setHour(Number(e.target.value))} style={{ maxWidth: 220 }}>
        {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
      </select>
      <div className="row" style={{ gap: 8, alignItems: "center" }}>
        <button className="primary">Save</button>
        {push.supported ? (push.subscribed
          ? <button type="button" className="ghost" onClick={disablePush}>Turn off reminders</button>
          : <button type="button" className="ghost" onClick={enablePush} disabled={push.busy}><Icon name="bolt" />Turn on reminders</button>)
          : <span className="small muted">On iPhone, add the app to your Home Screen to get reminders.</span>}
      </div>
      <p className="small muted">Reminders come once a day at that time: reviews due, a streak at risk, or what’s left on today’s plan. <Link to="/companies">Target companies →</Link></p>
    </form>
  );
}

function VoiceSettings() {
  const [on, setOn] = useState(() => voiceOn());
  return (
    <div className="panel">
      <h3>Voice</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        {canListen ? "Tap “Speak your answer” on any answer box to answer out loud; you’ll also get feedback on pace and filler words." : "Voice answers aren’t supported in this browser. On iPhone, use Safari; on Android or desktop, use Chrome."}
      </p>
      {canSpeak && (
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); setVoiceOn(e.target.checked); }} /> Read interviewer questions aloud
        </label>
      )}
    </div>
  );
}
