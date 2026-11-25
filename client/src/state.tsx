import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type Badge, type Profile } from "./api";

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

  const refresh = useCallback(async () => {
    try {
      setProfile(await api.get<Profile>("/me"));
    } catch {
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

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
    badges.forEach((b) => toast(`🏅 Badge earned: ${b.label}`));
    refresh();
  }, [refresh, toast]);

  return (
    <ProfileContext.Provider value={{ profile, loading, refresh, setProfile, reward, toast }}>
      {children}
      {floats.map((f) => <div key={f.id} className="float">+{f.xp} XP</div>)}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className="toast">{t.text}</div>)}
      </div>
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
