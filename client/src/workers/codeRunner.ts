/// <reference lib="webworker" />
// Runs the learner's own JavaScript against test expressions, isolated in a worker.
// Test calls may return promises (integration exercises); each is awaited with a per-test timeout.
type Test = { name: string; call: string; expected: unknown };
type Out = { name: string; ok: boolean; got?: string; expected: string; error?: string; ms: number };

const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
const eq = (a: unknown, b: unknown) => canon(a) === canon(b);
const withTimeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`No result after ${ms / 1000}s (waiting on something that never resolves?)`)), ms))]);

self.onmessage = async (e: MessageEvent<{ code: string; tests: Test[] }>) => {
  const { code, tests } = e.data;
  const logs: string[] = [];
  const console = { log: (...a: unknown[]) => { if (logs.length < 80) logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); } };
  (console as Record<string, unknown>).error = console.log; (console as Record<string, unknown>).warn = console.log;
  const results: Out[] = [];
  for (const t of tests) {
    const t0 = performance.now();
    try {
      // eslint-disable-next-line no-new-func
      let got = new Function("console", `${code}\nreturn (${t.call});`)(console);
      if (got && typeof (got as Promise<unknown>).then === "function") got = await withTimeout(got as Promise<unknown>, 3000);
      results.push({ name: t.name, ok: eq(got, t.expected), got: JSON.stringify(got) ?? "undefined", expected: JSON.stringify(t.expected), ms: Math.round(performance.now() - t0) });
    } catch (err) {
      results.push({ name: t.name, ok: false, error: String((err as Error)?.message ?? err), expected: JSON.stringify(t.expected), ms: Math.round(performance.now() - t0) });
    }
  }
  (self as unknown as Worker).postMessage({ results, logs });
};
