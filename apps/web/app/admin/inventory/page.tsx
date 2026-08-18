"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { CheckSquare, Edit3, FileSpreadsheet, Plus, Search, X } from "lucide-react";
import { adminApi, adminErrorMessage } from "@/lib/api";
import { UnitMarketProfileEditor } from "@/components/unit-market-profile-editor";

type Developer = { id: string; name: string };
type ProjectRef = { id: string; name: string; developerId: string; developer?: Developer };
type Phase = { id: string; name: string; nameAr?: string | null; code?: string | null };
type Building = { id: string; name: string; nameAr?: string | null; code?: string | null; phaseId?: string | null };
type ProjectStructure = { phases?: Phase[]; buildings?: Building[] };
type Unit = {
  id: string;
  externalUnitId: string;
  unitType?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  builtUpArea?: string | null;
  price?: string | null;
  currency?: string | null;
  status: string;
  isResale: boolean;
  updatedAt: string;
  phaseRef?: Phase | null;
  projectBuilding?: Building | null;
  project: { id: string; name: string; location?: { name: string } | null };
  developer: { id: string; name: string };
  sourceImport?: { id: string; name?: string | null; fileName: string } | null;
  media?: Array<{ id: string; type: string; url: string; altTextAr?: string | null; altText?: string | null; isCover?: boolean }> | null;
  marketProfiles?: Array<{ id: string; segment: string; propertyUse: string; suitability?: string | null; demand?: string | null; yieldMin?: string | number | null; yieldMax?: string | number | null; liquidity?: string | null; notes?: string | null }> | null;
};
type Page = { items: Unit[]; page: number; pageSize: number; total: number };

const slugify = (value: string) => value.trim().toLowerCase().normalize("NFKD").replace(/[^a-z0-9\u0600-\u06ff]+/g, "-").replace(/^-|-$/g, "").slice(0, 100) || `item-${Date.now()}`;
const phaseLabel = (phase: Phase) => phase.nameAr || phase.name || phase.code || "مرحلة";
const buildingLabel = (building: Building) => building.nameAr || building.name || building.code || "مبنى";

export default function InventoryPage() {
  const [data, setData] = useState<Page>({ items: [], page: 1, pageSize: 50, total: 0 });
  const [filters, setFilters] = useState({ unitCode: "", status: "", unitType: "", minPrice: "", maxPrice: "", saleType: "" });
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<Unit | null>(null);
  const [editingDetails, setEditingDetails] = useState<Unit | null>(null);
  const [creating, setCreating] = useState(false);
  const [developers, setDevelopers] = useState<Developer[]>([]);
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [selectedDeveloperId, setSelectedDeveloperId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedPhaseId, setSelectedPhaseId] = useState("");
  const [structure, setStructure] = useState<ProjectStructure>({ phases: [], buildings: [] });
  const [inlineDeveloper, setInlineDeveloper] = useState(false);
  const [inlineProject, setInlineProject] = useState(false);
  const [inlinePhase, setInlinePhase] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const filteredProjects = useMemo(() => projects.filter((project) => !selectedDeveloperId || project.developerId === selectedDeveloperId), [projects, selectedDeveloperId]);
  const phases = structure.phases ?? [];
  const buildings = useMemo(() => (structure.buildings ?? []).filter((building) => !selectedPhaseId || building.phaseId === selectedPhaseId || !building.phaseId), [structure, selectedPhaseId]);

  async function loadReferences() {
    try {
      const [developerRows, projectRows] = await Promise.all([
        adminApi.get<Developer[]>("/catalog/developers"),
        adminApi.get<ProjectRef[]>("/catalog/projects"),
      ]);
      setDevelopers(developerRows);
      setProjects(projectRows);
    } catch (err) { setError(adminErrorMessage(err)); }
  }

  async function loadStructure(projectId: string) {
    if (!projectId) { setStructure({ phases: [], buildings: [] }); setSelectedPhaseId(""); return; }
    try {
      const project = await adminApi.get<ProjectStructure>(`/real-estate/projects/${projectId}`);
      setStructure({ phases: project.phases ?? [], buildings: project.buildings ?? [] });
      setSelectedPhaseId((current) => project.phases?.some((phase) => phase.id === current) ? current : project.phases?.[0]?.id ?? "");
    } catch (err) { setError(adminErrorMessage(err)); }
  }

  const load = (page = 1) => {
    const scopedProjectId = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("projectId") || "" : "";
    const q = new URLSearchParams({ unitCode: filters.unitCode, status: filters.status, unitType: filters.unitType, minPrice: filters.minPrice, maxPrice: filters.maxPrice, ...(filters.saleType ? { isResale: filters.saleType } : {}), ...(scopedProjectId ? { projectId: scopedProjectId } : {}), page: String(page), pageSize: "50" });
    adminApi.get<Page>(`/catalog/units?${q}`).then(setData).catch((err) => setError(adminErrorMessage(err)));
  };

  useEffect(() => { void loadReferences(); void load(); }, []);

  async function openEditor(unit: Unit) {
    setEditing(unit); setEditingDetails(null);
    try { setEditingDetails(await adminApi.get<Unit>(`/catalog/units/${unit.id}`)); } catch (err) { setError(adminErrorMessage(err)); }
  }

  async function uploadUnitMedia(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing) return;
    const formElement = event.currentTarget; const form = new FormData(formElement); form.append("unitId", editing.id);
    try { setBusy(true); await adminApi.upload("/catalog/media", form); setEditingDetails(await adminApi.get<Unit>(`/catalog/units/${editing.id}`)); formElement.reset(); } catch (err) { setError(adminErrorMessage(err)); } finally { setBusy(false); }
  }

  async function saveUnit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing) return;
    const formElement = event.currentTarget; const form = new FormData(formElement); setBusy(true);
    try {
      const payload = Object.fromEntries([...form.entries()].filter(([, value]) => value !== "")) as Record<string, unknown>;
      if (payload.isResale != null) payload.isResale = payload.isResale === "true";
      await adminApi.patch(`/catalog/units/${editing.id}`, payload); setEditing(null); load(data.page);
    } catch (err) { setError(adminErrorMessage(err)); } finally { setBusy(false); }
  }

  async function createDeveloper(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); const name = String(form.get("name") ?? "").trim(); if (!name) return;
    try { setBusy(true); const created = await adminApi.post<Developer>("/catalog/developers", { name, slug: slugify(name) }); await loadReferences(); setSelectedDeveloperId(created.id); setSelectedProjectId(""); setInlineDeveloper(false); } catch (err) { setError(adminErrorMessage(err)); } finally { setBusy(false); }
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedDeveloperId) return setError("اختر المطور أو أنشئه أولًا."); const formElement = event.currentTarget; const form = new FormData(formElement); const name = String(form.get("name") ?? "").trim(); if (!name) return;
    try { setBusy(true); const created = await adminApi.post<ProjectRef>("/catalog/projects", { developerId: selectedDeveloperId, name, slug: slugify(`${name}-${selectedDeveloperId.slice(-5)}`) }); await loadReferences(); setSelectedProjectId(created.id); setInlineProject(false); await loadStructure(created.id); } catch (err) { setError(adminErrorMessage(err)); } finally { setBusy(false); }
  }

  async function createPhase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedProjectId) return; const formElement = event.currentTarget; const form = new FormData(formElement); const name = String(form.get("name") ?? "").trim(); if (!name) return;
    try { setBusy(true); const created = await adminApi.post<Phase>(`/real-estate/projects/${selectedProjectId}/phases`, { name }); await loadStructure(selectedProjectId); setSelectedPhaseId(created.id); setInlinePhase(false); } catch (err) { setError(adminErrorMessage(err)); } finally { setBusy(false); }
  }

  async function createUnit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedDeveloperId || !selectedProjectId || !selectedPhaseId) return setError("الوحدة لازم ترتبط بمطور ومشروع ومرحلة.");
    const formElement = event.currentTarget; const form = new FormData(formElement);
    const number = (name: string) => String(form.get(name) ?? "").trim() ? Number(form.get(name)) : undefined;
    try {
      setBusy(true); setError("");
      await adminApi.post("/catalog/units", {
        externalUnitId: String(form.get("externalUnitId") ?? "").trim(), developerId: selectedDeveloperId, projectId: selectedProjectId, phaseId: selectedPhaseId,
        projectBuildingId: String(form.get("projectBuildingId") ?? "") || undefined, unitType: String(form.get("unitType") ?? "") || undefined,
        bedrooms: number("bedrooms"), bathrooms: number("bathrooms"), builtUpArea: number("builtUpArea"), price: number("price"), currency: "EGP",
        status: String(form.get("status") ?? "AVAILABLE"), isResale: String(form.get("isResale") ?? "false") === "true",
        floor: String(form.get("floor") ?? "") || undefined, finishingType: String(form.get("finishingType") ?? "") || undefined,
        deliveryDate: String(form.get("deliveryDate") ?? "") || undefined,
      });
      formElement.reset(); setCreating(false); load(1);
    } catch (err) { setError(adminErrorMessage(err)); } finally { setBusy(false); }
  }

  async function bulk(action: string) {
    if (!selected.length) return;
    const confirmation = prompt(`سيتم تطبيق الإجراء على ${selected.length} وحدة. اكتب CONFIRM ${selected.length}`);
    if (confirmation !== `CONFIRM ${selected.length}`) return;
    setBusy(true);
    try { await adminApi.post("/catalog/units/bulk", { unitIds: selected, action, confirmation }); setSelected([]); load(data.page); } catch (err) { setError(adminErrorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <main className="mx-auto max-w-[1480px] p-3 sm:p-6 lg:p-8" dir="rtl">
      <section className="mb-4 flex flex-wrap items-start justify-between gap-4 rounded-[26px] border border-[#dfe4e0] bg-white p-5 sm:p-6">
        <div><p className="text-[10px] font-black uppercase tracking-[.2em] text-[#b08c52]">Inventory</p><h1 className="mt-1 text-[26px] font-black">المخزون العقاري</h1><p className="mt-1 text-sm text-[#74817b]">وحدات منفردة أو استيراد Excel، Primary أو Resale، وكل وحدة مرتبطة بمرحلة حقيقية.</p></div>
        <div className="flex gap-2"><Link href="/admin/data/import" className="inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-black"><FileSpreadsheet size={15} />استيراد Excel</Link><button onClick={() => setCreating(true)} className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#14211f] px-4 text-sm font-black text-white"><Plus size={16} />إضافة وحدة</button></div>
      </section>

      {error ? <div className="mb-4 flex justify-between rounded-xl bg-red-50 p-4 text-sm text-red-800"><span>{error}</span><button onClick={() => setError("")}>×</button></div> : null}

      <form onSubmit={(event) => { event.preventDefault(); load(1); }} className="mb-4 grid gap-2 rounded-2xl border bg-white p-4 sm:grid-cols-2 lg:grid-cols-7">
        <input placeholder="كود الوحدة" value={filters.unitCode} onChange={(event) => setFilters({ ...filters, unitCode: event.target.value })} className="h-11 rounded-xl border px-3 text-base" />
        <input placeholder="نوع الوحدة" value={filters.unitType} onChange={(event) => setFilters({ ...filters, unitType: event.target.value })} className="h-11 rounded-xl border px-3 text-base" />
        <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })} className="h-11 rounded-xl border px-3 text-sm"><option value="">كل الحالات</option>{["AVAILABLE", "RESERVED", "SOLD", "UNAVAILABLE", "CONTACT_SALES"].map((value) => <option key={value}>{value}</option>)}</select>
        <select value={filters.saleType} onChange={(event) => setFilters({ ...filters, saleType: event.target.value })} className="h-11 rounded-xl border px-3 text-sm"><option value="">Primary + Resale</option><option value="false">Primary فقط</option><option value="true">Resale فقط</option></select>
        <input type="number" placeholder="أقل سعر" value={filters.minPrice} onChange={(event) => setFilters({ ...filters, minPrice: event.target.value })} className="h-11 rounded-xl border px-3 text-base" />
        <input type="number" placeholder="أعلى سعر" value={filters.maxPrice} onChange={(event) => setFilters({ ...filters, maxPrice: event.target.value })} className="h-11 rounded-xl border px-3 text-base" />
        <button className="flex h-11 items-center justify-center gap-2 rounded-xl bg-forest text-sm font-bold text-white"><Search size={15} />بحث</button>
      </form>

      {selected.length > 0 ? <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl bg-[#183b33] p-3 text-white"><span className="px-2 text-sm font-bold">{selected.length} محددة</span>{[["MARK_AVAILABLE", "متاحة"], ["MARK_RESERVED", "محجوزة"], ["MARK_SOLD", "مباعة"], ["MARK_UNAVAILABLE", "غير متاحة"], ["ARCHIVE", "أرشفة"]].map(([action, label]) => <button key={action} disabled={busy} onClick={() => void bulk(action)} className="rounded-lg bg-white/10 px-3 py-2 text-xs font-bold hover:bg-white/20">{label}</button>)}</div> : null}

      <div className="overflow-x-auto rounded-2xl border bg-white"><table className="w-full min-w-[1160px] text-right text-sm"><thead className="bg-[#eef1ee]"><tr><th className="p-3"><CheckSquare size={15} /></th>{["الكود", "المشروع / المرحلة", "المطور", "النوع", "الغرف", "المساحة", "السعر", "الحالة", "السوق", "مصدر البيانات", "تعديل"].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody className="divide-y">{data.items.map((unit) => <tr key={unit.id} className="hover:bg-[#fafaf7]"><td className="p-3"><input type="checkbox" checked={selected.includes(unit.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, unit.id] : selected.filter((id) => id !== unit.id))} /></td><td className="p-3 font-bold" dir="auto">{unit.externalUnitId}</td><td className="p-3" dir="auto"><Link href={`/admin/projects/${unit.project.id}`} className="font-bold hover:underline">{unit.project.name}</Link><span className="block text-xs text-[#84908a]">{unit.phaseRef ? phaseLabel(unit.phaseRef) : "بدون مرحلة"}{unit.projectBuilding ? ` · ${buildingLabel(unit.projectBuilding)}` : ""}</span></td><td className="p-3">{unit.developer.name}</td><td className="p-3">{unit.unitType || "—"}</td><td className="p-3">{unit.bedrooms ?? "—"}</td><td className="p-3">{unit.builtUpArea || "—"}</td><td className="p-3" dir="ltr">{unit.price ? `${Number(unit.price).toLocaleString("en")} ${unit.currency || "EGP"}` : "—"}</td><td className="p-3"><span className="rounded-full bg-[#e7efe9] px-2 py-1 text-xs font-bold">{unit.status}</span></td><td className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${unit.isResale ? "bg-[#f2eadc] text-[#71562e]" : "bg-[#edf2ef] text-[#3d5b51]"}`}>{unit.isResale ? "Resale" : "Primary"}</span></td><td className="p-3 text-xs">{unit.sourceImport?.name || unit.sourceImport?.fileName || "إدخال يدوي"}</td><td className="p-3"><button onClick={() => void openEditor(unit)} className="rounded-lg border p-2"><Edit3 size={14} /></button></td></tr>)}</tbody></table></div>
      <div className="mt-4 flex items-center justify-between text-sm"><button disabled={data.page <= 1} onClick={() => load(data.page - 1)} className="rounded-lg border bg-white px-4 py-2">السابق</button><span>{data.page} · {data.total} وحدة</span><button disabled={data.page * data.pageSize >= data.total} onClick={() => load(data.page + 1)} className="rounded-lg border bg-white px-4 py-2">التالي</button></div>

      {creating ? <div className="fixed inset-0 z-50 grid place-items-center bg-[#0b1512]/45 p-3" onMouseDown={() => !busy && setCreating(false)}><div onMouseDown={(event) => event.stopPropagation()} className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-[28px] bg-[#f8f7f2] p-4 shadow-2xl sm:p-6"><div className="flex items-start justify-between"><div><p className="text-[10px] font-black uppercase tracking-[.2em] text-[#b08c52]">Manual inventory</p><h2 className="mt-1 text-2xl font-black">إضافة وحدة منفردة</h2><p className="mt-1 text-sm text-[#74817b]">مش محتاج Excel. أنشئ المطور أو المشروع أو المرحلة من نفس الشاشة لو مش موجودين.</p></div><button onClick={() => setCreating(false)} className="grid h-10 w-10 place-items-center rounded-full border bg-white"><X size={16} /></button></div>
        <div className="mt-5 grid gap-4 lg:grid-cols-3"><div className="rounded-2xl border bg-white p-4"><label className="text-sm font-black">1. المطور</label><select value={selectedDeveloperId} onChange={(event) => { setSelectedDeveloperId(event.target.value); setSelectedProjectId(""); setStructure({ phases: [], buildings: [] }); }} className="mt-2 h-12 w-full rounded-xl border bg-white px-3"><option value="">اختر المطور</option>{developers.map((developer) => <option key={developer.id} value={developer.id}>{developer.name}</option>)}</select><button type="button" onClick={() => setInlineDeveloper((value) => !value)} className="mt-2 text-xs font-black text-[#17483e]">+ المطور غير موجود</button>{inlineDeveloper ? <form onSubmit={createDeveloper} className="mt-3 flex gap-2"><input required name="name" placeholder="اسم المطور" className="h-10 min-w-0 flex-1 rounded-xl border px-2" /><button disabled={busy} className="rounded-xl border px-3 text-xs font-black">إنشاء</button></form> : null}</div>
          <div className="rounded-2xl border bg-white p-4"><label className="text-sm font-black">2. المشروع</label><select value={selectedProjectId} onChange={(event) => { setSelectedProjectId(event.target.value); void loadStructure(event.target.value); }} disabled={!selectedDeveloperId} className="mt-2 h-12 w-full rounded-xl border bg-white px-3 disabled:opacity-40"><option value="">اختر المشروع</option>{filteredProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><button type="button" disabled={!selectedDeveloperId} onClick={() => setInlineProject((value) => !value)} className="mt-2 text-xs font-black text-[#17483e] disabled:opacity-40">+ المشروع غير موجود</button>{inlineProject ? <form onSubmit={createProject} className="mt-3 flex gap-2"><input required name="name" placeholder="اسم المشروع" className="h-10 min-w-0 flex-1 rounded-xl border px-2" /><button disabled={busy} className="rounded-xl border px-3 text-xs font-black">إنشاء</button></form> : null}</div>
          <div className="rounded-2xl border bg-white p-4"><label className="text-sm font-black">3. المرحلة</label><select value={selectedPhaseId} onChange={(event) => setSelectedPhaseId(event.target.value)} disabled={!selectedProjectId} className="mt-2 h-12 w-full rounded-xl border bg-white px-3 disabled:opacity-40"><option value="">اختر المرحلة</option>{phases.map((phase) => <option key={phase.id} value={phase.id}>{phaseLabel(phase)}</option>)}</select><button type="button" disabled={!selectedProjectId} onClick={() => setInlinePhase((value) => !value)} className="mt-2 text-xs font-black text-[#17483e] disabled:opacity-40">+ أضف مرحلة</button>{inlinePhase ? <form onSubmit={createPhase} className="mt-3 flex gap-2"><input required name="name" placeholder="اسم المرحلة" className="h-10 min-w-0 flex-1 rounded-xl border px-2" /><button disabled={busy} className="rounded-xl border px-3 text-xs font-black">إنشاء</button></form> : null}</div></div>
        <form onSubmit={createUnit} className="mt-4 rounded-[24px] border bg-white p-4 sm:p-5"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="text-sm font-bold">كود الوحدة *<input required name="externalUnitId" className="mt-1 h-11 w-full rounded-xl border px-3 font-normal" /></label><label className="text-sm font-bold">المبنى<select name="projectBuildingId" className="mt-1 h-11 w-full rounded-xl border bg-white px-3 font-normal"><option value="">بدون مبنى حاليًا</option>{buildings.map((building) => <option key={building.id} value={building.id}>{buildingLabel(building)}</option>)}</select></label><label className="text-sm font-bold">نوع الوحدة<input name="unitType" placeholder="Apartment" className="mt-1 h-11 w-full rounded-xl border px-3 font-normal" /></label><label className="text-sm font-bold">السوق<select name="isResale" className="mt-1 h-11 w-full rounded-xl border bg-white px-3 font-normal"><option value="false">Primary</option><option value="true">Resale</option></select></label><label className="text-sm font-bold">غرف<input name="bedrooms" type="number" min="0" className="mt-1 h-11 w-full rounded-xl border px-3 font-normal" /></label><label className="text-sm font-bold">حمامات<input name="bathrooms" type="number" min="0" className="mt-1 h-11 w-full rounded-xl border px-3 font-normal" /></label><label className="text-sm font-bold">المساحة م²<input name="builtUpArea" type="number" min="0" step="any" className="mt-1 h-11 w-full rounded-xl border px-3 font-normal" /></label><label className="text-sm font-bold">السعر EGP<input name="price" type="number" min="0" step="any" className="mt-1 h-11 w-full rounded-xl border px-3 font-normal" /></label><label className="text-sm font-bold">الحالة<select name="status" className="mt-1 h-11 w-full rounded-xl border bg-white px-3 font-normal">{["AVAILABLE", "RESERVED", "SOLD", "UNAVAILABLE", "CONTACT_SALES"].map((value) => <option key={value}>{value}</option>)}</select></label><label className="text-sm font-bold">الدور<input name="floor" className="mt-1 h-11 w-full rounded-xl border px-3 font-normal" /></label><label className="text-sm font-bold">التشطيب<input name="finishingType" className="mt-1 h-11 w-full rounded-xl border px-3 font-normal" /></label><label className="text-sm font-bold">تاريخ الاستلام<input name="deliveryDate" type="date" className="mt-1 h-11 w-full rounded-xl border px-3 font-normal" /></label></div><button disabled={busy || !selectedDeveloperId || !selectedProjectId || !selectedPhaseId} className="mt-5 h-12 rounded-xl bg-[#173f3b] px-7 font-black text-white disabled:opacity-30">إضافة الوحدة للمخزون</button></form>
      </div></div> : null}

      {editing ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4"><div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5"><div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-bold">تعديل الوحدة <span dir="auto">{editing.externalUnitId}</span></h2><button type="button" onClick={() => { setEditing(null); setEditingDetails(null); }}>×</button></div><form onSubmit={saveUnit}><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">السعر<input name="price" type="number" defaultValue={editing.price || ""} className="mt-1 h-11 w-full rounded-xl border px-3" /></label><label className="text-sm">الحالة<select name="status" defaultValue={editing.status} className="mt-1 h-11 w-full rounded-xl border px-3">{["AVAILABLE", "RESERVED", "SOLD", "UNAVAILABLE", "CONTACT_SALES"].map((value) => <option key={value}>{value}</option>)}</select></label><label className="text-sm">نوع الوحدة<input name="unitType" defaultValue={editing.unitType || ""} className="mt-1 h-11 w-full rounded-xl border px-3" /></label><label className="text-sm">السوق<select name="isResale" defaultValue={String(editing.isResale)} className="mt-1 h-11 w-full rounded-xl border px-3"><option value="false">Primary</option><option value="true">Resale</option></select></label><label className="text-sm">غرف النوم<input name="bedrooms" type="number" defaultValue={editing.bedrooms ?? ""} className="mt-1 h-11 w-full rounded-xl border px-3" /></label><label className="text-sm">المساحة المبنية<input name="builtUpArea" type="number" defaultValue={editing.builtUpArea || ""} className="mt-1 h-11 w-full rounded-xl border px-3" /></label></div><button disabled={busy} className="mt-5 h-11 w-full rounded-xl bg-forest font-bold text-white">تطبيق التعديل</button></form><div className="mt-5 border-t pt-4"><h3 className="font-bold">صور الوحدة ومخططها</h3><p className="mt-1 text-xs text-[#68756f]">FLOOR_PLAN للمخطط الداخلي وIMAGE لصورة الوحدة. Master Plan المشروع في مكانه المستقل.</p><div className="mt-3 grid grid-cols-3 gap-2">{(editingDetails?.media || []).map((media) => <div key={media.id} className="overflow-hidden rounded-xl border"><img src={media.url} alt={media.altTextAr || media.altText || "صورة الوحدة"} className="h-24 w-full object-cover" /><div className="p-2 text-[11px]">{media.type}</div></div>)}</div><form onSubmit={uploadUnitMedia} className="mt-3 grid gap-2 sm:grid-cols-2"><input required name="file" type="file" accept="image/*" className="rounded-xl border p-2 text-sm" /><select name="type" defaultValue="FLOOR_PLAN" className="h-11 rounded-xl border px-3"><option value="FLOOR_PLAN">مخطط الوحدة</option><option value="IMAGE">صورة الوحدة</option></select><input name="altTextAr" placeholder="وصف الصورة" className="h-11 rounded-xl border px-3 sm:col-span-2" /><button disabled={busy} className="h-10 rounded-xl border border-forest font-bold text-forest sm:col-span-2">رفع صورة للوحدة</button></form></div>{editingDetails ? <UnitMarketProfileEditor projectId={editingDetails.project.id} unitId={editingDetails.id} profiles={editingDetails.marketProfiles || []} onChanged={async()=>setEditingDetails(await adminApi.get<Unit>(`/catalog/units/${editingDetails.id}`))} /> : null}</div></div> : null}
    </main>
  );
}
