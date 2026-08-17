"use client";

import { FormEvent, MouseEvent, useMemo, useState } from "react";
import { Bot, Building2, DoorOpen, ImagePlus, Layers3, MousePointer2, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { adminApi, adminErrorMessage } from "@/lib/api";

type Point = { x: number; y: number };
type Phase = { id: string; name: string; nameAr?: string | null; code?: string | null; masterPlanPolygon?: Point[] | null };
type Building = { id: string; name: string; nameAr?: string | null; code?: string | null; phaseId?: string | null; masterPlanPolygon?: Point[] | null };
type Gate = { id: string; name: string; nameAr?: string | null; gateNumber?: number | null; phaseId?: string | null; masterPlanX?: number | string | null; masterPlanY?: number | string | null; isMain?: boolean };
type Media = { id: string; type: string; url: string; isCover?: boolean; sortOrder?: number };
type Suggestion = {
  building: { id: string; name: string; nameAr?: string | null; code?: string | null; phaseId?: string | null };
  candidates: Array<{ id: string; externalUnitId: string; confidence: number; reason: string; projectBuildingId?: string | null }>;
  highConfidenceCount: number;
};

const label = (item?: { name?: string | null; nameAr?: string | null; code?: string | null }) => item?.nameAr || item?.name || item?.code || "—";
const pointsAttr = (points: Point[] | null | undefined) => (points ?? []).map((point) => `${point.x * 1000},${point.y * 1000}`).join(" ");

export function ProjectSpatialEditor({
  projectId,
  phases,
  buildings,
  gates,
  media,
  onChanged,
}: {
  projectId: string;
  phases: Phase[];
  buildings: Building[];
  gates: Gate[];
  media: Media[];
  onChanged: () => Promise<void> | void;
}) {
  const plan = useMemo(() => media.filter((item) => item.type === "MASTER_PLAN").sort((a, b) => Number(b.isCover) - Number(a.isCover) || Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0))[0], [media]);
  const [mode, setMode] = useState<"PHASE" | "BUILDING" | "GATE" | null>(null);
  const [selectedPhaseId, setSelectedPhaseId] = useState(phases[0]?.id ?? "");
  const [selectedBuildingId, setSelectedBuildingId] = useState(buildings[0]?.id ?? "");
  const [selectedGateId, setSelectedGateId] = useState(gates[0]?.id ?? "");
  const [points, setPoints] = useState<Point[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [review, setReview] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function uploadMasterPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.append("projectId", projectId);
    form.append("type", "MASTER_PLAN");
    try {
      setBusy(true); setError("");
      await adminApi.upload("/catalog/media", form);
      event.currentTarget.reset();
      await onChanged();
    } catch (err) { setError(adminErrorMessage(err)); } finally { setBusy(false); }
  }

  function imageClick(event: MouseEvent<HTMLDivElement>) {
    if (!mode || !plan) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    if (mode === "GATE") {
      if (!selectedGateId) return setError("اختر البوابة أولًا.");
      void saveGatePoint(x, y);
      return;
    }
    setPoints((current) => [...current, { x, y }]);
  }

  async function saveGatePoint(x: number, y: number) {
    try {
      setBusy(true); setError("");
      await adminApi.patch(`/real-estate/gates/${selectedGateId}/location`, { masterPlanX: x, masterPlanY: y, source: "MASTER_PLAN_MANUAL", confirmed: true });
      await onChanged();
    } catch (err) { setError(adminErrorMessage(err)); } finally { setBusy(false); }
  }

  async function finishPolygon() {
    if (points.length < 3) return setError("الرسم يحتاج 3 نقاط على الأقل.");
    try {
      setBusy(true); setError("");
      if (mode === "PHASE") {
        if (!selectedPhaseId) throw new Error("اختر المرحلة أولًا.");
        await adminApi.patch(`/real-estate/phases/${selectedPhaseId}/master-plan-polygon`, { points });
      } else if (mode === "BUILDING") {
        if (!selectedBuildingId) throw new Error("اختر المبنى أولًا.");
        await adminApi.patch(`/real-estate/buildings/${selectedBuildingId}/master-plan-polygon`, { points, phaseId: selectedPhaseId || undefined });
      }
      setPoints([]);
      await onChanged();
    } catch (err) { setError(adminErrorMessage(err)); } finally { setBusy(false); }
  }

  async function createBuilding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      setBusy(true); setError("");
      const created = await adminApi.post<Building>(`/real-estate/projects/${projectId}/buildings`, {
        name: String(form.get("name") ?? "").trim(),
        code: String(form.get("code") ?? "").trim() || undefined,
        phaseId: selectedPhaseId || undefined,
      });
      setSelectedBuildingId(created.id);
      event.currentTarget.reset();
      await onChanged();
    } catch (err) { setError(adminErrorMessage(err)); } finally { setBusy(false); }
  }

  async function createGate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      setBusy(true); setError("");
      const created = await adminApi.post<Gate>(`/real-estate/projects/${projectId}/gates`, {
        name: String(form.get("name") ?? "").trim(),
        gateNumber: String(form.get("gateNumber") ?? "").trim() ? Number(form.get("gateNumber")) : undefined,
        phaseId: selectedPhaseId || undefined,
        isMain: Boolean(form.get("isMain")),
      });
      setSelectedGateId(created.id);
      event.currentTarget.reset();
      await onChanged();
    } catch (err) { setError(adminErrorMessage(err)); } finally { setBusy(false); }
  }

  async function loadSuggestions() {
    try {
      setBusy(true); setError("");
      const rows = await adminApi.get<Suggestion[]>(`/real-estate/projects/${projectId}/master-plan/suggestions`);
      setSuggestions(rows);
      const defaults: Record<string, string[]> = {};
      rows.forEach((row) => { defaults[row.building.id] = row.candidates.filter((candidate) => candidate.confidence >= 0.82).map((candidate) => candidate.id); });
      setReview(defaults);
    } catch (err) { setError(adminErrorMessage(err)); } finally { setBusy(false); }
  }

  async function confirmSuggestions() {
    const assignments = Object.entries(review).filter(([, ids]) => ids.length).map(([buildingId, unitIds]) => ({ buildingId, unitIds }));
    if (!assignments.length) return setError("راجع واختار اقتراح واحد على الأقل.");
    try {
      setBusy(true); setError("");
      await adminApi.patch(`/real-estate/projects/${projectId}/master-plan/review`, { assignments });
      await onChanged();
    } catch (err) { setError(adminErrorMessage(err)); } finally { setBusy(false); }
  }

  const currentPhase = phases.find((phase) => phase.id === selectedPhaseId);
  const phaseBuildings = buildings.filter((building) => !selectedPhaseId || building.phaseId === selectedPhaseId || !building.phaseId);
  const phaseGates = gates.filter((gate) => !selectedPhaseId || gate.phaseId === selectedPhaseId || !gate.phaseId);

  return (
    <section className="space-y-4" dir="rtl">
      <div className="rounded-[28px] border border-[#dfe4e0] bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-[11px] font-black uppercase tracking-[.2em] text-[#b08c52]">Spatial workflow</p><h2 className="mt-1 text-xl font-black">Master Plan Studio</h2><p className="mt-1 max-w-3xl text-sm leading-7 text-[#74817b]">ارفع المخطط، ارسم المراحل، ثم المباني. بعد كده Cg Ai يقترح الوحدات التابعة لكل مبنى من أسمائها وأنت تراجع. البوابات تفضل تحديد يدوي.</p></div>
          <div className="grid grid-cols-4 gap-2 text-center text-xs"><span className="rounded-xl bg-[#f3f4ef] px-3 py-2"><b className="block text-base">{phases.length}</b>مرحلة</span><span className="rounded-xl bg-[#f3f4ef] px-3 py-2"><b className="block text-base">{buildings.length}</b>مبنى</span><span className="rounded-xl bg-[#f3f4ef] px-3 py-2"><b className="block text-base">{gates.length}</b>بوابة</span><span className="rounded-xl bg-[#edf3f0] px-3 py-2 text-[#17483e]"><b className="block text-base">AI</b>Review</span></div>
        </div>

        {!plan ? (
          <form onSubmit={uploadMasterPlan} className="mt-5 grid min-h-72 place-items-center rounded-[24px] border-2 border-dashed border-[#cbd4cf] bg-[#fafaf7] p-6 text-center">
            <div><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#173f3b] text-white"><ImagePlus /></span><h3 className="mt-4 text-lg font-black">ارفع صورة الـ Master Plan أولًا</h3><p className="mt-1 text-sm text-[#74817b]">JPG / PNG / WEBP — المخطط هنا منفصل عن معرض صور المشروع.</p><input required name="file" type="file" accept="image/*" className="mx-auto mt-4 block max-w-full rounded-xl border bg-white p-2 text-sm" /><button disabled={busy} className="mt-3 h-11 rounded-xl bg-[#173f3b] px-6 font-black text-white disabled:opacity-40">رفع المخطط</button></div>
          </form>
        ) : (
          <div className="mt-5 grid gap-4 xl:grid-cols-[310px_minmax(0,1fr)]">
            <aside className="space-y-3">
              <div className="rounded-2xl border bg-[#faf9f5] p-3">
                <label className="text-xs font-black">المرحلة الحالية</label>
                <select value={selectedPhaseId} onChange={(event) => { setSelectedPhaseId(event.target.value); setPoints([]); }} className="mt-2 h-11 w-full rounded-xl border bg-white px-3"><option value="">بدون مرحلة</option>{phases.map((phase) => <option key={phase.id} value={phase.id}>{label(phase)}{phase.code ? ` · ${phase.code}` : ""}</option>)}</select>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <button type="button" onClick={() => { setMode("PHASE"); setPoints([]); }} disabled={!selectedPhaseId} className={`rounded-2xl border p-3 text-xs font-black disabled:opacity-30 ${mode === "PHASE" ? "bg-[#173f3b] text-white" : "bg-white"}`}><Layers3 className="mx-auto mb-1" size={17} />رسم مرحلة</button>
                <button type="button" onClick={() => { setMode("BUILDING"); setPoints([]); }} className={`rounded-2xl border p-3 text-xs font-black ${mode === "BUILDING" ? "bg-[#173f3b] text-white" : "bg-white"}`}><Building2 className="mx-auto mb-1" size={17} />رسم مبنى</button>
                <button type="button" onClick={() => { setMode("GATE"); setPoints([]); }} className={`rounded-2xl border p-3 text-xs font-black ${mode === "GATE" ? "bg-[#173f3b] text-white" : "bg-white"}`}><DoorOpen className="mx-auto mb-1" size={17} />حدد بوابة</button>
              </div>

              {mode === "BUILDING" ? <div className="rounded-2xl border p-3"><label className="text-xs font-black">المبنى المراد رسمه</label><select value={selectedBuildingId} onChange={(event) => setSelectedBuildingId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border bg-white px-3"><option value="">اختر مبنى</option>{phaseBuildings.map((building) => <option key={building.id} value={building.id}>{label(building)}</option>)}</select><form onSubmit={createBuilding} className="mt-3 grid gap-2"><div className="grid grid-cols-2 gap-2"><input required name="name" placeholder="مبنى جديد" className="h-10 rounded-xl border px-2" /><input name="code" placeholder="الكود" className="h-10 rounded-xl border px-2" /></div><button disabled={busy} className="h-9 rounded-xl border text-xs font-black">+ إنشاء مبنى</button></form></div> : null}

              {mode === "GATE" ? <div className="rounded-2xl border p-3"><label className="text-xs font-black">البوابة</label><select value={selectedGateId} onChange={(event) => setSelectedGateId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border bg-white px-3"><option value="">اختر بوابة</option>{phaseGates.map((gate) => <option key={gate.id} value={gate.id}>{label(gate)}{gate.isMain ? " · رئيسية" : ""}</option>)}</select><form onSubmit={createGate} className="mt-3 grid gap-2"><input required name="name" placeholder="اسم بوابة جديدة" className="h-10 rounded-xl border px-2" /><div className="grid grid-cols-2 gap-2"><input name="gateNumber" type="number" min="1" placeholder="رقم" className="h-10 rounded-xl border px-2" /><label className="flex items-center gap-2 rounded-xl border px-2 text-xs"><input name="isMain" type="checkbox" />رئيسية</label></div><button disabled={busy} className="h-9 rounded-xl border text-xs font-black">+ إنشاء بوابة</button></form></div> : null}

              {mode && mode !== "GATE" ? <div className="rounded-2xl border p-3"><div className="flex items-center justify-between"><b className="text-sm">الرسم الحالي</b><span className="text-xs text-[#74817b]">{points.length} نقطة</span></div><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={() => setPoints((current) => current.slice(0, -1))} disabled={!points.length} className="inline-flex h-9 items-center justify-center gap-1 rounded-xl border text-xs font-bold disabled:opacity-30"><RotateCcw size={13} />تراجع</button><button type="button" onClick={() => setPoints([])} disabled={!points.length} className="inline-flex h-9 items-center justify-center gap-1 rounded-xl border text-xs font-bold text-red-700 disabled:opacity-30"><Trash2 size={13} />مسح</button></div><button type="button" onClick={() => void finishPolygon()} disabled={busy || points.length < 3} className="mt-2 h-10 w-full rounded-xl bg-[#173f3b] text-sm font-black text-white disabled:opacity-30">تم — اعتماد الرسم</button></div> : null}

              <button type="button" onClick={() => { setMode(null); setPoints([]); }} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border text-sm font-bold"><MousePointer2 size={14} />وضع التصفح</button>
            </aside>

            <div className="overflow-auto rounded-[22px] border bg-[#e9ece8] p-2">
              <div onClick={imageClick} className={`relative mx-auto w-fit max-w-full overflow-hidden rounded-2xl bg-white ${mode ? "cursor-crosshair" : "cursor-default"}`}>
                <img src={plan.url} alt="Master Plan" draggable={false} className="block h-auto max-h-[78vh] max-w-full select-none" />
                <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1000 1000" preserveAspectRatio="none">
                  {phases.map((phase, index) => phase.masterPlanPolygon && phase.masterPlanPolygon.length >= 3 ? <g key={phase.id}><polygon points={pointsAttr(phase.masterPlanPolygon)} fill={`rgba(23,63,59,${selectedPhaseId === phase.id ? .20 : .10})`} stroke={selectedPhaseId === phase.id ? "#173f3b" : "#6f887f"} strokeWidth={selectedPhaseId === phase.id ? 5 : 3} vectorEffect="non-scaling-stroke" /><text x={phase.masterPlanPolygon[0].x * 1000 + 8} y={phase.masterPlanPolygon[0].y * 1000 + 20} fill="#173f3b" fontSize="24" fontWeight="800">{label(phase) || `Phase ${index + 1}`}</text></g> : null)}
                  {buildings.map((building) => building.masterPlanPolygon && building.masterPlanPolygon.length >= 3 ? <polygon key={building.id} points={pointsAttr(building.masterPlanPolygon)} fill="rgba(176,140,82,.24)" stroke="#9a773f" strokeWidth="3" vectorEffect="non-scaling-stroke" /> : null)}
                  {gates.filter((gate) => gate.masterPlanX != null && gate.masterPlanY != null).map((gate) => <g key={gate.id}><circle cx={Number(gate.masterPlanX) * 1000} cy={Number(gate.masterPlanY) * 1000} r="12" fill="#111b18" stroke="white" strokeWidth="3" vectorEffect="non-scaling-stroke" /><text x={Number(gate.masterPlanX) * 1000 + 18} y={Number(gate.masterPlanY) * 1000 + 6} fill="#111b18" fontSize="20" fontWeight="800">{label(gate)}</text></g>)}
                  {points.length ? <><polyline points={pointsAttr(points)} fill={points.length >= 3 ? "rgba(26,86,73,.14)" : "none"} stroke="#1f6a5a" strokeWidth="5" vectorEffect="non-scaling-stroke" />{points.map((point, index) => <circle key={index} cx={point.x * 1000} cy={point.y * 1000} r="9" fill="#fff" stroke="#1f6a5a" strokeWidth="4" vectorEffect="non-scaling-stroke" />)}</> : null}
                </svg>
              </div>
            </div>
          </div>
        )}
        {error ? <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      </div>

      {plan ? <div className="rounded-[28px] border border-[#dfe4e0] bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2 text-[#b08c52]"><Bot size={17} /><span className="text-[11px] font-black uppercase tracking-[.18em]">Cg Ai review</span></div><h3 className="mt-1 text-xl font-black">استنتاج الوحدة ← المبنى</h3><p className="mt-1 text-sm leading-7 text-[#74817b]">الاقتراح يعتمد على كود/اسم المبنى وكود الوحدة. لا يتم اعتماد أي ربط قبل مراجعتك.</p></div><button type="button" disabled={busy || !buildings.length} onClick={() => void loadSuggestions()} className="inline-flex h-11 items-center gap-2 rounded-2xl border border-[#173f3b] px-4 text-sm font-black text-[#173f3b] disabled:opacity-40"><Sparkles size={15} />تحليل المخزون</button></div>
        {suggestions.length ? <div className="mt-4 space-y-3">{suggestions.map((row) => <details key={row.building.id} className="rounded-2xl border bg-[#faf9f5] p-3" open={row.highConfidenceCount > 0}><summary className="cursor-pointer list-none"><div className="flex items-center justify-between gap-3"><div><b>{label(row.building)}</b><span className="me-2 text-xs text-[#74817b]">{row.candidates.length} اقتراح · {row.highConfidenceCount} ثقة عالية</span></div><span className="rounded-full bg-white px-2 py-1 text-xs font-bold">مختار {(review[row.building.id] ?? []).length}</span></div></summary><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{row.candidates.map((candidate) => { const active = (review[row.building.id] ?? []).includes(candidate.id); return <label key={candidate.id} className={`flex cursor-pointer items-center gap-2 rounded-xl border p-2 text-xs ${active ? "border-[#6da18f] bg-[#edf5f1]" : "bg-white"}`}><input type="checkbox" checked={active} onChange={() => setReview((current) => ({ ...current, [row.building.id]: active ? (current[row.building.id] ?? []).filter((id) => id !== candidate.id) : [...(current[row.building.id] ?? []), candidate.id] }))} /><b dir="ltr">{candidate.externalUnitId}</b><span className="me-auto">{Math.round(candidate.confidence * 100)}%</span></label>; })}</div></details>)}<button type="button" disabled={busy} onClick={() => void confirmSuggestions()} className="h-11 rounded-2xl bg-[#173f3b] px-6 font-black text-white disabled:opacity-40">اعتماد الاختيارات التي راجعتها</button></div> : null}
      </div> : null}
    </section>
  );
}
