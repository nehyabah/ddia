import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useLoad, useProfile } from "../state";
import { Icon, Ring } from "../components/ui";
import { tone, type Readiness } from "./Readiness";

type CompanySummary = { id: string; name: string; summary: string; counts: { design: number; coding: number; behavioral: number; mongo: number } };
type CompanyFull = {
  id: string; name: string; summary: string; loop: { round: string; what: string; tips: string[] }[]; values: { name: string; meaning: string }[]; valuesNote?: string;
  weights: Record<string, number>; focusTopics: string[];
  design: { id: string; title: string; level: string }[]; coding: { id: string; title: string; level: string; topic: string }[]; behavioral: { id: string; text: string; value: string | null }[];
};

let companiesCache: CompanySummary[] | null = null;
export function useCompanies() {
  const [list, setList] = useState(companiesCache);
  useEffect(() => { if (!companiesCache) api.get<CompanySummary[]>("/companies").then((c) => { companiesCache = c; setList(c); }).catch(() => {}); }, []);
  return list ?? [];
}

const MARK: Record<string, string> = { mongodb: "M", microsoft: "MS", stripe: "S" };
export function CompanyChip({ id }: { id: string | null }) {
  const list = useCompanies();
  if (!id) return null;
  return <Logo id={id} title={list.find((c) => c.id === id)?.name ?? id} />;
}

const LOGOS = new Set(["mongodb", "microsoft", "stripe"]);
export function Logo({ id, big, title }: { id: string; big?: boolean; title?: string }) {
  return (
    <span className={`cochip logo ${big ? "big" : ""} co-${id}`} title={title}>
      {LOGOS.has(id) ? <img src={`/art/logo-${id}.webp`} alt={title ?? id} /> : (MARK[id] ?? id[0].toUpperCase())}
    </span>
  );
}

/** Company filter kept in the URL (?company=) so links can deep-link a company view. */
export function useCompanyFilter(): [string, (v: string) => void] {
  const [sp, setSp] = useSearchParams();
  return [sp.get("company") ?? "", (v) => { const n = new URLSearchParams(sp); if (v) n.set("company", v); else n.delete("company"); setSp(n, { replace: true }); }];
}
export function CompanyFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const list = useCompanies();
  if (!list.length) return null;
  return (
    <div className="seg scrollseg">
      <button className={!value ? "on" : ""} onClick={() => onChange("")}>All</button>
      {list.map((c) => <button key={c.id} className={value === c.id ? "on" : ""} onClick={() => onChange(c.id)}>{c.name}</button>)}
      <button className={value === "general" ? "on" : ""} onClick={() => onChange("general")}>General</button>
    </div>
  );
}

export function CompaniesPage() {
  const list = useCompanies();
  const { toast } = useProfile();
  const { data: mine, setData } = useLoad(() => api.get<{ targets: string[] }>("/me/companies"), []);
  const { data: ready } = useLoad(() => api.get<Readiness & { perCompany: { id: string; overall: number; band: string }[] }>("/readiness"), [mine?.targets.join()]);
  async function toggle(id: string) {
    if (!mine) return;
    const targets = mine.targets.includes(id) ? mine.targets.filter((x) => x !== id) : [...mine.targets, id];
    setData(await api.put<{ targets: string[] }>("/me/companies", { targets }));
    toast(targets.includes(id) ? "Added to your targets" : "Removed from your targets");
  }
  return (
    <>
      <Link to="/prep" className="back"><Icon name="back" />Prep</Link>
      <h2>Companies</h2>
      <p className="lede">Pick the companies you’re interviewing with. Your readiness score and daily plan weight each area by what those companies emphasise.</p>
      <div className="list">
        {list.map((c) => {
          const on = !!mine?.targets.includes(c.id);
          const r = ready?.perCompany?.find((p) => p.id === c.id);
          return (
            <div key={c.id} className="panel cocard">
              <div className="cocard-h">
                <Logo id={c.id} big title={c.name} />
                <span className="lr-t"><b>{c.name}</b><small>{c.counts.design} designs · {c.counts.coding} coding · {c.counts.behavioral} behavioural{c.counts.mongo ? ` · ${c.counts.mongo} lab` : ""}</small></span>
                {r && <Ring value={r.overall} size={46} stroke={5} color={tone(r.overall)}>{r.overall}</Ring>}
              </div>
              <p className="small muted">{c.summary}</p>
              <div className="row" style={{ gap: 8 }}>
                <Link to={`/companies/${c.id}`} className="primary" style={{ marginTop: 0 }}>Open {c.name}</Link>
                <button className={`ghost ${on ? "on" : ""}`} style={{ marginTop: 0 }} onClick={() => toggle(c.id)}>{on ? <><Icon name="check" />Target</> : "Set as target"}</button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export function CompanyPage() {
  const { id } = useParams();
  const { data: c } = useLoad(() => api.get<CompanyFull>(`/companies/${id}`), [id]);
  const { data: r } = useLoad(() => api.get<Readiness>(`/readiness?company=${id}`), [id]);
  if (!c) return <div className="center">Loading…</div>;
  const top = r ? [...r.areas].sort((a, b) => b.weight - a.weight).slice(0, 6) : [];
  return (
    <>
      <Link to="/companies" className="back"><Icon name="back" />Companies</Link>
      <h2 className="coh2"><Logo id={c.id} big title={c.name} />{c.name}</h2>
      <p className="lede">{c.summary}</p>
      {r && (
        <section className="panel readyhero">
          <Ring value={r.overall} size={96} stroke={9} color={tone(r.overall)}><span className="rh-v" style={{ fontSize: "1.6rem" }}>{r.overall}</span></Ring>
          <div className="rh-t">
            <div className="eyebrow">{c.name} readiness</div>
            <h3>{r.band}</h3>
            <div className="wbars">
              {top.map((a) => (
                <div key={a.id} className="wbar"><span>{a.label}<small> ×{a.weight}</small></span><i><b style={{ width: `${a.score}%`, background: tone(a.score) }} /></i><em>{a.score}</em></div>
              ))}
            </div>
          </div>
        </section>
      )}

      <h3 className="section-h">The loop <span className="small muted">as commonly reported</span></h3>
      <div className="list">
        {c.loop.map((l, i) => (
          <details key={i} className="panel lesson">
            <summary><span><b>{i + 1}. {l.round}</b></span><Icon name="arrow" size={14} /></summary>
            <div className="lb"><p className="small">{l.what}</p><ul className="tidy small">{l.tips.map((t, j) => <li key={j}>{t}</li>)}</ul></div>
          </details>
        ))}
      </div>

      <h3 className="section-h">Master these</h3>
      <div className="themegrid">{c.focusTopics.map((t) => <span key={t} className="themechip">{t}</span>)}</div>

      <h3 className="section-h">Values</h3>
      <div className="list">{c.values.map((v) => <div key={v.name} className="panel" style={{ padding: "12px 16px" }}><b>{v.name}</b><div className="small muted">{v.meaning}</div></div>)}</div>
      {c.valuesNote && <p className="small muted">{c.valuesNote}</p>}

      {c.design.length > 0 && (<>
        <h3 className="section-h">System design <Link className="small" to={`/design?company=${c.id}`}>All</Link></h3>
        <div className="list">{c.design.map((d) => <Link key={d.id} to={`/design/${d.id}`} className="listrow"><span className="lr-t"><b>{d.title}</b><small>{d.level}</small></span><Icon name="arrow" /></Link>)}</div>
      </>)}
      {c.coding.length > 0 && (<>
        <h3 className="section-h">Coding <Link className="small" to={`/coding?company=${c.id}`}>All</Link></h3>
        <div className="list">{c.coding.map((d) => <Link key={d.id} to={`/coding/${d.id}`} className="listrow"><span className="lr-t"><b>{d.title}</b><small>{d.level} · {d.topic}</small></span><Icon name="arrow" /></Link>)}</div>
      </>)}
      {c.behavioral.length > 0 && (<>
        <h3 className="section-h">Behavioural <Link className="small" to={`/behavioral?company=${c.id}`}>All</Link></h3>
        <div className="list">{c.behavioral.slice(0, 5).map((q) => <Link key={q.id} to={`/behavioral?company=${c.id}`} className="listrow"><span className="lr-t"><b>{q.text}</b>{q.value && <small>{q.value}</small>}</span><Icon name="arrow" /></Link>)}</div>
      </>)}
      {c.id === "mongodb" && (<>
        <h3 className="section-h">Hands-on</h3>
        <div className="list">
          <Link to="/mongo" className="listrow"><span className="lr-t"><b>MongoDB lab</b><small>Queries, aggregation, indexes</small></span><Icon name="arrow" /></Link>
          <Link to="/#chapters" className="listrow"><span className="lr-t"><b>MongoDB interview track</b><small>Replication, sharding, storage, transactions</small></span><Icon name="arrow" /></Link>
        </div>
      </>)}
    </>
  );
}
