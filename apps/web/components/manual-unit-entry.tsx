"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Building2, Plus, X } from "lucide-react";
import { adminApi, adminErrorMessage } from "@/lib/api";

type Developer = { id: string; name: string };
type Location = { id: string; name: string; type?: string; parent?: { name: string } | null };
type Project = { id: string; name: string; developerId: string; locationId?: string | null; developer?: Developer; location?: Location | null };
type Phase = { id: string; name: string; nameAr?: string | null; code?: string | null };
type Building = { id: string; name: string; nameAr?: string | null; code?: string | null; phaseId?: string | null };
type Structure = { phases?: Phase[]; buildings?: Building[] };

const slugify = (value: string) => value.trim().toLowerCase().normalize("NFKD").replace(/[^a-z0-9\u0600-\u06ff]+/g, "-").replace(/^-|-$/g, "").slice(0, 100) || `item-${Date.now()}`;
const phaseLabel = (phase: Phase) => phase.nameAr || phase.name || phase.code || "مرحلة";
const buildingLabel = (building: Building) => building.nameAr || building.name || building.code || "مبنى";

export function ManualUnitEntry({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: () => void }) {
  const [developers, setDevelopers] = useState<Developer[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [developerId, setDeveloperId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [phaseId, setPhaseId] = useState("");
  const [structure, setStructure] = useState<Structure>({ phases: [], buildings: [] });
  const [developerName, setDeveloperName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectLocationId, setProjectLocationId] = useState("");
  const [phaseName, setPhaseName] = useState("");
  const [locationName, setLocationName] = useState("");
  const [locationType, setLocationType] = useState("AREA");
  const [locationParentId, setLocationParentId] = useState("");
  const [showLocation, setShowLocation] = useState(false);
  const [showDeveloper, setShowDeveloper] = useState(false);
  const [showProject, setShowProject] = useState(false);
  const [showPhase, setShowPhase] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const filteredProjects = useMemo(() => projects.filter((project) => !developerId || project.developerId === developerId), [projects, developerId]);
  const phases = structure.phases ?? [];
  const buildings = useMemo(() => (structure.buildings ?? []).filter((building) => !phaseId || !building.phaseId || building.phaseId === phaseId), [structure, phaseId]);

  async function loadRefs() {
    const [devs, projs, locs] = await Promise.all([
      adminApi.get<Developer[]>("/catalog/developers"),
      adminApi.get<Project[]>("/catalog/projects"),
      adminApi.get<Location[]>("/locations"),
    ]);
    setDevelopers(devs); setProjects(projs); setLocations(locs);
  }
  async function loadStructure(id: string) {
    if (!id) { setStructure({ phases: [], buildings: [] }); setPhaseId(""); return; }
    const project = await adminApi.get<Structure>(`/real-estate/projects/${id}`);
    setStructure({ phases: project.phases ?? [], buildings: project.buildings ?? [] });
    setPhaseId("");
  }
  useEffect(() => { if (open) void loadRefs().catch((err) => setError(adminErrorMessage(err))); }, [open]);

  async function createDeveloper() {
    if (!developerName.trim()) return;
    try {
      setBusy(true); setError("");
      const created = await adminApi.post<Developer>("/catalog/developers", { name: developerName.trim(), slug: slugify(`${developerName}-${Date.now()}`) });
      await loadRefs(); setDeveloperId(created.id); setProjectId(""); setDeveloperName(""); setShowDeveloper(false);
    } catch (err) { setError(adminErrorMessage(err)); } finally { setBusy(false); }
  }
  async function createLocation() {
    if (!locationName.trim() || (locationType !== "COUNTRY" && !locationParentId)) return;
    try {
      setBusy(true); setError("");
      const created = await adminApi.post<Location>("/locations", { name: locationName.trim(), nameAr: locationName.trim(), slug: slugify(`${locationName}-${Date.now()}`), type: locationType, parentId: locationType === "COUNTRY" ? undefined : locationParentId });
      await loadRefs(); setProjectLocationId(created.id); setLocationName(""); setLocationParentId(""); setShowLocation(false);
    } catch (err) { setError(adminErrorMessage(err)); } finally { setBusy(false); }
  }
  async function createProject() {
    if (!developerId || !projectName.trim() || !projectLocationId) return setError("المشروع الجديد يحتاج مطورًا وموقعًا حتى لا يبدأ بسياق ناقص.");
    try {
      setBusy(true); setError("");
      const created = await adminApi.post<Project>("/catalog/projects", { developerId, locationId: projectLocationId, name: projectName.trim(), slug: slugify(`${projectName}-${Date.now()}`) });
      await loadRefs(); setProjectId(created.id); setProjectName(""); setProjectLocationId(""); setShowProject(false); await loadStructure(created.id);
    } catch (err) { setError(adminErrorMessage(err)); } finally { setBusy(false); }
  }
  async function createPhase() {
    if (!projectId || !phaseName.trim()) return;
    try {
      setBusy(true); setError("");
      const created = await adminApi.post<Phase>(`/real-estate/projects/${projectId}/phases`, { name: phaseName.trim(), nameAr: phaseName.trim() });
      await loadStructure(projectId); setPhaseId(created.id); setPhaseName(""); setShowPhase(false);
    } catch (err) { setError(adminErrorMessage(err)); } finally { setBusy(false); }
  }
  async function createUnit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!developerId || !projectId || !phaseId) return setError("اختر المطور والمشروع والمرحلة قبل حفظ الوحدة.");
    const form = new FormData(event.currentTarget);
    const number = (name: string) => String(form.get(name) ?? "").trim() ? Number(form.get(name)) : undefined;
    try {
      setBusy(true); setError("");
      await adminApi.post("/catalog/units", {
        externalUnitId: String(form.get("externalUnitId") ?? "").trim() || undefined, developerId, projectId, phaseId,
        projectBuildingId: String(form.get("projectBuildingId") ?? "") || undefined,
        unitType: String(form.get("unitType") ?? "") || undefined, unitSubType: String(form.get("unitSubType") ?? "") || undefined,
        bedrooms: number("bedrooms"), bathrooms: number("bathrooms"), builtUpArea: number("builtUpArea"), landArea: number("landArea"), price: number("price"),
        currency: String(form.get("currency") ?? "EGP"), status: String(form.get("status") ?? "AVAILABLE"), isResale: String(form.get("isResale") ?? "false") === "true",
        floor: String(form.get("floor") ?? "") || undefined, finishingType: String(form.get("finishingType") ?? "") || undefined,
        deliveryDate: String(form.get("deliveryDate") ?? "") || undefined,
      });
      event.currentTarget.reset(); onCreated?.(); onClose();
    } catch (err) { setError(adminErrorMessage(err)); } finally { setBusy(false); }
  }

  if (!open) return null;
  return <div className="fixed inset-0 z-[90] grid place-items-center bg-[#0b1512]/50 p-3" onMouseDown={() => !busy && onClose()} dir="rtl">
    <div className="max-h-[95vh] w-full max-w-5xl overflow-y-auto rounded-[28px] bg-[#f7f6f1] p-4 shadow-2xl sm:p-6" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-black uppercase tracking-[.22em] text-[#b08c52]">Manual inventory</p><h2 className="mt-1 text-2xl font-black">إضافة عقار / وحدة منفردة</h2><p className="mt-1 text-sm text-[#74817b]">بدون Excel. أنشئ المطور أو المشروع أو المرحلة من نفس المسار ثم اربط الوحدة مباشرة.</p></div><button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full border bg-white"><X size={17}/></button></div>
      {error && <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        <section className="rounded-2xl border bg-white p-4"><div className="flex items-center justify-between"><b>1. المطور</b><Building2 size={16}/></div><select value={developerId} onChange={(e)=>{setDeveloperId(e.target.value);setProjectId("");setPhaseId("");setStructure({phases:[],buildings:[]})}} className="mt-3 h-11 w-full rounded-xl border bg-white px-3"><option value="">اختر المطور</option>{developers.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select><button type="button" onClick={()=>setShowDeveloper(v=>!v)} className="mt-2 text-xs font-black text-forest">+ مطور غير موجود</button>{showDeveloper&&<div className="mt-2 flex gap-2"><input value={developerName} onChange={e=>setDeveloperName(e.target.value)} placeholder="اسم المطور" className="h-10 min-w-0 flex-1 rounded-xl border px-2"/><button disabled={busy||!developerName.trim()} onClick={createDeveloper} className="rounded-xl border px-3 text-xs font-black">إنشاء</button></div>}</section>
        <section className="rounded-2xl border bg-white p-4"><b>2. المشروع</b><select disabled={!developerId} value={projectId} onChange={(e)=>{setProjectId(e.target.value);void loadStructure(e.target.value)}} className="mt-3 h-11 w-full rounded-xl border bg-white px-3 disabled:opacity-40"><option value="">اختر المشروع</option>{filteredProjects.map(p=><option key={p.id} value={p.id}>{p.name}{p.location?.name?` — ${p.location.name}`:""}</option>)}</select><button type="button" disabled={!developerId} onClick={()=>setShowProject(v=>!v)} className="mt-2 text-xs font-black text-forest disabled:opacity-40">+ مشروع غير موجود</button>{showProject&&<div className="mt-2 space-y-2"><input value={projectName} onChange={e=>setProjectName(e.target.value)} placeholder="اسم المشروع" className="h-10 w-full rounded-xl border px-2"/><select value={projectLocationId} onChange={e=>setProjectLocationId(e.target.value)} className="h-10 w-full rounded-xl border bg-white px-2"><option value="">موقع المشروع *</option>{locations.map(l=><option key={l.id} value={l.id}>{l.name}{l.parent?.name?` — ${l.parent.name}`:""}</option>)}</select><button type="button" onClick={()=>setShowLocation(v=>!v)} className="text-start text-xs font-black text-forest">+ الموقع غير موجود؟</button>{showLocation&&<div className="space-y-2 rounded-xl bg-[#f7f8f5] p-2"><input value={locationName} onChange={e=>setLocationName(e.target.value)} placeholder="اسم الموقع" className="h-10 w-full rounded-xl border px-2"/><select value={locationType} onChange={e=>{setLocationType(e.target.value);if(e.target.value==="COUNTRY")setLocationParentId("")}} className="h-10 w-full rounded-xl border bg-white px-2">{["COUNTRY","GOVERNORATE","CITY","AREA","SUBAREA"].map(v=><option key={v}>{v}</option>)}</select>{locationType!=="COUNTRY"&&<select value={locationParentId} onChange={e=>setLocationParentId(e.target.value)} className="h-10 w-full rounded-xl border bg-white px-2"><option value="">الموقع الأب *</option>{locations.map(l=><option key={l.id} value={l.id}>{l.name} · {l.type||"LOCATION"}</option>)}</select>}<button type="button" disabled={busy||!locationName.trim()||(locationType!=="COUNTRY"&&!locationParentId)} onClick={createLocation} className="h-10 w-full rounded-xl border bg-white text-xs font-black disabled:opacity-40">إضافة الموقع</button></div>}<button disabled={busy||!projectName.trim()||!projectLocationId} onClick={createProject} className="h-10 w-full rounded-xl border text-xs font-black">إنشاء المشروع</button></div>}</section>
        <section className="rounded-2xl border bg-white p-4"><b>3. المرحلة</b><select disabled={!projectId} value={phaseId} onChange={e=>setPhaseId(e.target.value)} className="mt-3 h-11 w-full rounded-xl border bg-white px-3 disabled:opacity-40"><option value="">اختر المرحلة</option>{phases.map(p=><option key={p.id} value={p.id}>{phaseLabel(p)}</option>)}</select><button type="button" disabled={!projectId} onClick={()=>setShowPhase(v=>!v)} className="mt-2 text-xs font-black text-forest disabled:opacity-40">+ مرحلة غير موجودة</button>{showPhase&&<div className="mt-2 flex gap-2"><input value={phaseName} onChange={e=>setPhaseName(e.target.value)} placeholder="اسم المرحلة" className="h-10 min-w-0 flex-1 rounded-xl border px-2"/><button disabled={busy||!phaseName.trim()} onClick={createPhase} className="rounded-xl border px-3 text-xs font-black">إنشاء</button></div>}</section>
      </div>
      <form onSubmit={createUnit} className="mt-4 rounded-[22px] border bg-white p-4 sm:p-5"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm font-bold">كود الوحدة <span className="font-normal text-[#7a8680]">(اختياري)</span><input name="externalUnitId" placeholder="اتركه فارغًا لتوليد كود تلقائي" className="mt-1 h-11 w-full rounded-xl border px-3 font-normal"/></label>
        <label className="text-sm font-bold">المبنى<select name="projectBuildingId" className="mt-1 h-11 w-full rounded-xl border bg-white px-3 font-normal"><option value="">بدون مبنى</option>{buildings.map(b=><option key={b.id} value={b.id}>{buildingLabel(b)}</option>)}</select></label>
        <label className="text-sm font-bold">نوع الوحدة<input name="unitType" placeholder="Apartment / Villa / Office…" className="mt-1 h-11 w-full rounded-xl border px-3 font-normal"/></label>
        <label className="text-sm font-bold">النوع الفرعي<input name="unitSubType" placeholder="Garden / Corner…" className="mt-1 h-11 w-full rounded-xl border px-3 font-normal"/></label>
        <label className="text-sm font-bold">السوق<select name="isResale" className="mt-1 h-11 w-full rounded-xl border bg-white px-3 font-normal"><option value="false">Primary</option><option value="true">Resale</option></select></label>
        <label className="text-sm font-bold">الحالة<select name="status" className="mt-1 h-11 w-full rounded-xl border bg-white px-3 font-normal">{["AVAILABLE","RESERVED","SOLD","UNAVAILABLE","CONTACT_SALES"].map(v=><option key={v}>{v}</option>)}</select></label>
        <label className="text-sm font-bold">غرف<input name="bedrooms" type="number" min="0" className="mt-1 h-11 w-full rounded-xl border px-3 font-normal"/></label>
        <label className="text-sm font-bold">حمامات<input name="bathrooms" type="number" min="0" className="mt-1 h-11 w-full rounded-xl border px-3 font-normal"/></label>
        <label className="text-sm font-bold">المساحة المبنية<input name="builtUpArea" type="number" min="0" step="any" className="mt-1 h-11 w-full rounded-xl border px-3 font-normal"/></label>
        <label className="text-sm font-bold">مساحة الأرض<input name="landArea" type="number" min="0" step="any" className="mt-1 h-11 w-full rounded-xl border px-3 font-normal"/></label>
        <label className="text-sm font-bold">السعر<input name="price" type="number" min="0" step="any" className="mt-1 h-11 w-full rounded-xl border px-3 font-normal"/></label>
        <label className="text-sm font-bold">العملة<select name="currency" defaultValue="EGP" className="mt-1 h-11 w-full rounded-xl border bg-white px-3 font-normal">{["EGP","USD","EUR","AED","SAR","GBP","QAR","KWD","BHD","OMR"].map(v=><option key={v}>{v}</option>)}</select></label>
        <label className="text-sm font-bold">الدور<input name="floor" className="mt-1 h-11 w-full rounded-xl border px-3 font-normal"/></label>
        <label className="text-sm font-bold">التشطيب<input name="finishingType" className="mt-1 h-11 w-full rounded-xl border px-3 font-normal"/></label>
        <label className="text-sm font-bold">تاريخ الاستلام<input name="deliveryDate" type="date" className="mt-1 h-11 w-full rounded-xl border px-3 font-normal"/></label>
      </div><button disabled={busy||!developerId||!projectId||!phaseId} className="mt-5 h-12 rounded-xl bg-[#14211f] px-7 font-black text-white disabled:opacity-30"><Plus size={16} className="me-2 inline"/>حفظ الوحدة في المخزون</button></form>
    </div>
  </div>;
}
