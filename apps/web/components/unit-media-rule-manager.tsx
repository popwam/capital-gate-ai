"use client";

import { FormEvent, useEffect, useState } from "react";
import { ImagePlus, Layers3, Trash2 } from "lucide-react";
import { adminApi, adminErrorMessage } from "@/lib/api";

type Rule = {
  id: string;
  projectId: string;
  phaseId?: string | null;
  unitType?: string | null;
  unitSubType?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  minBuiltUpArea?: number | string | null;
  maxBuiltUpArea?: number | string | null;
  priority: number;
  label?: string | null;
  media: { id: string; url: string; type: string; altTextAr?: string | null };
};

const criteria = (rule: Rule) => [
  rule.unitType || null,
  rule.unitSubType || null,
  rule.bedrooms != null ? `${rule.bedrooms} نوم` : null,
  rule.bathrooms != null ? `${rule.bathrooms} حمام` : null,
  rule.minBuiltUpArea != null || rule.maxBuiltUpArea != null
    ? `${rule.minBuiltUpArea ?? 0}–${rule.maxBuiltUpArea ?? "∞"} م²`
    : null,
].filter(Boolean) as string[];

export function UnitMediaRuleManager({ projectId, phaseId, phaseName }: { projectId: string; phaseId: string; phaseName: string }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    if (!phaseId) return setRules([]);
    try {
      setError("");
      setRules(await adminApi.get<Rule[]>(`/catalog/media-rules?projectId=${encodeURIComponent(projectId)}&phaseId=${encodeURIComponent(phaseId)}`));
    } catch (err) { setError(adminErrorMessage(err)); }
  }
  useEffect(() => { void load(); }, [projectId, phaseId]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    form.append("projectId", projectId);
    form.append("phaseId", phaseId);
    try {
      setBusy(true); setError("");
      await adminApi.upload("/catalog/media-rules/upload", form);
      formElement.reset();
      await load();
    } catch (err) { setError(adminErrorMessage(err)); } finally { setBusy(false); }
  }

  async function remove(id: string) {
    try {
      setBusy(true); setError("");
      await adminApi.delete(`/catalog/media-rules/${id}`);
      setRules((current) => current.filter((rule) => rule.id !== id));
    } catch (err) { setError(adminErrorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <section className="rounded-[28px] border bg-white p-4 sm:p-5" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[#b08c52]"><Layers3 size={16}/><span className="text-[10px] font-black uppercase tracking-[.18em]">Unit media rules</span></div>
          <h3 className="mt-1 text-lg font-black">صور الوحدات حسب خصائص المرحلة</h3>
          <p className="mt-1 max-w-3xl text-sm leading-7 text-[#74817b]">اربط الصورة أو الـFloor Plan بنطاق واضح داخل <b>{phaseName}</b>. مثال: 3 نوم · 3 حمام · من 240 إلى 280م²؛ بالتالي 250 و270 يأخذان نفس الوسائط بينما 300 لا يطابق القاعدة. ولو رفعت وسيطًا مباشرة لوحدة بعينها فهو يتغلب على قاعدة المرحلة لنفس نوع الوسيط.</p>
        </div>
        <span className="rounded-full bg-[#edf3f0] px-3 py-2 text-xs font-black text-[#17483e]">{rules.length} قاعدة</span>
      </div>

      <form onSubmit={upload} className="mt-4 grid gap-2 rounded-2xl bg-[#faf9f5] p-3 sm:grid-cols-2 lg:grid-cols-4">
        <select name="type" defaultValue="FLOOR_PLAN" className="h-11 rounded-xl border bg-white px-3"><option value="FLOOR_PLAN">Floor Plan</option><option value="IMAGE">صور الوحدة</option></select>
        <input name="unitType" placeholder="نوع الوحدة — اختياري" className="h-11 rounded-xl border px-3" />
        <select name="bedrooms" defaultValue="" className="h-11 rounded-xl border bg-white px-3"><option value="">كل عدد غرف النوم</option>{Array.from({ length: 11 }, (_, i) => <option key={i} value={i}>{i} نوم</option>)}</select>
        <select name="bathrooms" defaultValue="" className="h-11 rounded-xl border bg-white px-3"><option value="">كل عدد الحمامات</option>{Array.from({ length: 11 }, (_, i) => <option key={i} value={i}>{i} حمام</option>)}</select>
        <input name="minBuiltUpArea" type="number" min="0" step="0.01" placeholder="أقل مساحة م²" className="h-11 rounded-xl border px-3" />
        <input name="maxBuiltUpArea" type="number" min="0" step="0.01" placeholder="أعلى مساحة م²" className="h-11 rounded-xl border px-3" />
        <input name="label" placeholder="اسم القاعدة — مثال 3BR 240-280" className="h-11 rounded-xl border px-3" />
        <input name="altTextAr" placeholder="وصف الصورة — اختياري" className="h-11 rounded-xl border px-3" />
        <input required name="file" type="file" accept="image/*" className="min-w-0 rounded-xl border bg-white p-2 text-sm sm:col-span-2 lg:col-span-3" />
        <button disabled={busy} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#173f3b] px-4 text-sm font-black text-white disabled:opacity-40"><ImagePlus size={15}/>إضافة قاعدة وصورة</button>
      </form>

      {rules.length ? <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{rules.map((rule) => <article key={rule.id} className="overflow-hidden rounded-2xl border bg-[#faf9f5]">
        <div className="aspect-[16/10] bg-[#eceeea]"><img src={rule.media.url} alt={rule.media.altTextAr || rule.label || "Unit media"} className="h-full w-full object-contain"/></div>
        <div className="p-3"><div className="flex items-start justify-between gap-2"><div><b className="text-sm">{rule.label || (rule.media.type === "FLOOR_PLAN" ? "Floor Plan" : "صور وحدة")}</b><p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-[#8a938e]">{rule.media.type}</p></div><button type="button" disabled={busy} onClick={() => void remove(rule.id)} className="grid h-8 w-8 place-items-center rounded-lg border bg-white text-red-700 disabled:opacity-40" aria-label="حذف القاعدة"><Trash2 size={14}/></button></div>
          <div className="mt-3 flex flex-wrap gap-1.5">{criteria(rule).length ? criteria(rule).map((item) => <span key={item} className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-[#52625c]">{item}</span>) : <span className="text-xs text-[#74817b]">كل وحدات المرحلة</span>}</div>
        </div>
      </article>)}</div> : <div className="mt-4 rounded-2xl border border-dashed p-6 text-center text-sm text-[#74817b]">لا توجد قواعد صور وحدات لهذه المرحلة بعد.</div>}
      {error ? <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
    </section>
  );
}
