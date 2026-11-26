import { useEffect, useState } from "react";

/**
 * The one animation used wherever the AI is working: an orbiting "thinking" mark,
 * a status line that steps through what's happening, and a placeholder of the result.
 */
export function Thinking({ phases, compact }: { phases: string[]; compact?: boolean }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => Math.min(x + 1, phases.length - 1)), 1700);
    return () => clearInterval(t);
  }, [phases.length]);
  return (
    <div className={`thinking ${compact ? "compact" : ""}`} role="status" aria-live="polite">
      <div className="th-row">
        <span className="th-orb" aria-hidden="true"><i /><i /><i /><b /></span>
        <span className="th-text" key={i}>{phases[i]}</span>
      </div>
      {!compact && (
        <div className="th-ghost" aria-hidden="true">
          <span className="g-ring" />
          <span className="g-lines"><i style={{ width: "62%" }} /><i style={{ width: "88%" }} /><i style={{ width: "74%" }} /></span>
        </div>
      )}
    </div>
  );
}
