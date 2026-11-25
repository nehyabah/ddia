import { useState, type FormEvent } from "react";
import { api, type Profile } from "../api";
import { useProfile } from "../state";

const SNIPPET = `copy(localStorage.getItem("ddia-quest-v1"))`;

export function Settings() {
  const { profile, setProfile, refresh, toast } = useProfile();
  const [goal, setGoal] = useState(String(profile?.dailyGoal ?? 150));
  const [legacy, setLegacy] = useState("");
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? "system");

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

  function applyTheme(t: string) {
    setTheme(t);
    if (t === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    try { if (t === "system") localStorage.removeItem("ddia-theme"); else localStorage.setItem("ddia-theme", t); } catch { /* ignore */ }
  }

  async function reset() {
    if (!confirm("Erase all XP, streaks, notes and progress for this account? This can't be undone.")) return;
    setProfile(await api.post<Profile>("/me/reset"));
    toast("Progress reset");
  }

  async function logout() {
    await api.post("/auth/logout");
    await refresh();
  }

  return (
    <>
      <h2>Settings</h2>
      <p className="lede">Signed in as <b>{profile.user.username}</b>.</p>

      <form className="panel" onSubmit={saveGoal}>
        <h3>Daily goal</h3>
        <p className="small muted">XP to earn each day. A 10‑question quiz run is roughly 100–150 XP.</p>
        <div className="row" style={{ alignItems: "center" }}>
          <input className="field" type="number" min={10} max={5000} step={10} value={goal} onChange={(e) => setGoal(e.target.value)} style={{ maxWidth: 140 }} />
          <button className="primary" style={{ marginTop: 0 }}>Save</button>
        </div>
      </form>

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
