import { useRef, type KeyboardEvent } from "react";

/** Plain, fast code editor: monospace textarea with tab indentation and no autocorrect. */
export function Editor({ value, onChange, rows = 14, placeholder, readOnly }: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; readOnly?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const t = e.currentTarget, s = t.selectionStart, end = t.selectionEnd;
    const next = value.slice(0, s) + "  " + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => { if (ref.current) ref.current.selectionStart = ref.current.selectionEnd = s + 2; });
  }
  return (
    <textarea ref={ref} className="editor" value={value} rows={rows} placeholder={placeholder} readOnly={readOnly}
      onChange={(e) => onChange(e.target.value)} onKeyDown={onKey}
      spellCheck={false} autoCapitalize="off" autoCorrect="off" autoComplete="off" />
  );
}

/** Run a module worker once with a timeout; the worker posts back a single message. */
export function runWorker<T>(make: () => Worker, msg: unknown, timeoutMs = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const w = make();
    const t = setTimeout(() => { w.terminate(); reject(new Error(`Timed out after ${timeoutMs / 1000}s (infinite loop?)`)); }, timeoutMs);
    w.onmessage = (e) => { clearTimeout(t); w.terminate(); resolve(e.data as T); };
    w.onerror = (e) => { clearTimeout(t); w.terminate(); reject(new Error(e.message || "Worker error")); };
    w.postMessage(msg);
  });
}
