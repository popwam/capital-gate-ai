"use client";

import Link from "next/link";
import { FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpenCheck,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  CloudUpload,
  FileText,
  Image as ImageIcon,
  Layers3,
  MapPinned,
  PanelTop,
  Plus,
  Save,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { adminApi, adminErrorMessage } from "@/lib/api";
import { MultiSelectPicker, SmartOption, SmartTagPicker } from "@/components/smart-tag-picker";
import { PaymentPlanDesigner } from "@/components/payment-plan-designer";
import { ProjectBoundaryMap } from "@/components/project-boundary-map";
import { ProjectSpatialEditor } from "@/components/project-spatial-editor";
import { UnitMediaRuleManager } from "@/components/unit-media-rule-manager";

type Amenity = { id: string; canonicalName: string; nameAr?: string | null; nameEn?: string | null; category?: string | null };
type ProjectRef = { id: string; name: string; nameAr?: string | null; nameEn?: string | null; developer?: { name?: string | null } | null };
type Phase = Record<string, any> & { id: string; name: string; nameAr?: string | null; nameEn?: string | null; code?: string | null; _count?: { units?: number; buildings?: number; gates?: number; media?: number; documents?: number } };
type MarketProfile = Record<string, any> & { id: string; projectId: string; phaseId?: string | null; segment: string; propertyUse: string };
type Media = { id: string; projectId?: string | null; phaseId?: string | null; type: string; purpose?: string | null; url: string; altTextAr?: string | null; altTextEn?: string | null; isCover?: boolean; sortOrder?: number | null };
type Document = { id: string; projectId?: string | null; phaseId?: string | null; type: string; name: string; url: string; language?: string | null };
type Project = Record<string, any> & {
  id: string; name: string; nameAr?: string | null; nameEn?: string | null; adminStatus?: string; developer?: { id?: string; name?: string; nameAr?: string | null; nameEn?: string | null } | null;
  location?: { id?: string; name?: string; nameAr?: string | null; nameEn?: string | null; latitude?: number | string | null; longitude?: number | string | null } | null;
  phases?: Phase[]; amenities?: Array<{ amenityId: string; amenity?: Amenity | null }>;
  competitorsFrom?: Array<{ competitorProject?: ProjectRef | null }>;
  marketProfiles?: MarketProfile[]; media?: Media[]; documents?: Document[]; paymentPlans?: any[];
  gates?: any[]; buildings?: any[]; boundaryGeoJson?: any; knowledgeItems?: any[]; _count?: { units?: number; knowledgeItems?: number };
};
type Readiness = { ready: boolean; missing: string[]; warnings?: string[]; imageCount: number; phaseCount?: number; unassignedUnitCount?: number; marketProfileCount?: number };
type Tab = "overview" | "phases" | "market" | "media" | "payments" | "location" | "masterplan" | "knowledge";

type BaseDraft = {
  nameAr: string; nameEn: string; canonicalName: string; launchYear: string; projectStatus: string;
  projectTypes: string[]; deliveryStatuses: string[]; shortDescriptionAr: string; shortDescriptionEn: string;
  fullDescriptionAr: string; fullDescriptionEn: string; deliveryInformation: string; officialWebsite: string;
  amenityIds: string[]; competitorIds: string[];
};

const PROJECT_TYPES = [
  ["RESIDENTIAL", "سكني"], ["COMMERCIAL", "تجاري"], ["OFFICE", "إداري"], ["RETAIL", "تجزئة"], ["HOSPITALITY", "فندقي"], ["MIXED_USE", "متعدد الاستخدام"],
].map(([value, label]) => ({ value, label }));
const DELIVERY_STATUSES = [["PLANNED", "مخطط"], ["UNDER_CONSTRUCTION", "تحت الإنشاء"], ["READY_TO_MOVE", "جاهز للاستلام"], ["DELIVERING", "جارٍ التسليم"], ["DELIVERED", "تم التسليم"]].map(([value, label]) => ({ value, label }));
const PROJECT_STATUSES = [["PLANNED", "مخطط"], ["LAUNCHED", "مطروح"], ["UNDER_CONSTRUCTION", "تحت الإنشاء"], ["READY", "جاهز"], ["DELIVERED", "تم التسليم"], ["SOLD_OUT", "مباع بالكامل"]];
const UNIT_TYPES = ["Apartment", "Duplex", "Penthouse", "Studio", "Villa", "Townhouse", "Twin House", "Chalet", "Office", "Retail", "Clinic"].map((value) => ({ value, label: value }));
const FINISHING = [["FULLY_FINISHED", "تشطيب كامل"], ["CORE_SHELL", "Core & Shell"], ["SEMI_FINISHED", "نصف تشطيب"], ["FURNISHED", "مفروش"], ["CUSTOM", "حسب الوحدة"]].map(([value, label]) => ({ value, label }));
const CUSTOMER_FIT = [["FAMILIES", "عائلات"], ["YOUNG_COUPLES", "أزواج جدد"], ["INVESTORS", "مستثمرين"], ["END_USERS", "سكن فعلي"], ["VACATION", "مصيف"], ["BUSINESS", "أعمال"]].map(([value, label]) => ({ value, label }));
const MARKET_SEGMENTS = [["INVESTMENT", "استثمار"], ["RESALE", "إعادة بيع"], ["RENTAL", "إيجار"]] as const;
const PROPERTY_USES = PROJECT_TYPES.filter((item) => item.value !== "MIXED_USE").concat({ value: "MIXED", label: "متعدد الاستخدام" });
const YEARS = Array.from({ length: 31 }, (_, index) => 2015 + index);

const arr = <T,>(value: T[] | null | undefined): T[] => Array.isArray(value) ? value : [];
const projectName = (project?: Project | null) => project?.nameAr || project?.nameEn || project?.name || "مشروع";
const phaseName = (phase?: Phase | null) => phase?.nameAr || phase?.nameEn || phase?.name || "مرحلة";
const phaseDraftKey = (id: string) => `cgai-phase-draft:${id}`;
const marketDraftPrefix = (projectId: string) => `cgai-market-draft:${projectId}:`;
const marketDraftKey = (projectId: string, phaseId: string | null, segment: string, propertyUse: string) => `${marketDraftPrefix(projectId)}${phaseId || "PROJECT"}:${segment}:${propertyUse}`;
function phasePayload(draft: Record<string, any>, fallbackName = "Phase") {
  return {
    name: String(draft.name || fallbackName), nameAr: draft.nameAr || undefined, nameEn: draft.nameEn || undefined, code: draft.code || undefined,
    launchYear: draft.launchYear ? Number(draft.launchYear) : undefined, deliveryYear: draft.deliveryYear ? Number(draft.deliveryYear) : undefined, status: draft.status || undefined,
    constructionPercentage: draft.constructionPercentage === "" || draft.constructionPercentage == null ? undefined : Number(draft.constructionPercentage),
    projectTypes: arr(draft.projectTypes), deliveryStatuses: arr(draft.deliveryStatuses), unitTypes: arr(draft.unitTypes), finishingOptions: arr(draft.finishingOptions), customerFit: arr(draft.customerFit),
    minBedrooms: draft.minBedrooms === "" || draft.minBedrooms == null ? undefined : Number(draft.minBedrooms), maxBedrooms: draft.maxBedrooms === "" || draft.maxBedrooms == null ? undefined : Number(draft.maxBedrooms),
    minArea: draft.minArea === "" || draft.minArea == null ? undefined : Number(draft.minArea), maxArea: draft.maxArea === "" || draft.maxArea == null ? undefined : Number(draft.maxArea),
    descriptionAr: draft.descriptionAr || undefined, descriptionEn: draft.descriptionEn || undefined, deliveryNotesAr: draft.deliveryNotesAr || undefined, deliveryNotesEn: draft.deliveryNotesEn || undefined,
  };
}

function SectionTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return <div><p className="text-[10px] font-black uppercase tracking-[.22em] text-[#b08c52]">{eyebrow}</p><h2 className="mt-1 text-xl font-black text-[#17231f]">{title}</h2>{description ? <p className="mt-1 max-w-3xl text-sm leading-7 text-[#74817b]">{description}</p> : null}</div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-sm font-extrabold text-[#2b3834]"><span className="mb-1.5 block">{label}</span>{children}</label>;
}

function tabButton(active: boolean) {
  return `whitespace-nowrap rounded-xl px-3.5 py-2.5 text-sm font-black transition ${active ? "bg-[#173f3b] text-white shadow-sm" : "text-[#65716c] hover:bg-white hover:text-[#173f3b]"}`;
}

export default function ProjectDetails({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState("");
  const [item, setItem] = useState<Project | null>(null);
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [draft, setDraft] = useState<BaseDraft | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [selectedPhaseId, setSelectedPhaseId] = useState("");
  const [paymentScope, setPaymentScope] = useState("PROJECT");
  const [mediaScope, setMediaScope] = useState("PROJECT");
  const [marketScope, setMarketScope] = useState("PROJECT");
  const [marketSegment, setMarketSegment] = useState("INVESTMENT");
  const [marketUse, setMarketUse] = useState("RESIDENTIAL");
  const [boundary, setBoundary] = useState<Array<{ lat: number; lng: number }>>([]);
  const [autosaveAt, setAutosaveAt] = useState<Date | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { void params.then(({ id: projectId }) => { setId(projectId); void load(projectId); }); }, [params]);

  function toDraft(project: Project): BaseDraft {
    return {
      nameAr: project.nameAr ?? "", nameEn: project.nameEn ?? "", canonicalName: project.canonicalName ?? project.name ?? "",
      launchYear: project.launchYear ? String(project.launchYear) : "", projectStatus: project.projectStatus ?? "",
      projectTypes: arr(project.projectTypes).length ? arr(project.projectTypes) : project.projectType ? [project.projectType] : [],
      deliveryStatuses: arr(project.deliveryStatuses).length ? arr(project.deliveryStatuses) : project.deliveryStatus ? [project.deliveryStatus] : [],
      shortDescriptionAr: project.shortDescriptionAr ?? "", shortDescriptionEn: project.shortDescriptionEn ?? "",
      fullDescriptionAr: project.fullDescriptionAr ?? "", fullDescriptionEn: project.fullDescriptionEn ?? "",
      deliveryInformation: project.deliveryInformation ?? "", officialWebsite: project.officialWebsite ?? "",
      amenityIds: arr(project.amenities).map((row) => row.amenityId), competitorIds: arr(project.competitorsFrom).map((row) => row.competitorProject?.id).filter(Boolean) as string[],
    };
  }

  function geoJsonPoints(value: any) {
    const ring = value?.type === "Polygon" ? value.coordinates?.[0] : null;
    if (!Array.isArray(ring)) return [];
    const points = ring.map((pair: any) => ({ lat: Number(pair?.[1]), lng: Number(pair?.[0]) })).filter((point: any) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
    if (points.length > 1 && points[0].lat === points[points.length - 1].lat && points[0].lng === points[points.length - 1].lng) points.pop();
    return points;
  }

  function readinessLabel(value: string) {
    if (value === "canonical identity") return "اسم المشروع";
    if (value === "location") return "موقع المشروع";
    if (value === "coordinates") return "حدود أو إحداثيات المشروع";
    if (value === "short description") return "الوصف المختصر";
    if (value === "project type") return "نوع المشروع";
    if (value === "at least one phase") return "مرحلة واحدة على الأقل";
    if (value === "project default payment plan") return "خطة سداد افتراضية للمشروع";
    if (value === "verified amenities") return "خدمات ومرافق موثقة";
    if (value === "at least 3 project images") return "3 صور للمشروع على الأقل";
    const units = value.match(/^assign (\d+) active units? to a phase$/);
    if (units) return `ربط ${units[1]} وحدة نشطة بمرحلة`;
    return value;
  }

  function readinessMessage(value: Readiness) {
    return arr(value.missing).map(readinessLabel).join(" · ");
  }

  async function load(projectId = id, preserveDraft = false) {
    if (!projectId) return;
    try {
      setLoading(true); setError("");
      const [project, amenityRows, projectRows, ready] = await Promise.all([
        adminApi.get<Project>(`/real-estate/projects/${projectId}`),
        adminApi.get<Amenity[]>("/real-estate/amenities"),
        adminApi.get<ProjectRef[]>("/catalog/projects"),
        adminApi.get<Readiness>(`/real-estate/projects/${projectId}/readiness`),
      ]);
      setItem(project); setAmenities(arr(amenityRows)); setProjects(arr(projectRows)); setReadiness(ready);
      setSelectedPhaseId((current) => current && arr(project.phases).some((phase) => phase.id === current) ? current : project.phases?.[0]?.id ?? "");
      const serverBoundary = geoJsonPoints(project.boundaryGeoJson);
      const localBoundary = typeof window !== "undefined" ? localStorage.getItem(`cgai-boundary-draft:${projectId}`) : null;
      if (localBoundary) { try { setBoundary(JSON.parse(localBoundary)); setDirty(true); } catch { setBoundary(serverBoundary); } } else setBoundary(serverBoundary);
      if (!preserveDraft) {
        const serverDraft = toDraft(project);
        const local = typeof window !== "undefined" ? localStorage.getItem(`cgai-project-draft:${projectId}`) : null;
        if (local) {
          try { setDraft({ ...serverDraft, ...JSON.parse(local) }); setDirty(true); } catch { setDraft(serverDraft); }
        } else setDraft(serverDraft);
      }
    } catch (err) { setError(adminErrorMessage(err)); } finally { setLoading(false); }
  }

  useEffect(() => {
    if (!id || !draft || !dirty) return;
    const timer = window.setTimeout(() => {
      localStorage.setItem(`cgai-project-draft:${id}`, JSON.stringify(draft));
      setAutosaveAt(new Date());
    }, 450);
    return () => window.clearTimeout(timer);
  }, [id, draft, dirty]);

  function updateDraft(patch: Partial<BaseDraft>) { setDraft((current) => current ? { ...current, ...patch } : current); setDirty(true); }

  async function persistBase(status?: "DRAFT" | "READY_FOR_CUSTOMER") {
    if (!draft || !id) return;
    let draftSaved = false;
    try {
      setBusy(true);
      setError("");
      const boundaryDraftKey = `cgai-boundary-draft:${id}`;
      const hasBoundaryDraft = localStorage.getItem(boundaryDraftKey) !== null;
      if (hasBoundaryDraft && boundary.length > 0 && boundary.length < 3) {
        throw new Error("حدود المشروع تحتاج 3 نقاط على الأقل، أو امسحها بالكامل ثم احفظ.");
      }

      await adminApi.patch(`/real-estate/projects/${id}`, {
        canonicalName: draft.canonicalName || undefined,
        nameAr: draft.nameAr || undefined,
        nameEn: draft.nameEn || undefined,
        launchYear: draft.launchYear ? Number(draft.launchYear) : undefined,
        projectStatus: draft.projectStatus || undefined,
        projectTypes: draft.projectTypes,
        deliveryStatuses: draft.deliveryStatuses,
        shortDescriptionAr: draft.shortDescriptionAr || undefined,
        shortDescriptionEn: draft.shortDescriptionEn || undefined,
        fullDescriptionAr: draft.fullDescriptionAr || undefined,
        fullDescriptionEn: draft.fullDescriptionEn || undefined,
        deliveryInformation: draft.deliveryInformation || undefined,
        officialWebsite: draft.officialWebsite || undefined,
      });

      const phaseWrites = arr(item?.phases).flatMap((phase) => {
        const raw = localStorage.getItem(phaseDraftKey(phase.id));
        if (!raw) return [];
        try {
          return [adminApi.patch(`/real-estate/phases/${phase.id}`, phasePayload(JSON.parse(raw), phase.name))];
        } catch {
          return [];
        }
      });

      const marketEntries: Array<{ key: string; value: Record<string, unknown> }> = [];
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (!key?.startsWith(marketDraftPrefix(id))) continue;
        try {
          marketEntries.push({ key, value: JSON.parse(localStorage.getItem(key) || "{}") });
        } catch {
          // Ignore malformed local draft; valid server data remains untouched.
        }
      }

      await Promise.all([
        adminApi.patch(`/real-estate/projects/${id}/amenities`, { amenityIds: draft.amenityIds }),
        adminApi.patch(`/real-estate/projects/${id}/competitors`, { projectIds: draft.competitorIds }),
        ...(hasBoundaryDraft && boundary.length >= 3
          ? [adminApi.patch(`/real-estate/projects/${id}/boundary`, { points: boundary, source: "MAP_DRAWN" })]
          : []),
        ...(hasBoundaryDraft && boundary.length === 0
          ? [adminApi.delete(`/real-estate/projects/${id}/boundary`)]
          : []),
        ...phaseWrites,
        ...marketEntries.map((entry) => adminApi.post(`/real-estate/projects/${id}/market-profiles`, entry.value)),
      ]);

      // At this point all edits are already committed. Clear the local drafts before trying
      // to publish, so a readiness rejection can never make the admin repeat successful writes.
      draftSaved = true;
      localStorage.removeItem(`cgai-project-draft:${id}`);
      localStorage.removeItem(boundaryDraftKey);
      arr(item?.phases).forEach((phase) => localStorage.removeItem(phaseDraftKey(phase.id)));
      marketEntries.forEach((entry) => localStorage.removeItem(entry.key));
      setDirty(false);
      setAutosaveAt(new Date());

      const latestReadiness = await adminApi.get<Readiness>(`/real-estate/projects/${id}/readiness`);
      setReadiness(latestReadiness);

      if (status === "READY_FOR_CUSTOMER") {
        if (!latestReadiness.ready) {
          const missing = readinessMessage(latestReadiness);
          setError(`تم حفظ كل التغييرات كمسودة، لكن لم يتم النشر لأن البيانات الناقصة هي: ${missing || "متطلبات النشر غير مكتملة"}.`);
          await load(id, false);
          return;
        }
        await adminApi.patch(`/real-estate/projects/${id}`, { adminStatus: "READY_FOR_CUSTOMER" });
      } else if (status === "DRAFT") {
        await adminApi.patch(`/real-estate/projects/${id}`, { adminStatus: "DRAFT" });
      }

      await load(id, false);
    } catch (err) {
      const message = adminErrorMessage(err);
      if (draftSaved) {
        setDirty(false);
        setError(`تم حفظ التغييرات بالفعل، لكن خطوة النشر/التحقق لم تكتمل: ${message}`);
        await load(id, false).catch(() => undefined);
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  const selectedPaymentPhase = paymentScope === "PROJECT" ? null : arr(item?.phases).find((phase) => phase.id === paymentScope) ?? null;

  const amenityOptions: SmartOption[] = amenities.map((amenity) => ({ id: amenity.id, label: amenity.nameAr || amenity.nameEn || amenity.canonicalName, secondary: amenity.nameEn || amenity.canonicalName, category: amenity.category }));
  const competitorOptions: SmartOption[] = projects.filter((project) => project.id !== id).map((project) => ({ id: project.id, label: project.nameAr || project.nameEn || project.name, secondary: project.developer?.name ?? undefined }));

  const tabs: Array<[Tab, string, ReactNode]> = [
    ["overview", "نظرة عامة", <PanelTop size={15} key="o" />], ["phases", "المراحل", <Layers3 size={15} key="p" />], ["market", "السوق", <CircleDollarSign size={15} key="m" />], ["media", "الميديا", <ImageIcon size={15} key="i" />], ["payments", "السداد", <FileText size={15} key="pay" />], ["location", "النطاق", <MapPinned size={15} key="l" />], ["masterplan", "Master Plan", <Building2 size={15} key="mp" />], ["knowledge", "المعرفة", <BookOpenCheck size={15} key="k" />],
  ];

  if (loading && !item) return <main className="grid min-h-[70vh] place-items-center p-6" dir="rtl"><div className="rounded-2xl border bg-white px-6 py-4 font-bold">جارٍ تحميل المشروع…</div></main>;
  if (!item || !draft) return <main className="p-6" dir="rtl"><p className="rounded-2xl bg-red-50 p-4 text-red-700">{error || "تعذر تحميل المشروع."}</p></main>;

  return (
    <main className="min-h-screen bg-[#f7f6f1] pb-12" dir="rtl">
      <header className="sticky top-0 z-40 border-b border-[#dde2de] bg-[#f7f6f1]/95 backdrop-blur-xl">
        <div className="mx-auto max-w-[1500px] px-3 py-3 sm:px-5 lg:px-7">
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/admin/projects" className="grid h-10 w-10 place-items-center rounded-xl border bg-white text-[#173f3b]"><ArrowRight size={17} /></Link>
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h1 className="truncate text-lg font-black sm:text-xl">{projectName(item)}</h1><span className={`rounded-full px-2 py-1 text-[10px] font-black ${item.adminStatus === "READY_FOR_CUSTOMER" ? "bg-[#dfeee6] text-[#1e6a51]" : "bg-[#eee8dd] text-[#7b6239]"}`}>{item.adminStatus === "READY_FOR_CUSTOMER" ? "منشور" : "مسودة"}</span></div><p className="truncate text-xs text-[#74817b]">{item.developer?.nameAr || item.developer?.nameEn || item.developer?.name || "مطور غير محدد"} · {dirty ? "تعديلات محلية غير منشورة" : autosaveAt ? `آخر تحديث ${autosaveAt.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}` : "متزامن"}</p></div>
            <Link href={`/admin/inventory?projectId=${id}`} className="hidden h-10 items-center rounded-xl border bg-white px-4 text-sm font-black sm:flex">المخزون {item._count?.units ?? 0}</Link>
            <button type="button" disabled={busy} onClick={() => void persistBase()} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#173f3b] bg-white px-4 text-sm font-black text-[#173f3b] disabled:opacity-40"><Save size={14} />حفظ</button>
            <button type="button" disabled={busy} onClick={() => void persistBase("READY_FOR_CUSTOMER")} className="h-10 rounded-xl bg-[#173f3b] px-4 text-sm font-black text-white disabled:opacity-40">نشر</button>
          </div>
          <nav className="mt-3 flex gap-1 overflow-x-auto rounded-2xl bg-[#eeefea] p-1.5">
            {tabs.map(([value, label, icon]) => <button key={value} type="button" onClick={() => setTab(value)} className={tabButton(tab === value)}><span className="inline-flex items-center gap-2">{icon}{label}</span></button>)}
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] space-y-4 px-3 py-5 sm:px-5 lg:px-7">
        {error ? <div className="flex items-start justify-between gap-3 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700"><span>{error}</span><button onClick={() => setError("")}>×</button></div> : null}

        {tab === "overview" ? <OverviewTab draft={draft} updateDraft={updateDraft} amenityOptions={amenityOptions} competitorOptions={competitorOptions} onCreateAmenity={async (value) => {
          const canonicalName = value.nameEn?.trim() || value.nameAr.trim();
          const created = await adminApi.post<Amenity>("/real-estate/amenities", { canonicalName, nameAr: value.nameAr, nameEn: value.nameEn, category: value.category });
          setAmenities((current) => [...current.filter((item) => item.id !== created.id), created]);
          return { id: created.id, label: created.nameAr || created.nameEn || created.canonicalName, secondary: created.nameEn || created.canonicalName, category: created.category };
        }} readiness={readiness} dirty={dirty} /> : null}

        {tab === "phases" ? <PhasesTab projectId={id} phases={arr(item.phases)} selectedPhaseId={selectedPhaseId} setSelectedPhaseId={setSelectedPhaseId} onChanged={() => load(id, true)} onLocalChange={() => { setDirty(true); setAutosaveAt(new Date()); }} /> : null}

        {tab === "market" ? <MarketTab projectId={id} phases={arr(item.phases)} profiles={arr(item.marketProfiles)} scope={marketScope} setScope={setMarketScope} segment={marketSegment} setSegment={setMarketSegment} propertyUse={marketUse} setPropertyUse={setMarketUse} onLocalChange={() => { setDirty(true); setAutosaveAt(new Date()); }} /> : null}

        {tab === "media" ? <MediaTab projectId={id} phases={arr(item.phases)} media={arr(item.media)} documents={arr(item.documents)} scope={mediaScope} setScope={setMediaScope} onChanged={() => load(id, true)} /> : null}

        {tab === "payments" ? <div className="space-y-4"><div className="rounded-[26px] border bg-white p-4 sm:p-5"><SectionTitle eyebrow="Scope" title="حدد مستوى خطة السداد" description="الخطة على المشروع تعتبر Default. لو المرحلة مختلفة اختارها وأنشئ خطتها؛ الوحدات ترث خطة المرحلة ما لم يكن لها Override." /><select value={paymentScope} onChange={(event) => setPaymentScope(event.target.value)} className="mt-4 h-12 w-full max-w-md rounded-2xl border bg-white px-3"><option value="PROJECT">المشروع — Default</option>{arr(item.phases).map((phase) => <option key={phase.id} value={phase.id}>{phaseName(phase)}</option>)}</select></div><PaymentPlanDesigner projectId={id} phaseId={selectedPaymentPhase?.id} plans={selectedPaymentPhase ? arr(selectedPaymentPhase.paymentPlans) : arr(item.paymentPlans).filter((plan) => !plan.phaseId)} onChanged={() => load(id, true)} /></div> : null}

        {tab === "location" ? <LocationTab project={item} boundary={boundary} setBoundary={(next) => { setBoundary(next); localStorage.setItem(`cgai-boundary-draft:${id}`, JSON.stringify(next)); setDirty(true); setAutosaveAt(new Date()); }} /> : null}

        {tab === "masterplan" ? <ProjectSpatialEditor projectId={id} phases={arr(item.phases)} buildings={arr(item.buildings)} gates={arr(item.gates)} media={arr(item.media)} onChanged={() => load(id, true)} /> : null}

        {tab === "knowledge" ? <KnowledgeTab project={item} /> : null}
      </div>
    </main>
  );
}

function OverviewTab({ draft, updateDraft, amenityOptions, competitorOptions, onCreateAmenity, readiness, dirty }: { draft: BaseDraft; updateDraft: (patch: Partial<BaseDraft>) => void; amenityOptions: SmartOption[]; competitorOptions: SmartOption[]; onCreateAmenity: (value: { nameAr: string; nameEn?: string; category?: string }) => Promise<SmartOption>; readiness: Readiness | null; dirty: boolean }) {
  const [lang, setLang] = useState<"AR" | "EN">("AR");
  return <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
    <div className="space-y-4">
      <section className="rounded-[28px] border border-[#dfe4e0] bg-white p-4 sm:p-6"><SectionTitle eyebrow="Identity" title="البيانات الأساسية" description="المعلومات العامة للمشروع فقط. التواريخ والتشطيب ونطاق الوحدات التي تختلف بين المراحل تُسجل داخل كل مرحلة." />
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field label="الاسم العربي"><input value={draft.nameAr} onChange={(event) => updateDraft({ nameAr: event.target.value })} className="h-12 w-full rounded-2xl border px-3 font-normal" /></Field>
          <Field label="الاسم الإنجليزي"><input value={draft.nameEn} onChange={(event) => updateDraft({ nameEn: event.target.value })} dir="ltr" className="h-12 w-full rounded-2xl border px-3 font-normal" /></Field>
          <Field label="الاسم القياسي"><input value={draft.canonicalName} onChange={(event) => updateDraft({ canonicalName: event.target.value })} className="h-12 w-full rounded-2xl border px-3 font-normal" /></Field>
          <Field label="سنة الإطلاق"><select value={draft.launchYear} onChange={(event) => updateDraft({ launchYear: event.target.value })} className="h-12 w-full rounded-2xl border bg-white px-3 font-normal"><option value="">غير محدد</option>{YEARS.map((year) => <option key={year} value={year}>{year}</option>)}</select></Field>
          <Field label="حالة المشروع"><select value={draft.projectStatus} onChange={(event) => updateDraft({ projectStatus: event.target.value })} className="h-12 w-full rounded-2xl border bg-white px-3 font-normal"><option value="">غير محدد</option>{PROJECT_STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
          <Field label="الموقع الرسمي"><input value={draft.officialWebsite} onChange={(event) => updateDraft({ officialWebsite: event.target.value })} dir="ltr" placeholder="https://" className="h-12 w-full rounded-2xl border px-3 font-normal" /></Field>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2"><MultiSelectPicker label="نوع المشروع" options={PROJECT_TYPES} value={draft.projectTypes} onChange={(value) => updateDraft({ projectTypes: value })} /><MultiSelectPicker label="حالات التسليم الموجودة بالمشروع" options={DELIVERY_STATUSES} value={draft.deliveryStatuses} onChange={(value) => updateDraft({ deliveryStatuses: value })} /></div>
      </section>

      <section className="rounded-[28px] border border-[#dfe4e0] bg-white p-4 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><SectionTitle eyebrow="Narrative" title="الوصف ووعد التسليم" description="بدل مربعات النص المتراصة: اكتب قصة المشروع والوعد التسليمي لكل لغة بشكل واضح. تفاصيل كل مرحلة لها مكان منفصل." /><div className="flex rounded-xl bg-[#f1f2ed] p-1"><button type="button" onClick={() => setLang("AR")} className={`rounded-lg px-3 py-2 text-xs font-black ${lang === "AR" ? "bg-white shadow" : ""}`}>العربية</button><button type="button" onClick={() => setLang("EN")} className={`rounded-lg px-3 py-2 text-xs font-black ${lang === "EN" ? "bg-white shadow" : ""}`}>English</button></div></div>
        {lang === "AR" ? <div className="mt-5 grid gap-4 lg:grid-cols-2"><div className="rounded-2xl bg-[#faf9f5] p-4"><b>تعريف سريع</b><textarea value={draft.shortDescriptionAr} onChange={(event) => updateDraft({ shortDescriptionAr: event.target.value })} placeholder="جملة أو فقرتين تعرّف العميل بالمشروع…" className="mt-3 min-h-28 w-full resize-y rounded-2xl border bg-white p-3 font-normal leading-7" /></div><div className="rounded-2xl bg-[#faf9f5] p-4"><b>القصة الكاملة</b><textarea value={draft.fullDescriptionAr} onChange={(event) => updateDraft({ fullDescriptionAr: event.target.value })} placeholder="المفهوم، التخطيط، تجربة المعيشة…" className="mt-3 min-h-28 w-full resize-y rounded-2xl border bg-white p-3 font-normal leading-7" /></div></div> : <div className="mt-5 grid gap-4 lg:grid-cols-2" dir="ltr"><div className="rounded-2xl bg-[#faf9f5] p-4"><b>Short story</b><textarea value={draft.shortDescriptionEn} onChange={(event) => updateDraft({ shortDescriptionEn: event.target.value })} className="mt-3 min-h-28 w-full rounded-2xl border bg-white p-3 font-normal leading-7" /></div><div className="rounded-2xl bg-[#faf9f5] p-4"><b>Full story</b><textarea value={draft.fullDescriptionEn} onChange={(event) => updateDraft({ fullDescriptionEn: event.target.value })} className="mt-3 min-h-28 w-full rounded-2xl border bg-white p-3 font-normal leading-7" /></div></div>}
        <div className="mt-4 rounded-2xl border border-[#e2e6e3] p-4"><b>وعد التسليم العام</b><p className="mt-1 text-xs leading-6 text-[#74817b]">اكتب السياسة العامة فقط؛ سنة وحالة تسليم كل Phase تُحدد داخل المرحلة.</p><textarea value={draft.deliveryInformation} onChange={(event) => updateDraft({ deliveryInformation: event.target.value })} className="mt-3 min-h-24 w-full rounded-2xl border p-3 font-normal leading-7" /></div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2"><div className="rounded-[28px] border border-[#dfe4e0] bg-white p-4 sm:p-5"><SectionTitle eyebrow="System library" title="الخدمات والمرافق" description="ابدأ الكتابة واختار من المكتبة. لو العنصر جديد تقدر تضيفه للنظام مرة واحدة." /><div className="mt-4"><SmartTagPicker options={amenityOptions} value={draft.amenityIds} onChange={(value) => updateDraft({ amenityIds: value })} onCreate={onCreateAmenity} placeholder="مثال: جيم، حمام سباحة…" createLabel="إضافة مرفق جديد" /></div></div><div className="rounded-[28px] border border-[#dfe4e0] bg-white p-4 sm:p-5"><SectionTitle eyebrow="Competitive set" title="المشروعات المنافسة" description="اختار مشاريع موجودة بالنظام. Cg Ai هيستخدم المجموعة دي تلقائيًا عند طلب مقارنة المشروع." /><div className="mt-4"><SmartTagPicker options={competitorOptions} value={draft.competitorIds} onChange={(value) => updateDraft({ competitorIds: value })} placeholder="ابحث باسم المشروع أو المطور…" emptyLabel="المشروع المنافس غير مسجل بعد" /></div></div></section>
    </div>
    <aside className="space-y-4"><section className="rounded-[26px] border bg-[#14211f] p-5 text-white"><p className="text-[10px] font-black uppercase tracking-[.2em] text-[#d6ba80]">Customer readiness</p><div className="mt-2 flex items-end justify-between"><b className="text-2xl">{dirty ? "بانتظار الحفظ" : readiness?.ready ? "جاهز" : "يحتاج مراجعة"}</b><span className="text-xs opacity-70">{readiness?.imageCount ?? 0} صور</span></div><div className="mt-4 space-y-2">{arr(readiness?.missing).slice(0, 8).map((entry) => <div key={entry} className="flex items-start gap-2 rounded-xl bg-white/7 px-3 py-2 text-xs"><span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-[#d6ba80]" /><span>{entry}</span></div>)}{dirty ? <div className="rounded-xl bg-white/7 px-3 py-2 text-xs leading-5">الجاهزية المعروضة تخص آخر نسخة محفوظة. اضغط حفظ أو نشر لإعادة فحصها بعد تثبيت المسودة الحالية.</div> : readiness?.ready ? <div className="flex items-center gap-2 text-sm"><Check size={15} />كل متطلبات النشر الأساسية مكتملة.</div> : null}{arr(readiness?.warnings).map((entry) => <div key={entry} className="rounded-xl border border-[#d6ba80]/30 bg-[#d6ba80]/10 px-3 py-2 text-xs leading-5 text-[#f2dfb3]">{entry}</div>)}</div></section><section className="rounded-[26px] border bg-white p-5"><b>مبدأ البيانات الجديد</b><div className="mt-3 space-y-2 text-sm"><div className="rounded-xl bg-[#f5f4ef] p-3">Project <span className="text-[#74817b]">→ Defaults</span></div><div className="rounded-xl bg-[#edf3f0] p-3 font-bold text-[#17483e]">Phase <span className="font-normal">→ Override</span></div><div className="rounded-xl bg-[#f5f4ef] p-3">Building → Unit</div></div></section></aside>
  </div>;
}

function PhasesTab({ projectId, phases, selectedPhaseId, setSelectedPhaseId, onChanged, onLocalChange }: { projectId: string; phases: Phase[]; selectedPhaseId: string; setSelectedPhaseId: (value: string) => void; onChanged: () => Promise<void> | void; onLocalChange: () => void }) {
  const selected = phases.find((phase) => phase.id === selectedPhaseId) ?? phases[0] ?? null;
  const [newName, setNewName] = useState("");
  const [phaseDraft, setPhaseDraft] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!selected) return;
    const base = { ...selected, projectTypes: arr(selected.projectTypes), deliveryStatuses: arr(selected.deliveryStatuses), unitTypes: arr(selected.unitTypes), finishingOptions: arr(selected.finishingOptions), customerFit: arr(selected.customerFit) };
    const local = localStorage.getItem(phaseDraftKey(selected.id));
    if (local) { try { setPhaseDraft({ ...base, ...JSON.parse(local) }); return; } catch { /* use server */ } }
    setPhaseDraft(base);
  }, [selected?.id, selected?.updatedAt]);
  const set = (patch: Record<string, any>) => setPhaseDraft((current) => {
    const next = { ...current, ...patch };
    if (selected) localStorage.setItem(phaseDraftKey(selected.id), JSON.stringify(next));
    onLocalChange();
    return next;
  });
  async function create() { if (!newName.trim()) return; try { setBusy(true); const created = await adminApi.post<Phase>(`/real-estate/projects/${projectId}/phases`, { name: newName.trim(), nameAr: newName.trim() }); setNewName(""); setSelectedPhaseId(created.id); await onChanged(); } catch (err) { setError(adminErrorMessage(err)); } finally { setBusy(false); } }
  async function backfill() { try { setBusy(true); setError(""); setNotice(""); const result = await adminApi.post<{ assigned:number; unmatched:number }>(`/real-estate/projects/${projectId}/phases/backfill`, {}); setNotice(result.unmatched ? `تم ربط ${result.assigned} وحدة، وباقي ${result.unmatched} وحدة تحتاج تحديد مرحلة يدويًا.` : `تم ربط ${result.assigned} وحدة قديمة بالمراحل.`); await onChanged(); } catch (err) { setError(adminErrorMessage(err)); } finally { setBusy(false); } }
  return <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]"><aside className="rounded-[28px] border bg-white p-4"><SectionTitle eyebrow="Structure" title="مراحل المشروع" description="كل مرحلة لها تسليم، وحدات وتشطيب مستقل." /><div className="mt-4 flex gap-2"><input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="اسم مرحلة جديدة" className="h-11 min-w-0 flex-1 rounded-xl border px-3" /><button type="button" disabled={busy || !newName.trim()} onClick={() => void create()} className="grid h-11 w-11 place-items-center rounded-xl bg-[#173f3b] text-white disabled:opacity-30"><Plus size={16} /></button></div><div className="mt-4 space-y-2">{phases.map((phase, index) => <button key={phase.id} type="button" onClick={() => setSelectedPhaseId(phase.id)} className={`w-full rounded-2xl border p-3 text-right ${selected?.id === phase.id ? "border-[#56776e] bg-[#edf3f0]" : "bg-white"}`}><div className="flex items-center justify-between gap-2"><b>{phaseName(phase)}</b><span className="text-xs text-[#74817b]">#{index + 1}</span></div><div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-[#74817b]"><span className="rounded-full bg-white px-2 py-1">{phase.deliveryYear || "—"} تسليم</span><span className="rounded-full bg-white px-2 py-1">{phase._count?.units ?? 0} وحدة</span><span className="rounded-full bg-white px-2 py-1">{phase._count?.buildings ?? 0} مبنى</span></div></button>)}</div><button type="button" disabled={busy || !phases.length} onClick={() => void backfill()} className="mt-4 h-10 w-full rounded-xl border border-dashed text-xs font-black text-[#17483e] disabled:opacity-40">مطابقة الوحدات القديمة بالمراحل</button></aside>
    <section className="rounded-[28px] border bg-white p-4 sm:p-6">{!selected ? <div className="grid min-h-80 place-items-center text-center"><div><Layers3 className="mx-auto text-[#b08c52]" /><h3 className="mt-3 font-black">أضف أول مرحلة</h3><p className="mt-1 text-sm text-[#74817b]">الوحدات والتسليم والتشطيب هتتحرك تحت المرحلة بدل المشروع.</p></div></div> : <div><div className="flex flex-wrap items-start justify-between gap-3"><SectionTitle eyebrow="Phase override" title={phaseName(selected)} description="القيم هنا تتغلب على Defaults المشروع لهذه المرحلة فقط." /><span className="rounded-full bg-[#edf3f0] px-3 py-2 text-xs font-black text-[#17483e]">يحفظ محليًا · ثبّت من زر حفظ بالأعلى</span></div>
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4"><Field label="الاسم"><input value={phaseDraft.name ?? ""} onChange={(event) => set({ name: event.target.value })} className="h-12 w-full rounded-2xl border px-3 font-normal" /></Field><Field label="الكود"><input value={phaseDraft.code ?? ""} onChange={(event) => set({ code: event.target.value })} dir="ltr" className="h-12 w-full rounded-2xl border px-3 font-normal" /></Field><Field label="سنة الإطلاق"><select value={phaseDraft.launchYear ?? ""} onChange={(event) => set({ launchYear: event.target.value })} className="h-12 w-full rounded-2xl border bg-white px-3 font-normal"><option value="">—</option>{YEARS.map((year) => <option key={year}>{year}</option>)}</select></Field><Field label="سنة التسليم"><select value={phaseDraft.deliveryYear ?? ""} onChange={(event) => set({ deliveryYear: event.target.value })} className="h-12 w-full rounded-2xl border bg-white px-3 font-normal"><option value="">—</option>{YEARS.map((year) => <option key={year}>{year}</option>)}</select></Field><Field label="حالة المرحلة"><select value={phaseDraft.status ?? ""} onChange={(event) => set({ status: event.target.value })} className="h-12 w-full rounded-2xl border bg-white px-3 font-normal"><option value="">—</option>{PROJECT_STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="نسبة التنفيذ"><select value={phaseDraft.constructionPercentage ?? ""} onChange={(event) => set({ constructionPercentage: event.target.value })} className="h-12 w-full rounded-2xl border bg-white px-3 font-normal"><option value="">—</option>{Array.from({ length: 21 }, (_, i) => i * 5).map((value) => <option key={value} value={value}>{value}%</option>)}</select></Field><Field label="أقل غرف"><select value={phaseDraft.minBedrooms ?? ""} onChange={(event) => set({ minBedrooms: event.target.value })} className="h-12 w-full rounded-2xl border bg-white px-3 font-normal"><option value="">—</option>{Array.from({ length: 11 }, (_, i) => i).map((value) => <option key={value}>{value}</option>)}</select></Field><Field label="أكثر غرف"><select value={phaseDraft.maxBedrooms ?? ""} onChange={(event) => set({ maxBedrooms: event.target.value })} className="h-12 w-full rounded-2xl border bg-white px-3 font-normal"><option value="">—</option>{Array.from({ length: 11 }, (_, i) => i).map((value) => <option key={value}>{value}</option>)}</select></Field></div>
      <div className="mt-4 grid gap-4 md:grid-cols-2"><MultiSelectPicker label="نوع الاستخدام" options={PROJECT_TYPES} value={arr(phaseDraft.projectTypes)} onChange={(value) => set({ projectTypes: value })} /><MultiSelectPicker label="حالة التسليم" options={DELIVERY_STATUSES} value={arr(phaseDraft.deliveryStatuses)} onChange={(value) => set({ deliveryStatuses: value })} /><MultiSelectPicker label="أنواع الوحدات" options={UNIT_TYPES} value={arr(phaseDraft.unitTypes)} onChange={(value) => set({ unitTypes: value })} /><MultiSelectPicker label="خيارات التشطيب" options={FINISHING} value={arr(phaseDraft.finishingOptions)} onChange={(value) => set({ finishingOptions: value })} /><MultiSelectPicker label="ملائمة العملاء" options={CUSTOMER_FIT} value={arr(phaseDraft.customerFit)} onChange={(value) => set({ customerFit: value })} /><div className="grid grid-cols-2 gap-2"><Field label="أقل مساحة"><input value={phaseDraft.minArea ?? ""} onChange={(event) => set({ minArea: event.target.value })} type="number" className="h-12 w-full rounded-2xl border px-3 font-normal" /></Field><Field label="أكبر مساحة"><input value={phaseDraft.maxArea ?? ""} onChange={(event) => set({ maxArea: event.target.value })} type="number" className="h-12 w-full rounded-2xl border px-3 font-normal" /></Field></div></div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2"><div className="rounded-2xl bg-[#faf9f5] p-4"><b>وصف المرحلة</b><textarea value={phaseDraft.descriptionAr ?? ""} onChange={(event) => set({ descriptionAr: event.target.value })} placeholder="ما الذي يميز هذه المرحلة؟" className="mt-3 min-h-28 w-full rounded-2xl border bg-white p-3" /></div><div className="rounded-2xl bg-[#faf9f5] p-4"><b>وعد التسليم للمرحلة</b><textarea value={phaseDraft.deliveryNotesAr ?? ""} onChange={(event) => set({ deliveryNotesAr: event.target.value })} placeholder="حالة التسليم، ملاحظات خاصة، اختلافها عن باقي المشروع…" className="mt-3 min-h-28 w-full rounded-2xl border bg-white p-3" /></div></div>{notice ? <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p> : null}{error ? <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}</div>}</section></div>;
}

function MarketTab({ projectId, phases, profiles, scope, setScope, segment, setSegment, propertyUse, setPropertyUse, onLocalChange }: { projectId: string; phases: Phase[]; profiles: MarketProfile[]; scope: string; setScope: (value: string) => void; segment: string; setSegment: (value: string) => void; propertyUse: string; setPropertyUse: (value: string) => void; onLocalChange: () => void }) {
  const phaseId = scope === "PROJECT" ? null : scope;
  const existing = profiles.find((profile) => (profile.phaseId ?? null) === phaseId && profile.segment === segment && profile.propertyUse === propertyUse);
  type MarketDraft = { suitability:string; demand:string; liquidity:string; yieldMin:string; yieldMax:string; targetCustomers:string; advantages:string; risks:string; notes:string };
  const [draft,setDraft]=useState<MarketDraft>({suitability:"",demand:"",liquidity:"",yieldMin:"",yieldMax:"",targetCustomers:"",advantages:"",risks:"",notes:""});
  const key=marketDraftKey(projectId,phaseId,segment,propertyUse);
  useEffect(()=>{
    const local=localStorage.getItem(key);
    if(local){try{const value=JSON.parse(local);setDraft({suitability:value.suitability||"",demand:value.demand||"",liquidity:value.liquidity||"",yieldMin:value.yieldMin==null?"":String(value.yieldMin),yieldMax:value.yieldMax==null?"":String(value.yieldMax),targetCustomers:arr(value.targetCustomers).join("، "),advantages:arr(value.advantages).join("، "),risks:arr(value.risks).join("، "),notes:value.notes||""});return}catch{/* server fallback */}}
    setDraft({suitability:existing?.suitability??"",demand:existing?.demand??"",liquidity:existing?.liquidity??"",yieldMin:existing?.yieldMin==null?"":String(existing.yieldMin),yieldMax:existing?.yieldMax==null?"":String(existing.yieldMax),targetCustomers:arr(existing?.targetCustomers).join("، "),advantages:arr(existing?.advantages).join("، "),risks:arr(existing?.risks).join("، "),notes:existing?.notes??""});
  },[key,existing?.id,existing?.updatedAt]);
  const csv=(value:string)=>value.split(/[،,\n]/).map((entry)=>entry.trim()).filter(Boolean);
  function set(patch:Partial<MarketDraft>){setDraft((current)=>{const next={...current,...patch};localStorage.setItem(key,JSON.stringify({phaseId:phaseId||undefined,segment,propertyUse,suitability:next.suitability||undefined,demand:next.demand||undefined,liquidity:next.liquidity||undefined,yieldMin:next.yieldMin===""?undefined:Number(next.yieldMin),yieldMax:next.yieldMax===""?undefined:Number(next.yieldMax),targetCustomers:csv(next.targetCustomers),advantages:csv(next.advantages),risks:csv(next.risks),notes:next.notes||undefined,source:"ADMIN_VERIFIED"}));onLocalChange();return next})}
  return <div className="space-y-4"><section className="rounded-[28px] border bg-white p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-4"><SectionTitle eyebrow="Market intelligence" title="ملف سوقي متخصص" description="الاستثمار، إعادة البيع والإيجار ملفات منفصلة، وكل تغيير هنا Draft محلي إلى أن تضغط حفظ من أعلى الصفحة." /><div className="flex rounded-2xl bg-[#f1f2ed] p-1">{MARKET_SEGMENTS.map(([value, label]) => <button key={value} type="button" onClick={() => setSegment(value)} className={`rounded-xl px-4 py-2 text-sm font-black ${segment === value ? "bg-[#173f3b] text-white" : ""}`}>{label}</button>)}</div></div><div className="mt-5 grid gap-3 md:grid-cols-2"><Field label="النطاق"><select value={scope} onChange={(event) => setScope(event.target.value)} className="h-12 w-full rounded-2xl border bg-white px-3 font-normal"><option value="PROJECT">المشروع ككل</option>{phases.map((phase) => <option key={phase.id} value={phase.id}>{phaseName(phase)}</option>)}</select></Field><Field label="نوع الأصل"><select value={propertyUse} onChange={(event) => setPropertyUse(event.target.value)} className="h-12 w-full rounded-2xl border bg-white px-3 font-normal">{PROPERTY_USES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field></div></section>
    <section className="rounded-[28px] border bg-white p-4 sm:p-6"><div className="flex justify-end"><span className="rounded-full bg-[#edf3f0] px-3 py-2 text-xs font-black text-[#17483e]">يحفظ محليًا · زر حفظ بالأعلى يثبت التغييرات</span></div><div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3"><Field label={segment === "INVESTMENT" ? "ملائمة الاستثمار" : segment === "RESALE" ? "ملائمة إعادة البيع" : "ملائمة الإيجار"}><select value={draft.suitability} onChange={(event)=>set({suitability:event.target.value})} className="h-12 w-full rounded-2xl border bg-white px-3 font-normal"><option value="">غير محدد</option><option value="LOW">ضعيف</option><option value="MEDIUM">متوسط</option><option value="HIGH">مرتفع</option><option value="PREMIUM">مميز</option></select></Field><Field label="الطلب"><select value={draft.demand} onChange={(event)=>set({demand:event.target.value})} className="h-12 w-full rounded-2xl border bg-white px-3 font-normal"><option value="">غير محدد</option><option value="LOW">ضعيف</option><option value="MEDIUM">متوسط</option><option value="HIGH">مرتفع</option></select></Field><Field label="السيولة / سرعة التخارج"><select value={draft.liquidity} onChange={(event)=>set({liquidity:event.target.value})} className="h-12 w-full rounded-2xl border bg-white px-3 font-normal"><option value="">غير محدد</option><option value="LOW">منخفضة</option><option value="MEDIUM">متوسطة</option><option value="HIGH">مرتفعة</option></select></Field>{segment === "RENTAL" ? <><Field label="أقل عائد %"><input value={draft.yieldMin} onChange={(event)=>set({yieldMin:event.target.value})} type="number" step="0.01" className="h-12 w-full rounded-2xl border px-3 font-normal" /></Field><Field label="أعلى عائد %"><input value={draft.yieldMax} onChange={(event)=>set({yieldMax:event.target.value})} type="number" step="0.01" className="h-12 w-full rounded-2xl border px-3 font-normal" /></Field></> : null}</div><div className="mt-4 grid gap-4 lg:grid-cols-3"><Field label="العملاء الأنسب"><textarea value={draft.targetCustomers} onChange={(event)=>set({targetCustomers:event.target.value})} placeholder="عائلات، مستثمر طويل الأجل…" className="min-h-24 w-full rounded-2xl border p-3 font-normal" /></Field><Field label="نقاط القوة"><textarea value={draft.advantages} onChange={(event)=>set({advantages:event.target.value})} className="min-h-24 w-full rounded-2xl border p-3 font-normal" /></Field><Field label="المخاطر"><textarea value={draft.risks} onChange={(event)=>set({risks:event.target.value})} className="min-h-24 w-full rounded-2xl border p-3 font-normal" /></Field></div><textarea value={draft.notes} onChange={(event)=>set({notes:event.target.value})} placeholder="ملاحظات وتحليل موثق…" className="mt-4 min-h-24 w-full rounded-2xl border p-3" /></section></div>;
}

function MediaTab({ projectId, phases, media, documents, scope, setScope, onChanged }: { projectId: string; phases: Phase[]; media: Media[]; documents: Document[]; scope: string; setScope: (value: string) => void; onChanged: () => Promise<void> | void }) {
  const phaseId = scope === "PROJECT" ? null : scope;
  const images = media.filter((item) => item.type === "IMAGE" && (item.purpose ?? "GALLERY") === "GALLERY" && (item.phaseId ?? null) === phaseId).sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0));
  const brochures = documents.filter((item) => item.type === "BROCHURE" && (item.phaseId ?? null) === phaseId);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function uploadImage(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); form.append("projectId", projectId); form.append("type", "IMAGE"); if (phaseId) form.append("phaseId", phaseId); try { setBusy(true); await adminApi.upload("/catalog/media", form); formElement.reset(); await onChanged(); } catch (err) { setError(adminErrorMessage(err)); } finally { setBusy(false); } }
  async function uploadBrochure(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); form.append("projectId", projectId); form.append("type", "BROCHURE"); if (phaseId) form.append("phaseId", phaseId); try { setBusy(true); await adminApi.upload("/catalog/documents", form); formElement.reset(); await onChanged(); } catch (err) { setError(adminErrorMessage(err)); } finally { setBusy(false); } }
  async function reorder(next: Media[], coverId?: string) { try { setBusy(true); await adminApi.patch(`/catalog/projects/${projectId}/media/order`, { items: next.map((item, index) => ({ id: item.id, sortOrder: index })), coverId }); await onChanged(); } catch (err) { setError(adminErrorMessage(err)); } finally { setBusy(false); } }
  async function makeCover(id: string) { const cover = images.find((item) => item.id === id); if (!cover) return; await reorder([cover, ...images.filter((item) => item.id !== id)], id); }
  async function move(index: number, delta: number) { const target = index + delta; if (target < 0 || target >= images.length) return; const next = [...images]; [next[index], next[target]] = [next[target], next[index]]; await reorder(next, next.find((item) => item.isCover)?.id); }
  return <div className="space-y-4"><section className="rounded-[28px] border bg-white p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-4"><SectionTitle eyebrow="Media scope" title="صور وبرشور حسب المستوى" description="صور المشروع والمرحلة منفصلة. Cover دائمًا رقم 1. Master Plan له Studio مستقل ولا يظهر هنا." /><select value={scope} onChange={(event) => setScope(event.target.value)} className="h-11 min-w-56 rounded-xl border bg-white px-3"><option value="PROJECT">صور المشروع</option>{phases.map((phase) => <option key={phase.id} value={phase.id}>{phaseName(phase)}</option>)}</select></div></section>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]"><section className="rounded-[28px] border bg-white p-4 sm:p-5"><div className="flex items-center justify-between"><h3 className="font-black">معرض الصور</h3><span className="text-xs text-[#74817b]">{images.length} صورة</span></div>{images.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{images.map((image, index) => <article key={image.id} className="overflow-hidden rounded-2xl border bg-[#faf9f5]"><div className="relative aspect-[4/3]"><img src={image.url} alt={image.altTextAr || "صورة المشروع"} className="h-full w-full object-cover" /><span className="absolute start-2 top-2 grid h-8 min-w-8 place-items-center rounded-full bg-black/75 px-2 text-xs font-black text-white">{index + 1}</span>{image.isCover ? <span className="absolute end-2 top-2 rounded-full bg-[#d6ba80] px-2 py-1 text-[10px] font-black">Cover</span> : null}</div><div className="grid grid-cols-4 gap-1 p-2 text-xs"><button type="button" onClick={() => void move(index, -1)} disabled={index === 0 || busy} className="rounded-lg border py-1.5">↑</button><button type="button" onClick={() => void move(index, 1)} disabled={index === images.length - 1 || busy} className="rounded-lg border py-1.5">↓</button><button type="button" onClick={() => void makeCover(image.id)} disabled={busy} className="col-span-2 rounded-lg border py-1.5 font-bold">عيّن Cover</button></div></article>)}</div> : <div className="mt-4 rounded-2xl border border-dashed p-8 text-center text-sm text-[#74817b]">لا توجد صور في هذا المستوى.</div>}<form onSubmit={uploadImage} className="mt-4 flex flex-wrap gap-2 rounded-2xl bg-[#faf9f5] p-3"><input required name="file" type="file" accept="image/*" className="min-w-0 flex-1 rounded-xl border bg-white p-2 text-sm" /><input name="altTextAr" placeholder="وصف الصورة" className="h-10 flex-1 rounded-xl border px-3" /><button disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#173f3b] px-4 text-sm font-black text-white"><CloudUpload size={14} />رفع صورة</button></form></section>
      <section className="rounded-[28px] border bg-white p-4 sm:p-5"><h3 className="font-black">البرشور</h3><p className="mt-1 text-xs leading-6 text-[#74817b]">المستند الوحيد هنا هو Brochure PDF، ويمكن تخصيص برشور لكل مرحلة.</p><div className="mt-4 space-y-2">{brochures.map((doc) => <div key={doc.id} className="flex items-center gap-3 rounded-2xl border p-3"><FileText size={18} className="text-[#b08c52]" /><a href={doc.url} target="_blank" className="min-w-0 flex-1 truncate text-sm font-bold">{doc.name}</a><button type="button" onClick={async () => { await adminApi.delete(`/catalog/documents/${doc.id}`); await onChanged(); }} className="text-red-700"><Trash2 size={15} /></button></div>)}</div><form onSubmit={uploadBrochure} className="mt-4 space-y-2"><input required name="file" type="file" accept="application/pdf" className="w-full rounded-xl border p-2 text-sm" /><input name="language" placeholder="AR / EN — اختياري" className="h-10 w-full rounded-xl border px-3" /><button disabled={busy} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-[#173f3b] text-sm font-black text-[#173f3b]"><UploadCloud size={14} />رفع البرشور</button></form></section></div>
    {phaseId ? <UnitMediaRuleManager projectId={projectId} phaseId={phaseId} phaseName={phaseName(phases.find((phase) => phase.id === phaseId) ?? { name: "المرحلة" } as Phase)} /> : <section className="rounded-[28px] border border-dashed bg-[#faf9f5] p-5 text-center text-sm text-[#74817b]">اختر مرحلة من أعلى لإضافة صور/Floor Plans تُطابق وحداتها حسب الغرف والحمامات ونطاق المساحة.</section>}
    {error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}</div>;
}

function LocationTab({ project, boundary, setBoundary }: { project: Project; boundary: Array<{ lat: number; lng: number }>; setBoundary: (value: Array<{ lat: number; lng: number }>) => void }) {
  const center = project.latitude != null && project.longitude != null ? { lat: Number(project.latitude), lng: Number(project.longitude) } : project.location?.latitude != null && project.location?.longitude != null ? { lat: Number(project.location.latitude), lng: Number(project.location.longitude) } : null;
  return <section className="rounded-[28px] border bg-white p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-4"><SectionTitle eyebrow="Verified geography" title="حدود المشروع على الخريطة" description="ارسم النطاق مباشرة. النظام يحسب مركز المشروع تلقائيًا؛ لا تحتاج كتابة Latitude/Longitude." /><div className="flex items-center gap-2"><span className="rounded-full bg-[#edf3f0] px-3 py-2 text-xs font-black text-[#17483e]">Draft محلي · يحفظ من أعلى الصفحة</span><button type="button" disabled={!boundary.length} onClick={() => setBoundary(boundary.slice(0, -1))} className="h-10 rounded-xl border px-3 text-sm font-bold disabled:opacity-40">تراجع</button></div></div><div className="mt-5"><ProjectBoundaryMap points={boundary} onChange={setBoundary} center={center} /></div><div className="mt-3 rounded-2xl bg-[#f5f4ef] p-3 text-xs leading-6 text-[#74817b]">لو ظهر خطأ “Oops! Something went wrong”، الواجهة هتعرض سبب المصادقة قدر الإمكان. تأكد من Browser Key منفصل، Maps JavaScript API، Billing وHTTP referrer للدومين.</div></section>;
}

function KnowledgeTab({ project }: { project: Project }) {
  return <section className="rounded-[28px] border bg-white p-5 sm:p-8"><div className="grid gap-6 lg:grid-cols-[1fr_300px]"><div><SectionTitle eyebrow="Verified knowledge" title="المعرفة الموثقة للمشروع" description="المستندات الوصفية والحقائق المستخرجة تظل في مركز مستقل حتى لا تتحول صفحة المشروع إلى صفحة طويلة." /><Link href={`/admin/projects/${project.id}/knowledge`} className="mt-5 inline-flex h-11 items-center gap-2 rounded-xl bg-[#173f3b] px-5 text-sm font-black text-white">فتح مركز المعرفة <ChevronLeft size={14} /></Link></div><div className="rounded-[22px] bg-[#14211f] p-5 text-white"><Sparkles className="text-[#d6ba80]" /><b className="mt-3 block text-2xl">{project._count?.knowledgeItems ?? project.knowledgeItems?.length ?? 0}</b><span className="text-sm text-white/70">حقائق معرفة مرتبطة بالمشروع</span><p className="mt-4 text-xs leading-6 text-white/60">Cg Ai يستخدم فقط المعرفة المقبولة والبيانات المنظمة عند صياغة الرد.</p></div></div></section>;
}
