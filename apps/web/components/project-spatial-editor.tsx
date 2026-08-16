"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { adminApi, adminErrorMessage } from "@/lib/api";

type Unit = {
  id: string;
  externalUnitId: string;
  floor?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  internalLocationDescription?: string | null;
  projectZoneId?: string | null;
  projectBuildingId?: string | null;
  masterPlanX?: number | string | null;
  masterPlanY?: number | string | null;
  masterPlanLocationStatus?: "UNLOCATED" | "SUGGESTED" | "CONFIRMED" | string;
  masterPlanLocationSource?: string | null;
  masterPlanConfidence?: number | string | null;
};
type Gate = {
  id: string;
  name: string;
  nameAr?: string | null;
  gateNumber?: number | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  masterPlanX?: number | string | null;
  masterPlanY?: number | string | null;
  locationSource?: string | null;
  isMain?: boolean;
};
type Zone = { id: string; name: string; nameAr?: string | null; buildings?: Building[] };
type Building = { id: string; name: string; nameAr?: string | null; zoneId?: string | null };
type Media = { id: string; type: string; url: string; isCover?: boolean };
type BoundaryPoint = { lat: number; lng: number };
type ProjectSpatialData = {
  gates?: Gate[];
  zones?: Zone[];
  buildings?: Building[];
  boundaryGeoJson?: { type?: string; coordinates?: number[][][] } | null;
  boundarySource?: string | null;
  boundaryConfirmedAt?: string | null;
};

type UnitPage = { items: Unit[]; page: number; pageSize: number; total: number };

const n = (value: unknown) => value == null || value === "" ? null : Number(value);
const label = (value: { name?: string; nameAr?: string | null }) => value.nameAr || value.name || "—";

function geoJsonToPoints(value?: ProjectSpatialData["boundaryGeoJson"]): BoundaryPoint[] {
  const ring = value?.type === "Polygon" && Array.isArray(value.coordinates?.[0]) ? value.coordinates![0] : [];
  const points = ring.map(pair => ({ lng: Number(pair[0]), lat: Number(pair[1]) })).filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  if (points.length > 1 && points[0].lat === points.at(-1)?.lat && points[0].lng === points.at(-1)?.lng) points.pop();
  return points;
}

function BoundaryPreview({ points }: { points: BoundaryPoint[] }) {
  if (points.length < 2) return <div className="grid h-40 place-items-center rounded-xl bg-[#f5f4ef] text-xs text-[#77827d]">أضف 3 نقاط GPS على الأقل لرسم حدود المشروع.</div>;
  const lats = points.map(p => p.lat), lngs = points.map(p => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const width = Math.max(0.000001, maxLng - minLng), height = Math.max(0.000001, maxLat - minLat);
  const svgPoints = points.map(point => `${10 + ((point.lng - minLng) / width) * 280},${150 - ((point.lat - minLat) / height) * 130}`).join(" ");
  return <svg viewBox="0 0 300 160" className="h-40 w-full rounded-xl bg-[#f5f4ef]">
    <polygon points={svgPoints} fill="rgba(24,59,51,.13)" stroke="currentColor" strokeWidth="2" />
    {points.map((point, index) => <g key={`${point.lat}-${point.lng}-${index}`}><circle cx={10 + ((point.lng - minLng) / width) * 280} cy={150 - ((point.lat - minLat) / height) * 130} r="4" fill="currentColor"/><text x={14 + ((point.lng - minLng) / width) * 280} y={146 - ((point.lat - minLat) / height) * 130} fontSize="9">{index + 1}</text></g>)}
  </svg>;
}

export function ProjectSpatialEditor({ projectId, media = [] }: { projectId: string; media?: Media[] }) {
  const plan = useMemo(() => media.find(x => x.type === "MASTER_PLAN"), [media]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [gates, setGates] = useState<Gate[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [boundary, setBoundary] = useState<BoundaryPoint[]>([]);
  const [boundaryMeta, setBoundaryMeta] = useState<{ source?: string | null; confirmedAt?: string | null }>({});
  const [selectedId, setSelectedId] = useState("");
  const [mode, setMode] = useState<"UNIT" | "GATE">("UNIT");
  const [gateId, setGateId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);

  const selected = units.find(unit => unit.id === selectedId) ?? null;
  const selectedGate = gates.find(gate => gate.id === gateId) ?? null;

  const fetchAllUnits = async () => {
    const first = await adminApi.get<UnitPage>(`/catalog/units?projectId=${encodeURIComponent(projectId)}&page=1&pageSize=100`);
    const all = [...(first.items ?? [])];
    const pages = Math.ceil((first.total ?? all.length) / 100);
    for (let page = 2; page <= pages; page++) {
      const next = await adminApi.get<UnitPage>(`/catalog/units?projectId=${encodeURIComponent(projectId)}&page=${page}&pageSize=100`);
      all.push(...(next.items ?? []));
    }
    return all;
  };

  const load = async () => {
    if (!projectId) return;
    try {
      const [unitRows, project] = await Promise.all([
        fetchAllUnits(),
        adminApi.get<ProjectSpatialData>(`/real-estate/projects/${projectId}`),
      ]);
      setUnits(unitRows);
      setGates(project.gates ?? []);
      setZones(project.zones ?? []);
      setBuildings(project.buildings ?? []);
      setBoundary(geoJsonToPoints(project.boundaryGeoJson));
      setBoundaryMeta({ source: project.boundarySource, confirmedAt: project.boundaryConfirmedAt });
      if (!gateId && project.gates?.[0]) setGateId(project.gates[0].id);
    } catch (e) { setError(adminErrorMessage(e)); }
  };

  useEffect(() => { void load(); }, [projectId]);

  const normalizedPoint = (clientX: number, clientY: number) => {
    if (!imageRef.current) return null;
    const r = imageRef.current.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (clientY - r.top) / r.height)),
    };
  };

  const savePlanPoint = async (x: number, y: number) => {
    if (mode === "UNIT" && selected) {
      await adminApi.patch(`/real-estate/units/${selected.id}/master-plan-location`, { action: "SUGGEST", x, y, source: "ADMIN_MANUAL" });
    } else if (mode === "GATE" && gateId) {
      await adminApi.patch(`/real-estate/gates/${gateId}/location`, { masterPlanX: x, masterPlanY: y, source: "MASTER_PLAN_MANUAL", confirmed: true });
    }
  };

  const point = async (event: React.MouseEvent<HTMLImageElement>) => {
    const value = normalizedPoint(event.clientX, event.clientY);
    if (!value) return;
    try { setBusy(true); setError(""); await savePlanPoint(value.x, value.y); await load(); }
    catch (e) { setError(adminErrorMessage(e)); } finally { setBusy(false); }
  };

  const dragMarker = async (event: React.DragEvent<HTMLButtonElement>, unit: Unit) => {
    event.preventDefault();
    event.stopPropagation();
    const value = normalizedPoint(event.clientX, event.clientY);
    if (!value) return;
    try {
      setBusy(true); setSelectedId(unit.id); setMode("UNIT");
      await adminApi.patch(`/real-estate/units/${unit.id}/master-plan-location`, { action: "SUGGEST", x: value.x, y: value.y, source: "ADMIN_MANUAL" });
      await load();
    } catch (e) { setError(adminErrorMessage(e)); } finally { setBusy(false); }
  };

  const aiLocate = async () => {
    if (!selected) return;
    try { setBusy(true); setError(""); await adminApi.post(`/real-estate/projects/${projectId}/master-plan/locate-unit/${selected.id}`); await load(); }
    catch (e) { setError(adminErrorMessage(e)); } finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!selected || selected.masterPlanX == null || selected.masterPlanY == null) return;
    try {
      setBusy(true);
      await adminApi.patch(`/real-estate/units/${selected.id}/master-plan-location`, {
        action: "CONFIRM",
        x: Number(selected.masterPlanX), y: Number(selected.masterPlanY),
        source: selected.masterPlanLocationSource === "AI_VISION" ? "AI_VISION" : "ADMIN_MANUAL",
        confidence: selected.masterPlanConfidence == null ? undefined : Number(selected.masterPlanConfidence),
      });
      await load();
    } catch (e) { setError(adminErrorMessage(e)); } finally { setBusy(false); }
  };

  async function saveUnitInternalLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return;
    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = {
      projectZoneId: String(form.get("projectZoneId") || "") || undefined,
      projectBuildingId: String(form.get("projectBuildingId") || "") || undefined,
      floor: String(form.get("floor") || "") || undefined,
      internalLocationDescription: String(form.get("internalLocationDescription") || "") || undefined,
    };
    const lat = n(form.get("latitude")), lng = n(form.get("longitude"));
    if (lat != null) payload.latitude = lat;
    if (lng != null) payload.longitude = lng;
    try { setBusy(true); await adminApi.patch(`/real-estate/units/${selected.id}/internal-location`, payload); await load(); }
    catch (e) { setError(adminErrorMessage(e)); } finally { setBusy(false); }
  }

  async function createGate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const lat = n(form.get("latitude")), lng = n(form.get("longitude"));
    const data: Record<string, unknown> = {
      name: String(form.get("name") || "").trim(),
      nameAr: String(form.get("nameAr") || "").trim() || undefined,
      gateNumber: form.get("gateNumber") ? Number(form.get("gateNumber")) : undefined,
      isMain: form.get("isMain") === "on",
      latitude: lat ?? undefined,
      longitude: lng ?? undefined,
    };
    try {
      setBusy(true); const created = await adminApi.post<Gate>(`/real-estate/projects/${projectId}/gates`, data); setGateId(created.id); event.currentTarget.reset(); await load();
    } catch (e) { setError(adminErrorMessage(e)); } finally { setBusy(false); }
  }

  async function saveGateGps(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedGate) return;
    const form = new FormData(event.currentTarget), lat = n(form.get("latitude")), lng = n(form.get("longitude"));
    if (lat == null || lng == null) return setError("أدخل Latitude و Longitude للبوابة.");
    try { setBusy(true); await adminApi.patch(`/real-estate/gates/${selectedGate.id}/location`, { latitude: lat, longitude: lng, source: "GPS_MANUAL", confirmed: true }); await load(); }
    catch (e) { setError(adminErrorMessage(e)); } finally { setBusy(false); }
  }

  const useCurrentLocationForGate = () => {
    if (!navigator.geolocation) return setError("المتصفح لا يدعم تحديد الموقع.");
    navigator.geolocation.getCurrentPosition(async position => {
      if (!selectedGate) return;
      try {
        setBusy(true);
        await adminApi.patch(`/real-estate/gates/${selectedGate.id}/location`, { latitude: position.coords.latitude, longitude: position.coords.longitude, source: "GPS_MANUAL", confirmed: true });
        await load();
      } catch (e) { setError(adminErrorMessage(e)); } finally { setBusy(false); }
    }, () => setError("تعذر قراءة موقع الجهاز."), { enableHighAccuracy: true });
  };

  const addBoundaryPoint = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget), lat = n(form.get("lat")), lng = n(form.get("lng"));
    if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) return setError("إحداثيات GPS غير صالحة.");
    setBoundary(points => [...points, { lat, lng }]); event.currentTarget.reset();
  };

  const addCurrentBoundaryPoint = () => {
    if (!navigator.geolocation) return setError("المتصفح لا يدعم تحديد الموقع.");
    navigator.geolocation.getCurrentPosition(position => setBoundary(points => [...points, { lat: position.coords.latitude, lng: position.coords.longitude }]), () => setError("تعذر قراءة موقع الجهاز."), { enableHighAccuracy: true });
  };

  const saveBoundary = async () => {
    if (boundary.length < 3) return setError("حدود المشروع تحتاج 3 نقاط GPS على الأقل.");
    try { setBusy(true); await adminApi.patch(`/real-estate/projects/${projectId}/boundary`, { points: boundary, source: "GPS_MANUAL" }); await load(); }
    catch (e) { setError(adminErrorMessage(e)); } finally { setBusy(false); }
  };

  const clearBoundary = async () => {
    if (!window.confirm("مسح حدود المشروع المحفوظة؟")) return;
    try { setBusy(true); await adminApi.delete(`/real-estate/projects/${projectId}/boundary`); setBoundary([]); await load(); }
    catch (e) { setError(adminErrorMessage(e)); } finally { setBusy(false); }
  };

  const filteredBuildings = selected?.projectZoneId ? buildings.filter(building => building.zoneId === selected.projectZoneId) : buildings;

  return <section className="mt-6 space-y-5" dir="rtl">
    <div className="rounded-[22px] border bg-white p-5">
      <h2 className="text-lg font-bold">حدود المشروع بالـ GPS</h2>
      <p className="mt-1 text-sm text-[#68756f]">ارسم حدود الكمباوند كنقاط GPS مرتبة حول السور. النظام يخزنها Polygon موثق؛ ولا يفترض أن المشروع مجرد نقطة واحدة.</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_360px]">
        <BoundaryPreview points={boundary} />
        <div className="space-y-3">
          <form onSubmit={addBoundaryPoint} className="grid grid-cols-2 gap-2">
            <input required name="lat" type="number" step="any" placeholder="Latitude" className="h-11 rounded-xl border px-3"/>
            <input required name="lng" type="number" step="any" placeholder="Longitude" className="h-11 rounded-xl border px-3"/>
            <button className="h-10 rounded-xl border font-bold">إضافة نقطة</button>
            <button type="button" onClick={addCurrentBoundaryPoint} className="h-10 rounded-xl border font-bold">استخدم موقعي كنقطة</button>
          </form>
          <div className="max-h-36 space-y-1 overflow-auto text-xs">{boundary.map((point, index) => <div key={`${point.lat}-${point.lng}-${index}`} className="flex items-center justify-between rounded-lg bg-[#f5f4ef] px-2 py-1"><span dir="ltr">#{index + 1} {point.lat.toFixed(7)}, {point.lng.toFixed(7)}</span><button type="button" onClick={() => setBoundary(points => points.filter((_, i) => i !== index))}>حذف</button></div>)}</div>
          <div className="flex gap-2"><button disabled={busy || boundary.length < 3} type="button" onClick={saveBoundary} className="h-10 flex-1 rounded-xl bg-forest px-3 font-bold text-white">حفظ وتأكيد الحدود</button><button disabled={busy || !boundary.length} type="button" onClick={clearBoundary} className="h-10 rounded-xl border px-3">مسح</button></div>
          {boundaryMeta.confirmedAt && <p className="text-xs text-[#68756f]">محفوظة ومؤكدة · {boundaryMeta.source || "GPS"}</p>}
        </div>
      </div>
    </div>

    <div className="rounded-[22px] border bg-white p-5">
      <div className="mb-4"><h2 className="text-lg font-bold">بوابات المشروع</h2><p className="mt-1 text-sm text-[#68756f]">كل كمباوند يمكن أن يحتوي على أكثر من بوابة. حدد كل بوابة بالـ GPS، وعلى الـ Master Plan، أو بالاثنين.</p></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <select className="h-11 w-full rounded-xl border px-3" value={gateId} onChange={e => setGateId(e.target.value)}><option value="">اختر البوابة</option>{gates.map(gate => <option key={gate.id} value={gate.id}>{label(gate)}{gate.isMain ? " — رئيسية" : ""}</option>)}</select>
          {selectedGate && <form key={`${selectedGate.id}-${selectedGate.latitude}-${selectedGate.longitude}`} onSubmit={saveGateGps} className="grid grid-cols-2 gap-2">
            <input name="latitude" type="number" step="any" defaultValue={selectedGate.latitude == null ? "" : String(selectedGate.latitude)} placeholder="Latitude" className="h-11 rounded-xl border px-3"/>
            <input name="longitude" type="number" step="any" defaultValue={selectedGate.longitude == null ? "" : String(selectedGate.longitude)} placeholder="Longitude" className="h-11 rounded-xl border px-3"/>
            <button disabled={busy} className="h-10 rounded-xl border font-bold">حفظ GPS</button><button disabled={busy} type="button" onClick={useCurrentLocationForGate} className="h-10 rounded-xl border font-bold">استخدم موقعي</button>
            <p className="col-span-2 text-xs text-[#68756f]">المصدر: {selectedGate.locationSource || "غير محدد"}</p>
          </form>}
        </div>
        <form onSubmit={createGate} className="grid grid-cols-2 gap-2 rounded-xl bg-[#f8f8f5] p-3">
          <input required name="name" placeholder="اسم البوابة" className="h-11 rounded-xl border px-3"/><input name="nameAr" placeholder="الاسم العربي" className="h-11 rounded-xl border px-3"/>
          <input name="gateNumber" min="1" type="number" placeholder="رقم البوابة" className="h-11 rounded-xl border px-3"/><label className="flex items-center gap-2 rounded-xl border px-3 text-sm"><input name="isMain" type="checkbox"/> رئيسية</label>
          <input name="latitude" type="number" step="any" placeholder="Latitude اختياري" className="h-11 rounded-xl border px-3"/><input name="longitude" type="number" step="any" placeholder="Longitude اختياري" className="h-11 rounded-xl border px-3"/>
          <button disabled={busy} className="col-span-2 h-10 rounded-xl bg-forest font-bold text-white">إضافة بوابة</button>
        </form>
      </div>
    </div>

    <div className="rounded-[22px] border bg-white p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2"><h2 className="me-auto text-lg font-bold">الوحدات والبوابات على الـ Master Plan</h2><button type="button" className={`rounded-lg border px-3 py-2 ${mode === "UNIT" ? "bg-forest text-white" : ""}`} onClick={() => setMode("UNIT")}>الوحدات</button><button type="button" className={`rounded-lg border px-3 py-2 ${mode === "GATE" ? "bg-forest text-white" : ""}`} onClick={() => setMode("GATE")}>البوابات</button></div>
      {!plan ? <p className="rounded-xl bg-[#f5f4ef] p-4 text-sm">ارفع صورة من نوع <b>Master Plan</b> للمشروع أولاً. صور المشروع العامة وصور الوحدات تظل أنواع وسائط مستقلة.</p> : <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-3">
          {mode === "UNIT" ? <>
            <select className="w-full rounded-lg border p-2" value={selectedId} onChange={e => setSelectedId(e.target.value)}><option value="">اختر الوحدة</option>{units.map(unit => <option key={unit.id} value={unit.id}>{unit.externalUnitId} — {unit.masterPlanLocationStatus ?? "UNLOCATED"}</option>)}</select>
            <button disabled={!selected || busy} type="button" className="w-full rounded-lg border p-2" onClick={aiLocate}>اقترح المكان من الـ Master Plan</button>
            <button disabled={!selected || busy || selected.masterPlanX == null} type="button" className="w-full rounded-lg bg-forest p-2 font-bold text-white disabled:opacity-40" onClick={confirm}>تأكيد مكان الوحدة</button>
            <p className="text-xs text-[#68756f]">اسحب Marker الوحدة على المخطط أو اضغط على المكان الجديد، ثم راجع واضغط تأكيد.</p>
            {selected && <form key={selected.id} onSubmit={saveUnitInternalLocation} className="grid gap-2 border-t pt-3">
              <h3 className="font-bold">تفاصيل الموقع الداخلي</h3>
              <select name="projectZoneId" defaultValue={selected.projectZoneId || ""} className="h-10 rounded-xl border px-2"><option value="">بدون Zone</option>{zones.map(zone => <option key={zone.id} value={zone.id}>{label(zone)}</option>)}</select>
              <select name="projectBuildingId" defaultValue={selected.projectBuildingId || ""} className="h-10 rounded-xl border px-2"><option value="">بدون مبنى</option>{filteredBuildings.map(building => <option key={building.id} value={building.id}>{label(building)}</option>)}</select>
              <input name="floor" defaultValue={selected.floor || ""} placeholder="الدور — مثال 3" className="h-10 rounded-xl border px-2"/>
              <div className="grid grid-cols-2 gap-2"><input name="latitude" type="number" step="any" defaultValue={selected.latitude == null ? "" : String(selected.latitude)} placeholder="Latitude" className="h-10 rounded-xl border px-2"/><input name="longitude" type="number" step="any" defaultValue={selected.longitude == null ? "" : String(selected.longitude)} placeholder="Longitude" className="h-10 rounded-xl border px-2"/></div>
              <textarea name="internalLocationDescription" defaultValue={selected.internalLocationDescription || ""} placeholder="مثال: قريب من البوابة 2 / منتصف المشروع / أمام النادي" className="min-h-16 rounded-xl border p-2"/>
              <button disabled={busy} className="h-10 rounded-xl border font-bold">حفظ التفاصيل الداخلية</button>
            </form>}
          </> : <><select className="w-full rounded-lg border p-2" value={gateId} onChange={e => setGateId(e.target.value)}><option value="">اختر البوابة</option>{gates.map(gate => <option key={gate.id} value={gate.id}>{label(gate)}</option>)}</select><p className="text-xs text-[#68756f]">اضغط على الـ Master Plan لتثبيت موضع البوابة المختارة. GPS الخاص بها يبقى محفوظاً بشكل مستقل.</p></>}
          {error && <p className="rounded-xl bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        </aside>
        <div className="relative overflow-auto rounded-xl border bg-white">
          <div className="relative inline-block min-w-full">
            <img ref={imageRef} src={plan.url} alt="Master plan" className="block h-auto w-full cursor-crosshair select-none" onClick={point} draggable={false}/>
            {units.filter(unit => unit.masterPlanX != null && unit.masterPlanY != null).map(unit => <button draggable key={unit.id} type="button" title={`${unit.externalUnitId} — ${unit.masterPlanLocationStatus}`} onDragEnd={event => void dragMarker(event, unit)} onClick={event => { event.stopPropagation(); setMode("UNIT"); setSelectedId(unit.id); }} className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border px-2 py-1 text-[11px] shadow ${unit.masterPlanLocationStatus === "CONFIRMED" ? "bg-forest text-white" : "bg-white"}`} style={{ left: `${Number(unit.masterPlanX) * 100}%`, top: `${Number(unit.masterPlanY) * 100}%` }}>{unit.externalUnitId}</button>)}
            {gates.filter(gate => gate.masterPlanX != null && gate.masterPlanY != null).map(gate => <button key={gate.id} type="button" onClick={event => { event.stopPropagation(); setMode("GATE"); setGateId(gate.id); }} className="absolute -translate-x-1/2 -translate-y-1/2 rounded bg-black px-2 py-1 text-[10px] text-white" style={{ left: `${Number(gate.masterPlanX) * 100}%`, top: `${Number(gate.masterPlanY) * 100}%` }}>{label(gate)}</button>)}
          </div>
        </div>
      </div>}
    </div>
  </section>;
}
