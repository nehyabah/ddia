import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type Badge, type Profile } from "./api";
import { confetti, Icon } from "./components/ui";

type Toast = { id: number; text: string };

type Ctx = {
  profile: Profile | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setProfile: (p: Profile | null) => void;
  /** Show the floating "+N XP" pop and toasts for any new badges, then refresh the HUD. */
  reward: (xp: number, badges?: Badge[]) => void;
  toast: (text: string) => void;
};

const ProfileContext = createContext<Ctx | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [floats, setFloats] = useState<{ id: number; xp: number }[]>([]);
  const seq = useRef(0);
  const lastLevel = useRef<number | null>(null);
  const [levelUp, setLevelUp] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const p = await api.get<Profile>("/me");
      if (lastLevel.current != null && p.level > lastLevel.current) {
        setLevelUp(p.level);
        confetti(140);
      }
      lastLevel.current = p.level;
      setProfile(p);
    } catch {
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Active time: ping every 30 s while the tab is visible and the user interacted in the last minute.
  useEffect(() => {
    if (!profile) return;
    let last = Date.now();
    const mark = () => { last = Date.now(); };
    const evs = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    evs.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    const h = setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - last < 60_000) api.post("/activity/ping").catch(() => {});
    }, 30_000);
    return () => { clearInterval(h); evs.forEach((e) => window.removeEventListener(e, mark)); };
  }, [!!profile]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    refresh();
    const onUnauth = () => setProfile(null);
    window.addEventListener("ddia:unauthorized", onUnauth);
    return () => window.removeEventListener("ddia:unauthorized", onUnauth);
  }, [refresh]);

  const toast = useCallback((text: string) => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  const reward = useCallback((xp: number, badges: Badge[] = []) => {
    if (xp > 0) {
      const id = ++seq.current;
      setFloats((f) => [...f, { id, xp }]);
      setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 1200);
    }
    badges.forEach((b) => toast(`Badge earned: ${b.label}`));
    if (badges.length) confetti(60);
    refresh();
  }, [refresh, toast]);

  return (
    <ProfileContext.Provider value={{ profile, loading, refresh, setProfile, reward, toast }}>
      {children}
      {floats.map((f) => <div key={f.id} className="float">+{f.xp} XP</div>)}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className="toast"><Icon name="sparkle" size={16} />{t.text}</div>)}
      </div>
      {levelUp != null && (
        <div className="modal-bg" onClick={() => setLevelUp(null)} role="dialog" aria-modal="true" aria-label="Level up">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="trophy"><Icon name="trophy" /></div>
            <div className="small muted" style={{ fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" }}>Level up</div>
            <div className="big">{levelUp}</div>
            <p className="muted" style={{ margin: "8px 0 0" }}>Keep the streak going — every level takes a little more XP.</p>
            <button className="primary" style={{ width: "100%" }} autoFocus onClick={() => setLevelUp(null)}>Keep going</button>
          </div>
        </div>
      )}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  const c = useContext(ProfileContext);
  if (!c) throw new Error("useProfile outside provider");
  return c;
}

/** Tiny data-loading hook: { data, error, reload }. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await fn());
    } catch (e) {
      setError((e as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { load(); }, [load]);
  return { data, error, reload: load, setData };
}

export const shuffle = <T,>(a: T[]) => {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
