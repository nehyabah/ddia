import { useState, type FormEvent } from "react";
import { api } from "../api";
import { useProfile } from "../state";
import { Icon } from "../components/ui";

export function AuthPage() {
  const { refresh } = useProfile();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post(`/auth/${mode}`, { username, password });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <span className="logo"><Icon name="logo" /></span>
      <h2>DDIA</h2>
      <p className="lede">Study <em>Designing Data‑Intensive Applications</em> with flashcards, spaced‑repetition quizzes, term matching and interview drills. Your progress is saved to your account.</p>
      <form className="panel" onSubmit={submit}>
        <h3>{mode === "login" ? "Sign in" : "Create an account"}</h3>
        <label className="lbl" htmlFor="u">Username</label>
        <input id="u" className="field" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={mode === "register" ? 3 : 1} autoFocus />
        <label className="lbl" htmlFor="p">Password</label>
        <input id="p" className="field" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === "register" ? 8 : 1} />
        {mode === "register" && <p className="muted small">At least 8 characters.</p>}
        {error && <p className="err">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? "…" : mode === "login" ? "Sign in" : "Create account"}</button>
        <p className="small muted" style={{ marginTop: 16 }}>
          {mode === "login" ? "New here? " : "Already have an account? "}
          <button type="button" className="switch" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}>
            {mode === "login" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </form>
    </div>
  );
}
