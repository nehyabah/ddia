import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, type Badge, type JavaLesson } from "../api";
import { useLoad, useProfile } from "../state";
import { Md } from "../components/CodeView";
import { Icon } from "../components/ui";

const LEVELS = [["beginner", "Beginner"], ["intermediate", "Intermediate"], ["advanced", "Advanced"], ["expert", "Expert"]] as const;

export function JavaLessons() {
  const { reward } = useProfile();
  const { hash } = useLocation();
  const { data, error, setData } = useLoad(() => api.get<JavaLesson[]>("/java/lessons"), []);

  useEffect(() => {
    if (data && hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [data, hash]);

  async function open(l: JavaLesson) {
    if (l.read || !data) return;
    const r = await api.post<{ xp: number; newBadges: Badge[] }>(`/java/lessons/${l.id}/read`);
    setData(data.map((x) => (x.id === l.id ? { ...x, read: true } : x)));
    reward(r.xp, r.newBadges);
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <div className="center">Loading…</div>;

  return (
    <>
      <Link className="back" to="/java"><Icon name="back" size={16} />Java</Link>
      <h2>Debugging skills</h2>
      <p className="lede">The techniques behind the challenges: from reading your first stack trace to heap dumps, JFR and bytecode.</p>
      {data.length === 0 && <p className="muted">No lessons loaded yet.</p>}
      {LEVELS.map(([id, label]) => {
        const ls = data.filter((l) => l.level === id);
        if (!ls.length) return null;
        return (
          <section key={id} id={id}>
            <h3 className="section-h">{label} <span className="small muted">{ls.filter((l) => l.read).length}/{ls.length} read</span></h3>
            <div className="list">
              {ls.map((l) => (
                <details key={l.id} className="lesson" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && open(l)}>
                  <summary><span>{l.title}</span><span className={`statusdot ${l.read ? "learned" : ""}`} title={l.read ? "Read" : "Unread"} /></summary>
                  <div className="lb">
                    <ul>{l.body.map((b, i) => <li key={i}><Md text={b} /></li>)}</ul>
                    {l.example && <pre className="console">{l.example}</pre>}
                  </div>
                </details>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}
