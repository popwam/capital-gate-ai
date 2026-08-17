"use client";

import { useEffect, useMemo, useState } from "react";
import { adminApi, adminErrorMessage } from "@/lib/api";

type MarketProfile = {
  id: string;
  segment: string;
  propertyUse: string;
  suitability?: string | null;
  demand?: string | null;
  yieldMin?: string | number | null;
  yieldMax?: string | number | null;
  liquidity?: string | null;
  notes?: string | null;
};

const segments = [
  ["INVESTMENT", "استثمار"],
  ["RESALE", "إعادة بيع"],
  ["RENTAL", "إيجار"],
] as const;
const uses = ["RESIDENTIAL", "COMMERCIAL", "OFFICE", "RETAIL", "HOSPITALITY", "MIXED"] as const;
const levels = ["LOW", "MEDIUM", "HIGH", "VERY_HIGH"] as const;

export function UnitMarketProfileEditor({ projectId, unitId, profiles = [], onChanged }: { projectId: string; unitId: string; profiles?: MarketProfile[]; onChanged?: () => void | Promise<void> }) {
  const [segment, setSegment] = useState("INVESTMENT");
  const [propertyUse, setPropertyUse] = useState("RESIDENTIAL");
  const [form, setForm] = useState({ suitability: "", demand: "", yieldMin: "", yieldMax: "", liquidity: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = useMemo(() => profiles.find((profile) => profile.segment === segment && profile.propertyUse === propertyUse), [profiles, segment, propertyUse]);

  useEffect(() => {
    setForm({
      suitability: current?.suitability || "",
      demand: current?.demand || "",
      yieldMin: current?.yieldMin == null ? "" : String(current.yieldMin),
      yieldMax: current?.yieldMax == null ? "" : String(current.yieldMax),
      liquidity: current?.liquidity || "",
      notes: current?.notes || "",
    });
  }, [current]);

  async function save() {
    setBusy(true); setError("");
    try {
      await adminApi.post(`/real-estate/projects/${projectId}/market-profiles`, {
        unitId,
        segment,
        propertyUse,
        suitability: form.suitability || undefined,
        demand: form.demand || undefined,
        yieldMin: form.yieldMin === "" ? undefined : Number(form.yieldMin),
        yieldMax: form.yieldMax === "" ? undefined : Number(form.yieldMax),
        liquidity: form.liquidity || undefined,
        notes: form.notes || undefined,
        source: "ADMIN_VERIFIED",
      });
      await onChanged?.();
    } catch (err) { setError(adminErrorMessage(err)); }
    finally { setBusy(false); }
  }

  return <section className="mt-5 border-t pt-4" dir="rtl">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h3 className="font-bold">استثناء السوق لهذه الوحدة</h3><p className="mt-1 text-xs leading-5 text-[#68756f]">اختياري. بدون استثناء ترث الوحدة تقييم المرحلة ثم المشروع. استخدمه فقط لو الوحدة فريدة فعلاً.</p></div>
      <span className="rounded-full bg-[#f1eee5] px-2.5 py-1 text-[10px] font-black text-[#806633]">Unit override</span>
    </div>
    <div className="mt-3 flex flex-wrap gap-2">{segments.map(([value,label]) => <button key={value} type="button" onClick={() => setSegment(value)} className={`rounded-full border px-3 py-2 text-xs font-bold ${segment===value?"border-forest bg-forest text-white":"bg-white"}`}>{label}</button>)}</div>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <label className="text-xs font-bold">نوع الاستخدام<select value={propertyUse} onChange={(event)=>setPropertyUse(event.target.value)} className="mt-1 h-10 w-full rounded-xl border bg-white px-2">{uses.map((value)=><option key={value}>{value}</option>)}</select></label>
      <label className="text-xs font-bold">الملائمة<select value={form.suitability} onChange={(event)=>setForm((x)=>({...x,suitability:event.target.value}))} className="mt-1 h-10 w-full rounded-xl border bg-white px-2"><option value="">يرث من المرحلة</option>{levels.map((value)=><option key={value}>{value}</option>)}</select></label>
      <label className="text-xs font-bold">الطلب<select value={form.demand} onChange={(event)=>setForm((x)=>({...x,demand:event.target.value}))} className="mt-1 h-10 w-full rounded-xl border bg-white px-2"><option value="">يرث من المرحلة</option>{levels.map((value)=><option key={value}>{value}</option>)}</select></label>
      <label className="text-xs font-bold">السيولة<select value={form.liquidity} onChange={(event)=>setForm((x)=>({...x,liquidity:event.target.value}))} className="mt-1 h-10 w-full rounded-xl border bg-white px-2"><option value="">يرث من المرحلة</option>{levels.map((value)=><option key={value}>{value}</option>)}</select></label>
      {segment === "RENTAL" && <><label className="text-xs font-bold">Yield من %<input type="number" step="0.1" value={form.yieldMin} onChange={(event)=>setForm((x)=>({...x,yieldMin:event.target.value}))} className="mt-1 h-10 w-full rounded-xl border px-2" /></label><label className="text-xs font-bold">Yield إلى %<input type="number" step="0.1" value={form.yieldMax} onChange={(event)=>setForm((x)=>({...x,yieldMax:event.target.value}))} className="mt-1 h-10 w-full rounded-xl border px-2" /></label></>}
      <label className="text-xs font-bold sm:col-span-2">ملاحظات موثقة<textarea rows={3} value={form.notes} onChange={(event)=>setForm((x)=>({...x,notes:event.target.value}))} className="mt-1 w-full rounded-xl border p-3" placeholder="لماذا تختلف هذه الوحدة عن المرحلة؟" /></label>
    </div>
    {error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs font-bold text-red-700">{error}</p>}
    <button type="button" disabled={busy} onClick={save} className="mt-3 rounded-xl border border-forest px-4 py-2 text-xs font-black text-forest disabled:opacity-40">{busy?"جارٍ التطبيق…":current?"تحديث الاستثناء":"إضافة استثناء"}</button>
  </section>;
}
