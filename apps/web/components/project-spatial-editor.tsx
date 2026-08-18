"use client";

import { FormEvent, MouseEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { Building2, DoorOpen, ImagePlus, Layers3, LocateFixed, Minus, MousePointer2, Plus, RotateCcw, Search, Trash2, X, ZoomIn } from "lucide-react";
import { adminApi, adminErrorMessage } from "@/lib/api";

type Point = { x: number; y: number };
type Phase = { id: string; name: string; nameAr?: string | null; code?: string | null; masterPlanPolygon?: Point[] | null };
type Building = { id: string; name: string; nameAr?: string | null; code?: string | null; phaseId?: string | null; masterPlanPolygon?: Point[] | null };
type Gate = { id: string; name: string; nameAr?: string | null; gateNumber?: number | null; phaseId?: string | null; masterPlanX?: number | string | null; masterPlanY?: number | string | null; isMain?: boolean };
type Media = { id: string; type: string; url: string; isCover?: boolean; sortOrder?: number | null };
type UnitRef = {
  id: string;
  externalUnitId: string;
  phase?: string | null;
  phaseId?: string | null;
  building?: string | null;
  cluster?: string | null;
  floor?: string | null;
  unitType?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  builtUpArea?: number | string | null;
  projectBuildingId?: string | null;
  phaseRef?: { id: string; name: string; nameAr?: string | null; code?: string | null } | null;
  projectBuilding?: { id: string; name: string; nameAr?: string | null; code?: string | null } | null;
  source?: { fileName?: string | null; sheet?: string | null; row?: number | null } | null;
};

const label = (item?: { name?: string | null; nameAr?: string | null; code?: string | null }) => item?.nameAr || item?.name || item?.code || "—";
const pointsAttr = (points: Point[] | null | undefined) => (points ?? []).map((point) => `${point.x * 1000},${point.y * 1000}`).join(" ");
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function ProjectSpatialEditor({ projectId, phases, buildings, gates, media, onChanged }: { projectId: string; phases: Phase[]; buildings: Building[]; gates: Gate[]; media: Media[]; onChanged: () => Promise<void> | void }) {
  const plan = useMemo(() => media.filter((item) => item.type === "MASTER_PLAN").sort((a, b) => Number(b.isCover) - Number(a.isCover) || Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0))[0], [media]);
  const [mode, setMode] = useState<"PHASE" | "BUILDING" | "GATE" | null>(null);
  const [selectedPhaseId, setSelectedPhaseId] = useState(phases[0]?.id ?? "");
  const [selectedBuildingId, setSelectedBuildingId] = useState(buildings[0]?.id ?? "");
  const [selectedGateId, setSelectedGateId] = useState(gates[0]?.id ?? "");
  const [points, setPoints] = useState<Point[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);

  const [unitQuery, setUnitQuery] = useState("");
  const [unitResults, setUnitResults] = useState<UnitRef[]>([]);
  const [assignedUnits, setAssignedUnits] = useState<UnitRef[]>([]);
  const [unitBusy, setUnitBusy] = useState(false);

  const phaseBuildings = buildings.filter((building) => !selectedPhaseId || building.phaseId === selectedPhaseId || !building.phaseId);
  const phaseGates = gates.filter((gate) => !selectedPhaseId || gate.phaseId === selectedPhaseId || !gate.phaseId);
  const selectedBuilding = buildings.find((building) => building.id === selectedBuildingId);

  useEffect(() => {
    if (selectedBuildingId && !phaseBuildings.some((building) => building.id === selectedBuildingId)) setSelectedBuildingId(phaseBuildings[0]?.id ?? "");
  }, [selectedPhaseId, buildings.length]);

  async function loadAssigned(buildingId = selectedBuildingId) {
    if (!buildingId) return setAssignedUnits([]);
    try {
      setUnitBusy(true);
      const params = new URLSearchParams({ assignedBuildingId: buildingId });
      if (selectedPhaseId) params.set("phaseId", selectedPhaseId);
      setAssignedUnits(await adminApi.get<UnitRef[]>(`/real-estate/projects/${projectId}/master-plan/units?${params}`));
    } catch (err) { setError(adminErrorMessage(err)); } finally { setUnitBusy(false); }
  }

  useEffect(() => { void loadAssigned(); }, [selectedBuildingId, selectedPhaseId]);
  useEffect(() => {
    const query = unitQuery.trim();
    if (!query) { setUnitResults([]); return; }
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: query });
        if (selectedPhaseId) params.set("phaseId", selectedPhaseId);
        setUnitResults(await adminApi.get<UnitRef[]>(`/real-estate/projects/${projectId}/master-plan/units?${params}`));
      } catch (err) { setError(adminErrorMessage(err)); }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [unitQuery, selectedPhaseId, projectId]);

  async function assignUnit(unitId: string, action: "ASSIGN" | "REMOVE") {
    if (!selectedBuildingId) return setError("اختر المبنى أولًا.");
    try {
      setUnitBusy(true); setError("");
      await adminApi.patch(`/real-estate/projects/${projectId}/master-plan/assignment`, { buildingId: selectedBuildingId, unitId, action });
      await loadAssigned(selectedBuildingId);
      if (action === "ASSIGN") setUnitResults((current) => current.filter((item) => item.id !== unitId));
      await onChanged();
    } catch (err) { setError(adminErrorMessage(err)); } finally { setUnitBusy(false); }
  }

  async function uploadMasterPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    form.append("projectId", projectId); form.append("type", "MASTER_PLAN");
    try { setBusy(true); setError(""); await adminApi.upload("/catalog/media", form); formElement.reset(); await onChanged(); }
    catch (err) { setError(adminErrorMessage(err)); } finally { setBusy(false); }
  }

  function imageClick(event: MouseEvent<HTMLDivElement>) {
    if (!mode || !plan) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    if (mode === "GATE") { if (!selectedGateId) return setError("اختر البوابة أولًا."); void saveGatePoint(x, y); return; }
    setPoints((current) => [...current, { x, y }]);
  }

  async function saveGatePoint(x: number, y: number) {
    try { setBusy(true); setError(""); await adminApi.patch(`/real-estate/gates/${selectedGateId}/location`, { masterPlanX: x, masterPlanY: y, source: "MASTER_PLAN_MANUAL", confirmed: true }); await onChanged(); }
    catch (err) { setError(adminErrorMessage(err)); } finally { setBusy(false); }
  }

  async function finishPolygon() {
    if (points.length < 3) return setError("الرسم يحتاج 3 نقاط على الأقل.");
    try {
      setBusy(true); setError("");
      if (mode === "PHASE") { if (!selectedPhaseId) throw new Error("اختر المرحلة أولًا."); await adminApi.patch(`/real-estate/phases/${selectedPhaseId}/master-plan-polygon`, { points }); }
      else if (mode === "BUILDING") { if (!selectedBuildingId) throw new Error("اختر المبنى أولًا."); await adminApi.patch(`/real-estate/buildings/${selectedBuildingId}/master-plan-polygon`, { points, phaseId: selectedPhaseId || undefined }); }
      setPoints([]); await onChanged();
    } catch (err) { setError(adminErrorMessage(err)); } finally { setBusy(false); }
  }

  async function createBuilding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    try { setBusy(true); setError(""); const created = await adminApi.post<Building>(`/real-estate/projects/${projectId}/buildings`, { name: String(form.get("name") ?? "").trim(), code: String(form.get("code") ?? "").trim() || undefined, phaseId: selectedPhaseId || undefined }); setSelectedBuildingId(created.id); formElement.reset(); await onChanged(); }
    catch (err) { setError(adminErrorMessage(err)); } finally { setBusy(false); }
  }

  async function createGate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    try { setBusy(true); setError(""); const created = await adminApi.post<Gate>(`/real-estate/projects/${projectId}/gates`, { name: String(form.get("name") ?? "").trim(), gateNumber: String(form.get("gateNumber") ?? "").trim() ? Number(form.get("gateNumber")) : undefined, phaseId: selectedPhaseId || undefined, isMain: Boolean(form.get("isMain")) }); setSelectedGateId(created.id); formElement.reset(); await onChanged(); }
    catch (err) { setError(adminErrorMessage(err)); } finally { setBusy(false); }
  }

  function focusPoints(target: Point[] | null | undefined) {
    if (!target?.length || !scrollRef.current) return;
    const cx = target.reduce((sum, point) => sum + point.x, 0) / target.length;
    const cy = target.reduce((sum, point) => sum + point.y, 0) / target.length;
    setZoom((current) => Math.max(current, 4));
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const el = scrollRef.current; if (!el) return;
      el.scrollTo({ left: Math.max(0, cx * el.scrollWidth - el.clientWidth / 2), top: Math.max(0, cy * el.scrollHeight - el.clientHeight / 2), behavior: "smooth" });
    }));
  }

  function startPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (mode || !scrollRef.current) return;
    const el = scrollRef.current;
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function movePan(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const el = scrollRef.current;
    if (!drag || !el || drag.pointerId !== event.pointerId || mode) return;
    el.scrollLeft = drag.left - (event.clientX - drag.x);
    el.scrollTop = drag.top - (event.clientY - drag.y);
  }

  function endPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    try { event.currentTarget.releasePointerCapture?.(event.pointerId); } catch { /* pointer may already be released */ }
  }

  return (
    <section className="space-y-4" dir="rtl">
      <div className="rounded-[28px] border border-[#dfe4e0] bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-[11px] font-black uppercase tracking-[.2em] text-[#b08c52]">Spatial workflow</p><h2 className="mt-1 text-xl font-black">Master Plan Studio</h2><p className="mt-1 max-w-3xl text-sm leading-7 text-[#74817b]">ارسم المراحل والمباني والبوابات على المخطط. ربط الوحدة بالمبنى أصبح قرارًا يدويًا واضحًا من المخزون ومصدر الـSheet، بدون نسب ثقة عشوائية.</p></div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs"><span className="rounded-xl bg-[#f3f4ef] px-3 py-2"><b className="block text-base">{phases.length}</b>مرحلة</span><span className="rounded-xl bg-[#f3f4ef] px-3 py-2"><b className="block text-base">{buildings.length}</b>مبنى</span><span className="rounded-xl bg-[#f3f4ef] px-3 py-2"><b className="block text-base">{gates.length}</b>بوابة</span></div>
        </div>

        {!plan ? <form onSubmit={uploadMasterPlan} className="mt-5 grid min-h-72 place-items-center rounded-[24px] border-2 border-dashed border-[#cbd4cf] bg-[#fafaf7] p-6 text-center"><div><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#173f3b] text-white"><ImagePlus /></span><h3 className="mt-4 text-lg font-black">ارفع صورة الـ Master Plan أولًا</h3><p className="mt-1 text-sm text-[#74817b]">JPG / PNG / WEBP — المخطط منفصل عن معرض صور المشروع.</p><input required name="file" type="file" accept="image/*" className="mx-auto mt-4 block max-w-full rounded-xl border bg-white p-2 text-sm" /><button disabled={busy} className="mt-3 h-11 rounded-xl bg-[#173f3b] px-6 font-black text-white disabled:opacity-40">رفع المخطط</button></div></form> : (
          <div className="mt-5 grid gap-4 xl:grid-cols-[310px_minmax(0,1fr)]">
            <aside className="space-y-3">
              <div className="rounded-2xl border bg-[#faf9f5] p-3"><label className="text-xs font-black">المرحلة الحالية</label><select value={selectedPhaseId} onChange={(event) => { setSelectedPhaseId(event.target.value); setPoints([]); }} className="mt-2 h-11 w-full rounded-xl border bg-white px-3"><option value="">بدون مرحلة</option>{phases.map((phase) => <option key={phase.id} value={phase.id}>{label(phase)}{phase.code ? ` · ${phase.code}` : ""}</option>)}</select></div>
              <div className="grid grid-cols-3 gap-2"><button type="button" onClick={() => { setMode("PHASE"); setPoints([]); }} disabled={!selectedPhaseId} className={`rounded-2xl border p-3 text-xs font-black disabled:opacity-30 ${mode === "PHASE" ? "bg-[#173f3b] text-white" : "bg-white"}`}><Layers3 className="mx-auto mb-1" size={17} />رسم مرحلة</button><button type="button" onClick={() => { setMode("BUILDING"); setPoints([]); }} className={`rounded-2xl border p-3 text-xs font-black ${mode === "BUILDING" ? "bg-[#173f3b] text-white" : "bg-white"}`}><Building2 className="mx-auto mb-1" size={17} />رسم مبنى</button><button type="button" onClick={() => { setMode("GATE"); setPoints([]); }} className={`rounded-2xl border p-3 text-xs font-black ${mode === "GATE" ? "bg-[#173f3b] text-white" : "bg-white"}`}><DoorOpen className="mx-auto mb-1" size={17} />حدد بوابة</button></div>
              {mode === "BUILDING" ? <div className="rounded-2xl border p-3"><label className="text-xs font-black">المبنى المراد رسمه</label><select value={selectedBuildingId} onChange={(event) => setSelectedBuildingId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border bg-white px-3"><option value="">اختر مبنى</option>{phaseBuildings.map((building) => <option key={building.id} value={building.id}>{label(building)}</option>)}</select><form onSubmit={createBuilding} className="mt-3 grid gap-2"><div className="grid grid-cols-2 gap-2"><input required name="name" placeholder="مبنى جديد" className="h-10 rounded-xl border px-2" /><input name="code" placeholder="الكود" className="h-10 rounded-xl border px-2" /></div><button disabled={busy} className="h-9 rounded-xl border text-xs font-black">+ إنشاء مبنى</button></form></div> : null}
              {mode === "GATE" ? <div className="rounded-2xl border p-3"><label className="text-xs font-black">البوابة</label><select value={selectedGateId} onChange={(event) => setSelectedGateId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border bg-white px-3"><option value="">اختر بوابة</option>{phaseGates.map((gate) => <option key={gate.id} value={gate.id}>{label(gate)}{gate.isMain ? " · رئيسية" : ""}</option>)}</select><form onSubmit={createGate} className="mt-3 grid gap-2"><input required name="name" placeholder="اسم بوابة جديدة" className="h-10 rounded-xl border px-2" /><div className="grid grid-cols-2 gap-2"><input name="gateNumber" type="number" min="1" placeholder="رقم" className="h-10 rounded-xl border px-2" /><label className="flex items-center gap-2 rounded-xl border px-2 text-xs"><input name="isMain" type="checkbox" />رئيسية</label></div><button disabled={busy} className="h-9 rounded-xl border text-xs font-black">+ إنشاء بوابة</button></form></div> : null}
              {mode && mode !== "GATE" ? <div className="rounded-2xl border p-3"><div className="flex items-center justify-between"><b className="text-sm">الرسم الحالي</b><span className="text-xs text-[#74817b]">{points.length} نقطة</span></div><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={() => setPoints((current) => current.slice(0, -1))} disabled={!points.length} className="inline-flex h-9 items-center justify-center gap-1 rounded-xl border text-xs font-bold disabled:opacity-30"><RotateCcw size={13} />تراجع</button><button type="button" onClick={() => setPoints([])} disabled={!points.length} className="inline-flex h-9 items-center justify-center gap-1 rounded-xl border text-xs font-bold text-red-700 disabled:opacity-30"><Trash2 size={13} />مسح</button></div><button type="button" onClick={() => void finishPolygon()} disabled={busy || points.length < 3} className="mt-2 h-10 w-full rounded-xl bg-[#173f3b] text-sm font-black text-white disabled:opacity-30">تم — اعتماد الرسم</button></div> : null}
              <button type="button" onClick={() => { setMode(null); setPoints([]); }} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border text-sm font-bold"><MousePointer2 size={14} />وضع التصفح</button>
            </aside>

            <div className="min-w-0 rounded-[22px] border bg-[#e9ece8] p-2">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white p-2" dir="rtl"><div className="flex items-center gap-1"><button type="button" onClick={() => setZoom((value) => clamp(value - .25, 1, 8))} className="grid h-9 w-9 place-items-center rounded-lg border"><Minus size={14}/></button><span className="min-w-16 text-center text-xs font-black">{Math.round(zoom * 100)}%</span><button type="button" onClick={() => setZoom((value) => clamp(value + .25, 1, 8))} className="grid h-9 w-9 place-items-center rounded-lg border"><Plus size={14}/></button><button type="button" onClick={() => setZoom(1)} className="h-9 rounded-lg border px-3 text-xs font-bold">100%</button></div><button type="button" disabled={!selectedBuilding?.masterPlanPolygon?.length && !phases.find((phase) => phase.id === selectedPhaseId)?.masterPlanPolygon?.length} onClick={() => focusPoints(selectedBuilding?.masterPlanPolygon?.length ? selectedBuilding.masterPlanPolygon : phases.find((phase) => phase.id === selectedPhaseId)?.masterPlanPolygon)} className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-black disabled:opacity-30"><LocateFixed size={14}/>انتقل للمحدد</button></div>
              <div ref={scrollRef} dir="ltr" onPointerDown={startPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan} className={`max-h-[78vh] overflow-auto rounded-2xl bg-white ${mode ? "" : "cursor-grab active:cursor-grabbing"}`} style={{ touchAction: mode ? "auto" : "none" }}>
                <div onClick={imageClick} className={`relative origin-top-left ${mode ? "cursor-crosshair" : "cursor-grab"}`} style={{ width: `${zoom * 100}%`, minWidth: "100%" }}>
                  <img src={plan.url} alt="Master Plan" draggable={false} className="block h-auto w-full select-none" />
                  <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1000 1000" preserveAspectRatio="none">
                    {phases.map((phase, index) => phase.masterPlanPolygon && phase.masterPlanPolygon.length >= 3 ? <g key={phase.id}><polygon points={pointsAttr(phase.masterPlanPolygon)} fill={`rgba(23,63,59,${selectedPhaseId === phase.id ? .20 : .10})`} stroke={selectedPhaseId === phase.id ? "#173f3b" : "#6f887f"} strokeWidth={selectedPhaseId === phase.id ? 5 : 3} vectorEffect="non-scaling-stroke" /><text x={phase.masterPlanPolygon[0].x * 1000 + 8} y={phase.masterPlanPolygon[0].y * 1000 + 20} fill="#173f3b" fontSize="24" fontWeight="800">{label(phase) || `Phase ${index + 1}`}</text></g> : null)}
                    {buildings.map((building) => building.masterPlanPolygon && building.masterPlanPolygon.length >= 3 ? <polygon key={building.id} points={pointsAttr(building.masterPlanPolygon)} fill="rgba(176,140,82,.24)" stroke="#9a773f" strokeWidth="3" vectorEffect="non-scaling-stroke" /> : null)}
                    {gates.filter((gate) => gate.masterPlanX != null && gate.masterPlanY != null).map((gate) => <g key={gate.id}><circle cx={Number(gate.masterPlanX) * 1000} cy={Number(gate.masterPlanY) * 1000} r="12" fill="#111b18" stroke="white" strokeWidth="3" vectorEffect="non-scaling-stroke" /><text x={Number(gate.masterPlanX) * 1000 + 18} y={Number(gate.masterPlanY) * 1000 + 6} fill="#111b18" fontSize="20" fontWeight="800">{label(gate)}</text></g>)}
                    {points.length ? <><polyline points={pointsAttr(points)} fill={points.length >= 3 ? "rgba(26,86,73,.14)" : "none"} stroke="#1f6a5a" strokeWidth="5" vectorEffect="non-scaling-stroke" />{points.map((point, index) => <circle key={index} cx={point.x * 1000} cy={point.y * 1000} r="9" fill="#fff" stroke="#1f6a5a" strokeWidth="4" vectorEffect="non-scaling-stroke" />)}</> : null}
                  </svg>
                </div>
              </div>
            </div>
          </div>
        )}
        {error ? <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      </div>

      {plan ? <div className="rounded-[28px] border border-[#dfe4e0] bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2 text-[#b08c52]"><Search size={16}/><span className="text-[11px] font-black uppercase tracking-[.18em]">Inventory ↔ Master Plan</span></div><h3 className="mt-1 text-xl font-black">ربط الوحدات بالمبنى</h3><p className="mt-1 max-w-3xl text-sm leading-7 text-[#74817b]">اختر المبنى، ابحث بكود الوحدة، ثم أضفها. يظهر لك مرجعها من ملف/Sheet الاستيراد والبيانات الخام؛ لا توجد اقتراحات أو نسب ثقة تلقائية.</p></div><span className="rounded-full bg-[#edf3f0] px-3 py-2 text-xs font-black text-[#17483e]">{assignedUnits.length} وحدة مرتبطة</span></div>
        <div className="mt-4 grid gap-4 lg:grid-cols-[310px_minmax(0,1fr)]">
          <div className="space-y-3"><label className="block text-xs font-black">المبنى</label><select value={selectedBuildingId} onChange={(event) => setSelectedBuildingId(event.target.value)} className="h-11 w-full rounded-xl border bg-white px-3"><option value="">اختر مبنى</option>{phaseBuildings.map((building) => <option key={building.id} value={building.id}>{label(building)}</option>)}</select><div className="rounded-2xl bg-[#faf9f5] p-3 text-xs leading-6 text-[#74817b]"><b className="text-[#26342f]">مرجع البحث</b><br/>كود الوحدة + Building/Cluster الخام + اسم الملف + Sheet + رقم الصف. استخدم Zoom في الـMaster Plan لمراجعة المبنى بصريًا.</div></div>
          <div className="min-w-0 space-y-3">
            <div className="relative"><Search className="absolute right-3 top-1/2 -translate-y-1/2 text-[#7d8984]" size={16}/><input value={unitQuery} onChange={(event) => setUnitQuery(event.target.value)} disabled={!selectedBuildingId} placeholder={selectedBuildingId ? "اكتب كود الوحدة أو Building / Cluster…" : "اختر المبنى أولًا"} className="h-12 w-full rounded-2xl border bg-white pr-10 pl-3 disabled:bg-[#f4f4f1]" /></div>
            {unitResults.length ? <div className="max-h-72 overflow-auto rounded-2xl border bg-white p-2">{unitResults.map((unit) => <div key={unit.id} className="flex flex-wrap items-center gap-2 border-b p-2 last:border-0"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><b dir="ltr" className="text-sm">{unit.externalUnitId}</b><span className="text-[10px] text-[#74817b]">{unit.phaseRef ? label(unit.phaseRef) : unit.phase || "—"}</span>{unit.projectBuildingId ? <span className="rounded-full bg-[#f0eee7] px-2 py-1 text-[9px]">مرتبط: {label(unit.projectBuilding ?? undefined)}</span> : null}</div><p className="mt-1 truncate text-[10px] text-[#84908b]" dir="ltr">{unit.source?.fileName || "manual"}{unit.source?.sheet ? ` / ${unit.source.sheet}` : ""}{unit.source?.row ? ` / row ${unit.source.row}` : ""} · raw building: {unit.building || "—"}</p></div><button type="button" disabled={unitBusy || unit.projectBuildingId === selectedBuildingId} onClick={() => void assignUnit(unit.id, "ASSIGN")} className="h-9 rounded-xl bg-[#173f3b] px-3 text-xs font-black text-white disabled:opacity-30"><Plus size={13} className="inline"/> إضافة</button></div>)}</div> : unitQuery.trim() ? <div className="rounded-2xl border border-dashed p-5 text-center text-sm text-[#74817b]">لا توجد وحدة مطابقة للبحث.</div> : null}
            <div className="rounded-2xl border bg-[#faf9f5] p-3"><div className="flex items-center justify-between"><b className="text-sm">الوحدات المرتبطة بالمبنى</b>{unitBusy ? <span className="text-xs text-[#74817b]">جارٍ التحديث…</span> : null}</div>{assignedUnits.length ? <div className="mt-3 flex flex-wrap gap-2">{assignedUnits.map((unit) => <button key={unit.id} type="button" disabled={unitBusy} onClick={() => void assignUnit(unit.id, "REMOVE")} title={`${unit.source?.fileName ?? ""} ${unit.source?.sheet ?? ""}`} className="inline-flex items-center gap-2 rounded-full border border-[#bfd1c9] bg-white px-3 py-2 text-xs font-black text-[#17483e] disabled:opacity-40"><span dir="ltr">{unit.externalUnitId}</span><X size={13} className="text-red-600"/></button>)}</div> : <p className="mt-3 text-xs text-[#74817b]">لم تربط أي وحدة بهذا المبنى بعد.</p>}</div>
          </div>
        </div>
      </div> : null}
    </section>
  );
}
