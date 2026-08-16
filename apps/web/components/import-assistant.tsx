"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  FileSpreadsheet,
  Files,
  LayoutDashboard,
  Map,
  Menu,
  MessageSquareText,
  Plus,
  Settings,
  Sparkles,
  UploadCloud,
  Users,
  WandSparkles,
  X,
} from "lucide-react";
import { LogoMark } from "@/components/logo";
import { adminApi, adminErrorMessage } from "@/lib/api";
import { generatePreviewAndRefresh, IMPORT_STEPS, importNextAction, importStepState, type ImportWorkflow } from "@/lib/import-workflow";

type Issue = {
  id: string;
  field?: string;
  message: string;
  severity: "INFO" | "WARNING" | "ERROR" | "BLOCKING";
  resolvedAt?: string | null;
  inputType?: string | null;
  options?: any;
  required?: boolean;
};
type ImportData = {
  id: string;
  fileName: string;
  rowsDetected: number;
  rowsCreated: number;
  rowsUpdated: number;
  rowsRejected: number;
  status: string;
  analysis?: any;
  preview?: any;
  issues: Issue[];
  project?: { id: string; name: string } | null;
  workflow: ImportWorkflow;
  sheets: ImportSheetData[];
};
type ImportSheetData = { id:string; sheetName:string; tableId?:string|null; classification:string; confidence:number; action:"IMPORT"|"IGNORE"; headerRow?:number|null; startRow?:number|null; endRow?:number|null; rowsDetected:number; projectId?:string|null; developerId?:string|null; locationId?:string|null; defaultCurrency?:string|null; defaultUnitType?:string|null; columns?:Array<{key:string;originalHeader:string;samples?:unknown[]}>; mappings?:Record<string,string>; mappingSources?:Record<string,string>; sourcePreview?:Array<Record<string,unknown>>; mappingVersion:number; previewMappingVersion?:number|null; project?:{name:string}|null };
type Location = {
  id: string;
  name: string;
  type: string;
  parent?: { name: string } | null;
};
type SelectorItem = { id: string; name: string; slug?: string; developerId?: string; locationId?: string; developer?: { name: string }; location?: { name: string }; parent?: { name: string }; type?: string };
const nav = [
  [LayoutDashboard, "لوحة التحكم", "/admin"],
  [Map, "المناطق", "/admin/locations"],
  [Building2, "المشروعات", "/admin/projects"],
  [Files, "المخزون", "/admin/inventory"],
  [UploadCloud, "الاستيراد", "/admin/data"],
  [BookOpen, "معرفة المشروعات", "/admin/projects"],
  [MessageSquareText, "المحادثات", "/admin/conversations"],
  [Users, "العملاء المحتملون", "/admin/leads"],
] as const;

export function ImportAssistant() {
  const [drawer, setDrawer] = useState(false);
  const [item, setItem] = useState<ImportData | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectorOptions, setSelectorOptions] = useState<Record<string, SelectorItem[]>>({ projects: [], developers: [], locations: [] });
  const [leadSummary, setLeadSummary] = useState({
    newLeads: 0,
    highIntent: 0,
    followUpsDue: 0,
    thisWeek: 0,
  });
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const importId = new URLSearchParams(location.search).get("import");
    if (importId) adminApi.get<ImportData>(`/imports/${importId}`).then(setItem).catch((e) => setError(adminErrorMessage(e)));
    adminApi
      .get<Location[]>("/locations")
      .then(setLocations)
      .catch((e) => setError(e.message));
    adminApi
      .get<typeof leadSummary>("/leads/summary")
      .then(setLeadSummary)
      .catch(() => undefined);
    for (const type of ["projects", "developers", "locations"])
      adminApi.get<{ items: SelectorItem[] }>(`/imports/options/selectors?type=${type}&pageSize=50`).then((result) => setSelectorOptions((current) => ({ ...current, [type]: result.items }))).catch(() => undefined);
  }, []);
  const issue = useMemo(
    () =>
      item?.issues.find(
        (i) => !i.field?.startsWith("sheet:") && !i.resolvedAt && (i.severity === "BLOCKING" || i.required === true),
      ),
    [item],
  );
  async function upload(file?: File) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setError("The file exceeds the 20 MB upload limit.");
      return;
    }
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      setError("Unsupported file type. Upload an .xlsx, .xls or UTF-8 .csv file.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      setItem(await adminApi.upload<ImportData>("/imports/upload", form));
    } catch (e) {
      setError(adminErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }
  async function resolve(value: any = answer) {
    if (!item || !issue || value == null || (typeof value === "string" && !value.trim())) return;
    setLoading(true);
    try {
      setItem(
        await adminApi.post<ImportData>(`/imports/${item.id}/resolve`, {
          field: issue.field,
          value,
        }),
      );
      setAnswer("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save answer");
    } finally {
      setLoading(false);
    }
  }
  async function preview() {
    if (!item) return;
    setLoading(true);
    setError("");
    try {
      setItem(await generatePreviewAndRefresh<ImportData>(item.id, adminApi));
    } catch (e) {
      setError(adminErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }
  async function chooseTable(sheetName: string, headerRow: number) {
    if (!item) return;
    setLoading(true); setError("");
    try { setItem(await adminApi.post<ImportData>(`/imports/${item.id}/resolve`, { field: "workbook:selection", value: { sheetName, headerRow } })); }
    catch (e) { setError(adminErrorMessage(e)); }
    finally { setLoading(false); }
  }
  async function updateSheet(sheetId:string,data:Record<string,unknown>){if(!item)return;setLoading(true);setError("");try{setItem(await adminApi.patch<ImportData>(`/imports/${item.id}/sheets/${sheetId}`,data))}catch(e){setError(adminErrorMessage(e))}finally{setLoading(false)}}
  async function updateAllSheets(data:Record<string,unknown>){if(!item)return;setLoading(true);setError("");try{setItem(await adminApi.patch<ImportData>(`/imports/${item.id}/sheets`,data))}catch(e){setError(adminErrorMessage(e))}finally{setLoading(false)}}
  async function updateSheetMapping(sheetId:string,sourceColumn:string,canonicalField:string){if(!item)return;setLoading(true);setError("");try{if(item.status==="COMPLETED"){const correction=await adminApi.post<{id:string}>(`/imports/${item.id}/sheets/${sheetId}/corrections`,{sourceColumn,canonicalField});const preview=await adminApi.post<{affected:number;conflicts:number;unchanged:number;changes:Array<{unitId:string;externalUnitId:string;conflict:boolean}>}>(`/imports/${item.id}/corrections/${correction.id}/preview`);const decisions:Record<string,string>={};for(const change of preview.changes.filter(change=>change.conflict)){const decision=globalThis.prompt(`تعارض في الوحدة ${change.externalUnitId}. اكتب APPLY لتطبيق القيمة المصححة، KEEP للاحتفاظ بالقيمة الحالية، أو SKIP لتخطي السجل.`,"KEEP")?.toUpperCase();decisions[change.unitId]=decision==="APPLY"?"APPLY_CORRECTED":decision==="SKIP"?"SKIP":"KEEP_CURRENT"}if(globalThis.confirm(`معاينة التصحيح: ${preview.affected} وحدة ستتأثر، ${preview.conflicts} تعارضات، ${preview.unchanged} بلا تغيير. هل تريد تطبيق القرارات؟`)){await adminApi.post(`/imports/${item.id}/corrections/${correction.id}/confirm`,{decisions});setItem(await adminApi.get<ImportData>(`/imports/${item.id}`))}}else setItem(await adminApi.patch<ImportData>(`/imports/${item.id}/sheets/${sheetId}/mapping`,{sourceColumn,canonicalField}))}catch(e){setError(adminErrorMessage(e))}finally{setLoading(false)}}
  async function confirm() {
    if (!item) return;
    setLoading(true);
    try {
      const result = await adminApi.post<{ import: ImportData }>(
        `/imports/${item.id}/confirm`,
      );
      setItem(result.import);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setLoading(false);
    }
  }
  async function missingPolicy(value: string) {
    if (!item) return;
    setLoading(true);
    try { setItem(await adminApi.post<ImportData>(`/imports/${item.id}/resolve`, { field: "missingUnitPolicy", value })); }
    catch (e) { setError(adminErrorMessage(e)); }
    finally { setLoading(false); }
  }
  return (
    <main className="flex min-h-[calc(100dvh-7rem)] bg-[#f6f5f1] text-ink">
      <aside className="hidden">
        <AdminNav />
      </aside>
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            className="absolute inset-0 bg-black/30"
            onClick={() => setDrawer(false)}
          />
          <aside className="relative flex h-full w-[270px] flex-col bg-[#183b33] text-white">
            <button
              onClick={() => setDrawer(false)}
              className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-white/10"
            >
              <X size={17} />
            </button>
            <AdminNav />
          </aside>
        </div>
      )}
      <section className="min-w-0 flex-1">
        <header className="hidden">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setDrawer(true)}
              className="grid h-9 w-9 place-items-center rounded-lg border lg:hidden"
            >
              <Menu size={17} />
            </button>
            <div>
              <h1 className="text-[14px] font-bold">Inventory import</h1>
              <p className="text-[9px] text-[#83908a]">
                Upload data and answer only what could not be verified
              </p>
            </div>
          </div>
          <a
            href="/"
            className="flex items-center gap-1 text-[10px] font-bold text-[#61706a]"
          >
            <ArrowLeft size={13} /> Customer app
          </a>
        </header>
        <div className="mx-auto max-w-[1250px] p-4 sm:p-7">
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ["New Leads", leadSummary.newLeads],
              ["High Intent", leadSummary.highIntent],
              ["Follow-ups Due", leadSummary.followUpsDue],
              ["Leads This Week", leadSummary.thisWeek],
            ].map(([label, value]) => (
              <a href="/admin/leads" key={label} className="rounded-[16px] border bg-white p-4">
                <p className="text-[7px] font-bold uppercase tracking-wide text-[#89938e]">{label}</p>
                <p className="mt-2 text-[20px] font-bold">{value}</p>
              </a>
            ))}
          </div>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="mb-2 flex items-center gap-2 text-[9px] font-bold uppercase tracking-[.14em] text-coral">
                <Sparkles size={12} /> AI Import Assistant
              </div>
              <h2 className="text-[22px] font-bold tracking-[-.035em] sm:text-[28px]">
                {item ? "Review your inventory" : "Import verified inventory"}
              </h2>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => upload(e.target.files?.[0])}
            />
            <button
              onClick={() => inputRef.current?.click()}
              disabled={loading}
              className="flex h-10 items-center gap-2 rounded-xl bg-forest px-4 text-[9px] font-bold text-white"
            >
              <UploadCloud size={14} />
              {loading
                ? "Working…"
                : item
                  ? "Upload another file"
                  : "Choose Excel or CSV"}
            </button>
          </div>
          {error && (
            <div className="mb-4 rounded-xl border border-[#efc7be] bg-[#fbe9e5] px-4 py-3 text-[10px] font-semibold text-[#8f3f30]">
              {error}
            </div>
          )}
          {!item ? (
            <EmptyUpload onClick={() => inputRef.current?.click()} />
          ) : (
            <>
              <StepBar workflow={item.workflow} />
              <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_325px]">
                <section className="flex min-h-[560px] flex-col overflow-hidden rounded-[22px] border border-[#dedfd9] bg-white shadow-[0_8px_30px_rgba(28,45,39,.05)]">
                  <div className="flex items-center justify-between border-b border-[#e5e6e1] px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="grid h-9 w-9 place-items-center rounded-xl bg-forest text-white">
                        <WandSparkles size={16} />
                      </div>
                      <div>
                        <p className="text-[11px] font-bold">
                          Import assistant
                        </p>
                        <p className="mt-0.5 text-[8px] font-semibold text-[#749087]">
                          {item.fileName}
                        </p>
                      </div>
                    </div>
                    <span className="rounded-full bg-[#f1f0eb] px-2.5 py-1 text-[8px] font-bold">
                      {item.status}
                    </span>
                  </div>
                  <div className="flex-1 p-5 sm:p-7">
                    <div className="mx-auto max-w-[680px] space-y-5">
                      <Assistant
                        text={`وجدت ${item.rowsDetected} صفاً في «${item.analysis?.sheetName || "الملف"}». تم التعرف على ${Object.keys(item.analysis?.mappings || {}).length} أعمدة، وسأطلب منك فقط القرارات التي تحتاج مراجعة.`}
                      />
                      {!!item.sheets?.length && (
                        <SheetReview item={item} projects={selectorOptions.projects} updateSheet={updateSheet} updateAll={updateAllSheets} updateMapping={updateSheetMapping} loading={loading}/>
                      )}
                      {item.status!=="COMPLETED"&&item.sheets?.some(sheet=>sheet.action==="IMPORT"&&sheet.projectId)&&<button type="button" disabled={loading} onClick={()=>{const source=item.sheets.find(sheet=>sheet.action==="IMPORT"&&sheet.projectId)!;updateAllSheets({projectId:source.projectId,defaultCurrency:source.defaultCurrency,defaultUnitType:source.defaultUnitType})}} className="rounded-xl border border-forest px-4 py-2 text-sm font-bold text-forest">تطبيق سياق أول جدول على كل الجداول المختارة</button>}
                      {!item.sheets?.length && (
                        <WorkbookReview item={item} chooseTable={chooseTable} loading={loading}/>
                      )}
                      {!item.sheets?.length && <MappingReview item={item} />}
                      {issue ? (
                        <>
                          <Assistant text={issue.message} />
                          <Answer
                            issue={issue}
                            value={answer}
                            setValue={setAnswer}
                            locations={locations}
                            selectorOptions={selectorOptions}
                            submit={resolve}
                            loading={loading}
                          />
                        </>
                      ) : item.workflow.stage === "COMPLETE" ? (
                        <Assistant
                          text={`Import complete. ${item.rowsCreated} units were created, ${item.rowsUpdated} updated and ${item.rowsRejected} rejected. No data was inserted before confirmation.`}
                        />
                      ) : ["GENERATE_PREVIEW", "REGENERATE_PREVIEW"].includes(importNextAction(item.workflow)) ? (
                        <>
                          <Assistant text={importNextAction(item.workflow) === "REGENERATE_PREVIEW" ? "تغيّرت الشيتات أو التعيينات بعد آخر معاينة. أنشئ المعاينة مرة أخرى قبل التأكيد." : "تم حل كل المتطلبات. أنشئ معاينة المخزون المحدد قبل تأكيد الاستيراد."} />
                          <button
                            onClick={preview}
                            disabled={loading}
                            className="mx-auto flex min-h-11 w-full max-w-md items-center justify-center rounded-xl bg-forest px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
                          >
                            {loading ? "جارٍ إنشاء المعاينة…" : importNextAction(item.workflow) === "REGENERATE_PREVIEW" ? "إعادة إنشاء المعاينة" : "إنشاء المعاينة"}
                          </button>
                        </>
                      ) : item.workflow.previewExists && item.workflow.previewValid ? <ImportPreview item={item} /> : null}
                    </div>
                  </div>
                  {item.workflow.canConfirm && item.workflow.stage !== "COMPLETE" && (
                    <div className="border-t bg-[#fbfaf7] p-4">
                      <div className="mx-auto mb-3 grid max-w-[680px] gap-2 rounded-2xl border bg-white p-4 text-[14px] sm:grid-cols-2" dir="rtl"><p><b>{item.preview.valid}</b> وحدة جاهزة للاستيراد</p><p>المشروع: <b>{item.preview.project || item.project?.name || "—"}</b></p><p>المطور: <b>{item.preview.developer || "—"}</b></p><p>العملة: <b>{item.preview.currency || "—"}</b></p><p>وحدات جديدة: <b>{item.preview.newUnits}</b></p><p>خطط سداد: <b>{item.preview.paymentPlanCount || 0}</b>{item.preview.paymentPlanDurations?.length ? ` — ${item.preview.paymentPlanDurations.join("، ")} شهر` : ""}</p><p>أخطاء: <b>{item.preview.invalidRows || 0}</b></p></div>
                      {item.preview.removedUnits > 0 && <div className="mx-auto mb-3 max-w-[680px] rounded-xl border bg-white p-3 text-[13px]"><p className="font-bold">{item.preview.removedUnits} وحدة غير موجودة في الملف الجديد. اختر السياسة قبل التأكيد:</p><div className="mt-2 flex flex-wrap gap-2">{[["LEAVE_UNCHANGED","اتركها بدون تغيير"],["MARK_UNAVAILABLE","علّمها غير متاحة"],["ARCHIVE","أرشفها"]].map(([value,label])=><button key={value} onClick={()=>missingPolicy(value)} className={`rounded-lg border px-3 py-2 ${item.preview.missingUnitPolicy===value?"bg-forest text-white":""}`}>{label}</button>)}</div></div>}
                      <button
                        onClick={confirm}
                        disabled={loading}
                        className="mx-auto flex h-11 w-full max-w-[680px] items-center justify-center gap-2 rounded-xl bg-coral text-[10px] font-bold text-white"
                      >
                        <CheckCircle2 size={15} /> تأكيد الاستيراد
                      </button>
                    </div>
                  )}
                </section>
                <aside className="space-y-4">
                  <Analysis item={item} />
                  <Issues issues={item.issues} />
                  {!item.workflow.canPreview && item.workflow.blockingReasons.length > 0 && (
                    <div className="rounded-[18px] border border-amber-200 bg-amber-50 p-4" dir="rtl">
                      <p className="text-[10px] font-bold">المطلوب قبل المعاينة</p>
                      <ul className="mt-3 list-disc space-y-1 ps-4 text-[9px] text-amber-900">
                        {item.workflow.blockingReasons.map((reason, index) => <li key={`${reason}-${index}`} dir="auto">{reason}</li>)}
                      </ul>
                    </div>
                  )}
                  <div className="rounded-[18px] border border-[#dedfd9] bg-[#e7f0eb] p-4">
                    <p className="text-[10px] font-bold">Safe by default</p>
                    <p className="mt-1 text-[9px] leading-4 text-[#66736d]">
                      Blocking issues prevent confirmation. Source files and
                      every import decision remain auditable.
                    </p>
                  </div>
                </aside>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

type DashboardSummary = { units: number; availableUnits: number; projects: number; developers: number; activeImports: number; importsNeedingInput: number; newLeads: number; followUps: number };

export default function AdminDashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { adminApi.get<DashboardSummary>("/real-estate/dashboard").then(setSummary).catch(error => setError(adminErrorMessage(error))); }, []);
  const cards = [
    ["إجمالي الوحدات", summary?.units, "/admin/inventory"],
    ["الوحدات المتاحة", summary?.availableUnits, "/admin/inventory"],
    ["المشروعات", summary?.projects, "/admin/projects"],
    ["المطورون", summary?.developers, "/admin/developers"],
    ["عمليات الاستيراد النشطة", summary?.activeImports, "/admin/data"],
    ["استيرادات تحتاج تدخلاً", summary?.importsNeedingInput, "/admin/data"],
    ["العملاء الجدد", summary?.newLeads, "/admin/leads"],
    ["المتابعات المطلوبة", summary?.followUps, "/admin/leads"],
  ] as const;
  return <main className="mx-auto min-h-screen max-w-7xl p-4 sm:p-8" dir="rtl">
    <div className="mb-7"><h1 className="text-2xl font-bold">لوحة التحكم</h1><p className="mt-2 text-sm text-[#68756f]">ملخص حالة البيانات والتشغيل.</p></div>
    {error && <div className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</div>}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{cards.map(([label, value, href]) => <a key={label} href={href} className="rounded-2xl border bg-white p-5 shadow-sm transition hover:-translate-y-0.5"><p className="text-sm text-[#68756f]">{label}</p><p className="mt-3 text-3xl font-bold text-forest">{value ?? "—"}</p></a>)}</div>
    <div className="mt-6"><a href="/admin/data/import" className="inline-flex h-11 items-center gap-2 rounded-xl bg-forest px-5 text-sm font-bold text-white"><UploadCloud size={17}/>بدء استيراد جديد</a></div>
  </main>;
}

function AdminNav() {
  return (
    <>
      <div className="px-5 py-6">
        <LogoMark />
      </div>
      <nav className="flex-1 px-3">
        {nav.map(([Icon, label, href]) => (
          <a
            key={label}
            href={href}
            className={`mb-1 flex h-10 w-full items-center gap-3 rounded-xl px-3 text-[13px] font-semibold ${label === "لوحة التحكم" ? "bg-white text-forest" : "text-white/65 hover:bg-white/10 hover:text-white"}`}
          >
            <Icon size={15} />
            {label}
          </a>
        ))}
      </nav>
      <div className="border-t border-white/10 p-3">
        <button
          onClick={async () => {
            await adminApi.logout();
            location.href = "/admin/login";
          }}
          className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-[10px] text-white/65"
        >
          <Settings size={15} /> Sign out
        </button>
      </div>
    </>
  );
}
function EmptyUpload({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="grid min-h-[460px] w-full place-items-center rounded-[24px] border-2 border-dashed border-[#cdd2cd] bg-white/60 p-8 text-center"
    >
      <div>
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-[22px] bg-[#e3eee8] text-forest">
          <FileSpreadsheet size={27} />
        </div>
        <h3 className="mt-5 text-[16px] font-bold">
          Upload an availability workbook
        </h3>
        <p className="mx-auto mt-2 max-w-sm text-[10px] leading-5 text-[#7b8781]">
          XLSX, legacy XLS and CSV are supported. Maximum 20 MB and 10,000 rows.
        </p>
      </div>
    </button>
  );
}
function Assistant({ text }: { text: string }) {
  return (
    <div className="flex gap-3">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-forest text-white">
        <Sparkles size={13} />
      </div>
      <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-[#f1f0eb] px-4 py-3 text-[11px] leading-5">
        {text}
      </div>
    </div>
  );
}
function Answer({
  issue,
  value,
  setValue,
  locations,
  selectorOptions,
  submit,
  loading,
}: {
  issue: Issue;
  value: string;
  setValue: (v: string) => void;
  locations: Location[];
  selectorOptions: Record<string, SelectorItem[]>;
  submit: (v?: any) => void;
  loading: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDeveloperId, setCreateDeveloperId] = useState("");
  const [createLocationId, setCreateLocationId] = useState("");
  const [entitySearch, setEntitySearch] = useState("");
  const [entityItems, setEntityItems] = useState<SelectorItem[]>([]);
  const inputType = issue.inputType || (issue.field === "locationId" ? "LOCATION_SELECT" : "TEXT");
  const entityType = inputType === "PROJECT_SELECT" ? "projects" : inputType === "DEVELOPER_SELECT" ? "developers" : inputType === "LOCATION_SELECT" ? "locations" : "";
  useEffect(() => {
    if (!entityType) {
      setEntityItems([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      adminApi
        .get<{ items: SelectorItem[] }>(`/imports/options/selectors?type=${entityType}&search=${encodeURIComponent(entitySearch)}&page=1&pageSize=20`)
        .then((result) => active && setEntityItems(result.items))
        .catch(() => active && setEntityItems(selectorOptions[entityType] || []));
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [entitySearch, entityType, selectorOptions]);
  async function createEntity() {
    const slug = `${createName.trim().toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, "-")}-${Date.now().toString(36)}`;
    let created: { id: string };
    if (inputType === "DEVELOPER_SELECT") created = await adminApi.post<{ id: string }>("/catalog/developers", { name: createName.trim(), slug });
    else if (inputType === "LOCATION_SELECT") created = await adminApi.post<{ id: string }>("/locations", { name: createName.trim(), slug, type: "AREA" });
    else created = await adminApi.post<{ id: string }>("/catalog/projects", { name: createName.trim(), slug, developerId: createDeveloperId, locationId: createLocationId || undefined });
    setCreating(false);
    submit(created.id);
  }
  if (["PROJECT_SELECT", "DEVELOPER_SELECT", "LOCATION_SELECT"].includes(inputType)) {
    const items = entitySearch
      ? entityItems
      : entityItems.length
        ? entityItems
        : selectorOptions[entityType] || (inputType === "LOCATION_SELECT" ? locations : []);
    return <div className="ms-0 space-y-3 sm:ms-11" dir="rtl">
      <input type="search" value={entitySearch} onChange={(event) => setEntitySearch(event.target.value)} placeholder="ابحث بالاسم أو الاسم البديل" className="h-12 w-full rounded-xl border bg-white px-3 text-[16px] outline-none focus:border-forest" />
      <select value={value} onChange={(event) => { setValue(event.target.value); if (event.target.value) submit(event.target.value); }} className="h-12 w-full rounded-xl border bg-white px-3 text-[16px] outline-none focus:border-forest">
        <option value="">{inputType === "PROJECT_SELECT" ? "اختر المشروع" : inputType === "DEVELOPER_SELECT" ? "اختر المطور" : "اختر المنطقة"}</option>
        {items.map((option) => <option key={option.id} value={option.id}>{option.name}{option.developer?.name ? ` — ${option.developer.name}` : ""}{option.location?.name ? ` — ${option.location.name}` : option.parent?.name ? ` — ${option.parent.name}` : ""}</option>)}
      </select>
      <button onClick={() => setCreating(!creating)} className="flex items-center gap-2 rounded-xl border border-dashed px-4 py-3 text-[14px] font-bold"><Plus size={16}/> {inputType === "PROJECT_SELECT" ? "إضافة مشروع جديد" : inputType === "DEVELOPER_SELECT" ? "إضافة مطور جديد" : "إضافة منطقة جديدة"}</button>
      {creating && <div className="space-y-2 rounded-2xl border bg-white p-4">
        <input value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="الاسم" className="h-12 w-full rounded-xl border px-3 text-[16px]" />
        {inputType === "PROJECT_SELECT" && <><select value={createDeveloperId} onChange={(event) => setCreateDeveloperId(event.target.value)} className="h-12 w-full rounded-xl border px-3 text-[16px]"><option value="">اختر المطور</option>{selectorOptions.developers.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select><select value={createLocationId} onChange={(event) => setCreateLocationId(event.target.value)} className="h-12 w-full rounded-xl border px-3 text-[16px]"><option value="">اختر المنطقة</option>{selectorOptions.locations.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></>}
        <button disabled={!createName.trim() || (inputType === "PROJECT_SELECT" && !createDeveloperId)} onClick={createEntity} className="rounded-xl bg-forest px-4 py-3 text-[14px] font-bold text-white disabled:opacity-40">حفظ ومتابعة الاستيراد</button>
      </div>}
    </div>;
  }
  if (inputType === "CURRENCY_SELECT") return <TypedSelect value={value} setValue={setValue} submit={submit} placeholder="اختر العملة" options={[['EGP','EGP — جنيه مصري'],['USD','USD — دولار أمريكي'],['EUR','EUR — يورو'],['AED','AED — درهم إماراتي'],['SAR','SAR — ريال سعودي'],['GBP','GBP — جنيه إسترليني']]} />;
  if (inputType === "WORKBOOK_TABLE_SELECT") return <WorkbookTableAnswer issue={issue} submit={submit} loading={loading}/>;
  if (inputType === "CANONICAL_FIELD_SELECT") {
    const sourceHeaders = issue.options?.sourceHeaders as string[] | undefined;
    const fields = issue.options?.fields as Array<{ value: string; group: string; labelAr: string; labelEn: string }> | undefined;
    if (Boolean(sourceHeaders)) return <ColumnPicker columns={issue.options?.detectedColumns || (sourceHeaders ?? []).map((header: string) => ({ key: header, originalHeader: header, samples: [] }))} submit={submit}/>;
    if (sourceHeaders) return <TypedSelect value={value} setValue={setValue} submit={submit} placeholder="اختر عمود كود الوحدة" options={sourceHeaders.map((header) => [header, header])} />;
    const selected = value || issue.options?.suggestedValue || "";
    return <div className="ms-0 space-y-2 sm:ms-11"><select value={selected} onChange={(event) => setValue(event.target.value)} className="h-12 w-full rounded-xl border bg-white px-3 text-[16px]"><option value="">اختر معنى العمود</option>{[...new Set((fields || []).map((field) => field.group))].map((group) => <optgroup key={group} label={group}>{(fields || []).filter((field) => field.group === group).map((field) => <option key={field.value} value={field.value}>{field.labelAr} — {field.labelEn}</option>)}</optgroup>)}<optgroup label="معلومات إضافية"><option value="METADATA">الاحتفاظ كمعلومة إضافية</option><option value="IGNORE">تجاهل هذا العمود</option></optgroup></select><button disabled={!selected || loading} onClick={() => submit(selected)} className="rounded-xl bg-forest px-4 py-3 text-[14px] font-bold text-white disabled:opacity-40">تأكيد المعنى</button></div>;
  }
  if (inputType === "PAYMENT_PLAN_MAPPING") return <PaymentPlanAnswer issue={issue} submit={submit} />;
  if (inputType === "ENUM_SELECT") return <TypedSelect value={value} setValue={setValue} submit={submit} placeholder="اختر القيمة" options={(issue.options?.values || []).map((option: string) => [option, option])} />;
  return (
    <div className="ms-0 sm:ms-11">
      <div className="flex gap-2 rounded-xl border bg-white p-2">
        <input
          type={inputType === "DATE" ? "date" : inputType === "NUMBER" ? "number" : "text"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="min-w-0 flex-1 px-2 text-[16px] outline-none"
          placeholder={
            inputType === "DATE" ? "اختر تاريخ التسليم" : "أدخل القيمة"
          }
        />
        <button
          onClick={() => submit()}
          disabled={loading}
          className="grid h-8 w-8 place-items-center rounded-lg bg-forest text-white"
        >
          <ArrowRight size={14} />
        </button>
      </div>
      {issue.severity !== "BLOCKING" &&
        !issue.field?.startsWith("column:") &&
        !issue.field?.startsWith("value:") && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              onClick={() => submit("LEAVE_EMPTY")}
              className="rounded-full border px-3 py-1.5 text-[8px] font-bold"
            >
              Leave empty
            </button>
            <button
              onClick={() => submit("EXCLUDE_ROWS")}
              className="rounded-full border px-3 py-1.5 text-[8px] font-bold"
            >
              Exclude affected rows
            </button>
            <button
              onClick={() => submit("CONTACT_SALES")}
              className="rounded-full border px-3 py-1.5 text-[8px] font-bold"
            >
              Mark Contact Sales
            </button>
          </div>
        )}
    </div>
  );
}
type DetectedColumnOption = { key: string; originalHeader: string; normalizedHeader?: string; samples?: unknown[]; confidence?: number };
function ColumnPicker({ columns, submit }: { columns: DetectedColumnOption[]; submit: (value?: any) => void }) {
  const [search, setSearch] = useState("");
  const filtered = columns.filter((column) => column.originalHeader.toLowerCase().includes(search.toLowerCase()));
  return <div className="ms-0 space-y-2 sm:ms-11" dir="rtl">
    <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث في الأعمدة الصالحة" className="h-11 w-full rounded-xl border bg-white px-3 text-[15px] outline-none focus:border-forest"/>
    <div className="max-h-72 space-y-2 overflow-y-auto rounded-2xl border bg-white p-2">{filtered.map((column) => <button key={column.key} onClick={() => submit(column.key)} className="block w-full rounded-xl border px-3 py-3 text-start hover:border-forest hover:bg-[#f4f8f6]">
      <span className="block text-[14px] font-bold" dir="auto">{column.originalHeader}</span>
      {!!column.samples?.length && <span className="mt-1 block truncate text-[12px] text-[#718078]" dir="auto">Samples: {column.samples.map(String).join(" · ")}</span>}
    </button>)}{!filtered.length && <p className="p-4 text-center text-[13px] text-[#718078]">لا توجد أعمدة مطابقة.</p>}</div>
  </div>;
}
function WorkbookTableAnswer({ issue, submit, loading }: { issue: Issue; submit: (value?: any) => void; loading: boolean }) {
  const sheets = (issue.options?.sheets || []) as Array<any>;
  const initial = issue.options?.selectedSheet || sheets.find((sheet) => sheet.classification === "INVENTORY")?.name || sheets[0]?.name || "";
  const [sheetName, setSheetName] = useState(initial);
  const sheet = sheets.find((entry) => entry.name === sheetName);
  const suggested = issue.options?.selectedHeaderRow || sheet?.candidateTables?.[0]?.headerRow || sheet?.headerCandidates?.[0]?.row || 1;
  const [headerRow, setHeaderRow] = useState(String(suggested));
  useEffect(() => { const next = sheets.find((entry) => entry.name === sheetName); setHeaderRow(String(next?.candidateTables?.[0]?.headerRow || next?.headerCandidates?.[0]?.row || 1)); }, [sheetName, sheets]);
  const rawRows = (sheet?.rawPreview || []).filter((row:any) => Math.abs(row.row - Number(headerRow)) <= 2);
  return <div className="ms-0 space-y-4 rounded-2xl border bg-white p-4 sm:ms-11" dir="rtl">
    <div className="grid gap-3 sm:grid-cols-2"><label className="text-[13px] font-bold">الصفحة<select value={sheetName} onChange={(event) => setSheetName(event.target.value)} className="mt-1 h-11 w-full rounded-xl border px-3 text-[15px]">{sheets.map((entry) => <option key={entry.name} value={entry.name}>{entry.name} — {entry.classification} ({entry.confidence}%)</option>)}</select></label><label className="text-[13px] font-bold">صف العناوين<input type="number" min={1} max={sheet?.rowCount || 10000} value={headerRow} onChange={(event) => setHeaderRow(event.target.value)} className="mt-1 h-11 w-full rounded-xl border px-3 text-[15px]"/></label></div>
    <div className="overflow-x-auto rounded-xl bg-[#f7f6f2] p-3"><p className="mb-2 text-[12px] font-bold">معاينة المصدر الخام</p>{rawRows.map((row:any) => <div key={row.row} className={`mb-1 flex min-w-max gap-2 rounded-lg px-2 py-1.5 text-[12px] ${row.row === Number(headerRow) ? "bg-[#dcece4] ring-1 ring-forest" : "bg-white"}`}><b className="w-14 shrink-0">Row {row.row}</b>{row.cells.map((cell:unknown,index:number) => <span key={index} className="max-w-44 truncate border-s ps-2" dir="auto">{cell == null ? "—" : String(cell)}</span>)}</div>)}</div>
    <button disabled={loading || !sheetName || Number(headerRow) < 1} onClick={() => submit({ sheetName, headerRow: Number(headerRow) })} className="rounded-xl bg-forest px-4 py-3 text-[14px] font-bold text-white disabled:opacity-40">اعتماد الجدول وصف العناوين</button>
  </div>;
}
function TypedSelect({ value, setValue, submit, placeholder, options }: { value: string; setValue: (value: string) => void; submit: (value?: any) => void; placeholder: string; options: Array<[string, string]> }) {
  return <div className="ms-0 sm:ms-11" dir="rtl"><select value={value} onChange={(event) => { setValue(event.target.value); if (event.target.value) submit(event.target.value); }} className="h-12 w-full rounded-xl border bg-white px-3 text-[16px]"><option value="">{placeholder}</option>{options.map(([optionValue, label]) => <option key={optionValue} value={optionValue}>{label}</option>)}</select></div>;
}
function PaymentPlanAnswer({ issue, submit }: { issue: Issue; submit: (value?: any) => void }) {
  const [durationMonths, setDurationMonths] = useState(issue.options?.suggestedDurationMonths ? String(issue.options.suggestedDurationMonths) : "");
  const [valueType, setValueType] = useState(issue.options?.suggestedValueType || "TOTAL_PRICE");
  const [currency, setCurrency] = useState("EGP");
  return <div className="ms-0 space-y-3 rounded-2xl border bg-white p-4 sm:ms-11" dir="rtl">
    <p className="text-[14px] text-[#64706b]">العمود: <b dir="auto">{issue.options?.sourceColumn}</b></p>
    <label className="block text-[14px] font-bold">مدة السداد بالشهور (إن وُجدت)<input type="number" min={18} max={180} step={1} value={durationMonths} onChange={(event) => setDurationMonths(event.target.value)} placeholder="مثال: 96" className="mt-1 h-12 w-full rounded-xl border px-3 text-[16px]"/></label>
    <label className="block text-[14px] font-bold">نوع القيمة<select value={valueType} onChange={(event) => setValueType(event.target.value)} className="mt-1 h-12 w-full rounded-xl border px-3 text-[16px]"><option value="TOTAL_PRICE">إجمالي سعر الوحدة</option><option value="INSTALLMENT_AMOUNT">قيمة القسط</option><option value="DOWN_PAYMENT_AMOUNT">مبلغ المقدم</option><option value="DOWN_PAYMENT_PERCENT">نسبة المقدم</option><option value="MAINTENANCE_AMOUNT">مبلغ الصيانة</option><option value="MAINTENANCE_PERCENT">نسبة الصيانة</option></select></label>
    <label className="block text-[14px] font-bold">العملة<select value={currency} onChange={(event) => setCurrency(event.target.value)} className="mt-1 h-12 w-full rounded-xl border px-3 text-[16px]"><option value="EGP">EGP — جنيه مصري</option><option value="USD">USD — دولار أمريكي</option><option value="EUR">EUR — يورو</option><option value="AED">AED — درهم إماراتي</option><option value="SAR">SAR — ريال سعودي</option><option value="GBP">GBP — جنيه إسترليني</option></select></label>
    <button onClick={() => submit({ durationMonths: durationMonths ? Number(durationMonths) : undefined, valueType, currency })} className="rounded-xl bg-forest px-4 py-3 text-[14px] font-bold text-white">اعتماد خطة السداد</button>
  </div>;
}
function ImportPreview({ item }: { item: ImportData }) {
  const preview = item.preview ?? {};
  const sheets = Array.isArray(preview.sheets) ? preview.sheets : [];
  return (
    <section className="space-y-4 rounded-2xl border border-forest/25 bg-[#f4f8f5] p-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="font-bold">معاينة الاستيراد</h3><p className="mt-1 text-xs text-[#68756f]">تعرض هذه المعاينة الشيتات المحددة للاستيراد فقط.</p></div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${item.workflow.canConfirm ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-900"}`}>{item.workflow.canConfirm ? "جاهز للتأكيد" : "تحتاج المعاينة إلى مراجعة"}</span>
      </div>
      <div className="grid gap-2 text-sm sm:grid-cols-4">
        <p className="rounded-xl bg-white p-3"><b>{preview.valid ?? 0}</b><span className="block text-xs text-[#68756f]">صف صالح</span></p>
        <p className="rounded-xl bg-white p-3"><b>{preview.invalidRows ?? 0}</b><span className="block text-xs text-[#68756f]">صف غير صالح</span></p>
        <p className="rounded-xl bg-white p-3"><b>{preview.newUnits ?? 0}</b><span className="block text-xs text-[#68756f]">وحدة جديدة</span></p>
        <p className="rounded-xl bg-white p-3"><b>{preview.existingUnits ?? 0}</b><span className="block text-xs text-[#68756f]">وحدة موجودة</span></p>
      </div>
      {sheets.map((sheet: any) => (
        <details key={sheet.sheetId} open className="rounded-xl border bg-white p-3">
          <summary className="cursor-pointer font-bold" dir="auto">{sheet.sheetName} — {sheet.rowsFound} صف</summary>
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-4"><span>صالح: <b>{sheet.valid}</b></span><span>غير صالح: <b>{sheet.invalidRows}</b></span><span>مكرر: <b>{sheet.duplicates}</b></span><span>جديد: <b>{sheet.newUnits}</b></span></div>
          {!!sheet.normalizedRows?.length && <div className="mt-3 overflow-x-auto"><table className="min-w-full text-xs"><thead><tr>{Object.keys(sheet.normalizedRows[0]).map((key) => <th key={key} className="whitespace-nowrap border p-2 text-start" dir="auto">{key}</th>)}</tr></thead><tbody>{sheet.normalizedRows.slice(0,10).map((row: Record<string, unknown>, index: number) => <tr key={index}>{Object.keys(sheet.normalizedRows[0]).map((key) => <td key={key} className="max-w-48 truncate border p-2" dir="auto">{row[key] == null ? "—" : String(row[key])}</td>)}</tr>)}</tbody></table></div>}
        </details>
      ))}
      {!item.workflow.canConfirm && <p className="rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-900">راجع الصفوف غير الصالحة أعلاه. زر التأكيد يظهر فقط عندما يسمح backend بالتأكيد.</p>}
    </section>
  );
}

function StepBar({ workflow }: { workflow: ImportWorkflow }) {
  return (
    <div className="overflow-x-auto rounded-2xl border bg-white px-4 py-3">
      <ol className="flex min-w-[560px] items-center" dir="ltr" aria-label="Import progress">
        {IMPORT_STEPS.map((s, i) => {
          const state = importStepState(workflow, i);
          return <li key={s} className="flex flex-1 items-center last:flex-none" aria-current={state.active ? "step" : undefined}>
            <span
              className={`grid h-6 min-w-6 place-items-center rounded-full px-1 text-[8px] font-bold ${state.complete ? "bg-forest text-white" : state.active ? "border-2 border-coral text-coral" : "bg-[#eee] text-[#999]"}`}
            >
              {state.complete ? <Check size={11} /> : state.count > 0 ? state.count : i + 1}
            </span>
            <span className="ml-2 text-[8px] font-bold">{s}</span>
            {i < 4 && (
              <div
                className={`mx-3 h-px flex-1 ${state.complete ? "bg-forest" : "bg-[#ddd]"}`}
              />
            )}
          </li>;
        })}
      </ol>
    </div>
  );
}
function Analysis({ item }: { item: ImportData }) {
  return (
    <div className="rounded-[18px] border bg-white p-4">
      <p className="text-[10px] font-bold">Workbook analysis</p>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {[
          [item.rowsDetected, "Rows"],
          [Object.keys(item.analysis?.mappings || {}).length, "Mapped"],
          [item.analysis?.sheets?.length || 1, "Sheets"],
        ].map(([n, l]) => (
          <div key={String(l)} className="rounded-xl bg-[#f4f3ee] px-3 py-2.5">
            <p className="text-[14px] font-bold">{n}</p>
            <p className="text-[7px] uppercase text-[#8b958f]">{l}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
const IMPORT_FIELD_LABELS:Record<string,string>={externalUnitId:"كود الوحدة",phase:"المرحلة",cluster:"المجموعة",building:"المبنى",floor:"الدور",unitType:"نوع الوحدة",unitSubType:"النوع الفرعي",bedrooms:"غرف النوم",bathrooms:"الحمامات",builtUpArea:"المساحة المبنية",landArea:"مساحة الأرض",gardenArea:"مساحة الحديقة",roofArea:"مساحة السطح",terraceArea:"مساحة التراس",price:"السعر الرسمي",currency:"العملة",status:"حالة الوحدة",deliveryDate:"تاريخ التسليم",deliveryYears:"سنوات التسليم",finishingType:"نوع التشطيب",maintenance:"الصيانة",clubFees:"رسوم النادي",discount:"الخصم",offerText:"العرض",METADATA:"معلومة إضافية",IGNORE:"تجاهل العمود",__METADATA__:"معلومة إضافية",__IGNORE__:"تجاهل العمود"};
const IMPORT_FIELDS=Object.entries(IMPORT_FIELD_LABELS).filter(([value])=>!value.startsWith("__") && !["METADATA","IGNORE"].includes(value));
function SheetReview({item,projects,updateSheet,updateAll,updateMapping,loading}:{item:ImportData;projects:SelectorItem[];updateSheet:(id:string,data:Record<string,unknown>)=>void;updateAll:(data:Record<string,unknown>)=>void;updateMapping:(id:string,column:string,target:string)=>void;loading:boolean}){
  return <section className="space-y-3 rounded-2xl border bg-[#fbfaf7] p-4" dir="rtl"><div><h3 className="font-bold">مراجعة الشيتات</h3><p className="mt-1 text-xs text-[#68756f]">اختر الجداول التي تريد استيرادها. الشيتات المتجاهلة لا تنشئ أسئلة أو وحدات أو خطط سداد.</p></div>{item.sheets.map(sheet=><details key={sheet.id} open={sheet.action==="IMPORT"} className="rounded-xl border bg-white p-3"><summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3"><span><b dir="auto">{sheet.sheetName}</b>{sheet.tableId&&<small className="ms-2 text-[#748079]">صفوف {sheet.startRow}–{sheet.endRow}</small>}<small className="mt-1 block text-[#748079]">{sheet.classification} · ثقة {sheet.confidence}% · {sheet.rowsDetected} صف</small></span><span className="flex rounded-lg border p-1"><button type="button" disabled={loading} onClick={event=>{event.preventDefault();updateSheet(sheet.id,{action:"IMPORT"})}} className={`rounded-md px-3 py-2 text-xs font-bold ${sheet.action==="IMPORT"?"bg-forest text-white":""}`}>استيراد</button><button type="button" disabled={loading} onClick={event=>{event.preventDefault();updateSheet(sheet.id,{action:"IGNORE"})}} className={`rounded-md px-3 py-2 text-xs font-bold ${sheet.action==="IGNORE"?"bg-[#ece9e1]":""}`}>تجاهل</button></span></summary>{sheet.action==="IMPORT"&&<div className="mt-4 space-y-4 border-t pt-4"><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><label className="text-xs font-bold">المشروع<select value={sheet.projectId||""} onChange={event=>updateSheet(sheet.id,{projectId:event.target.value})} className="mt-1 h-11 w-full rounded-xl border px-2"><option value="">اختر المشروع</option>{projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label className="text-xs font-bold">العملة<select value={sheet.defaultCurrency||""} onChange={event=>updateSheet(sheet.id,{defaultCurrency:event.target.value})} className="mt-1 h-11 w-full rounded-xl border px-2"><option value="">من عمود الملف</option>{["EGP","USD","EUR","AED","SAR","GBP"].map(value=><option key={value}>{value}</option>)}</select></label><label className="text-xs font-bold">نوع الوحدة الافتراضي<select value={sheet.defaultUnitType||""} onChange={event=>updateSheet(sheet.id,{defaultUnitType:event.target.value})} className="mt-1 h-11 w-full rounded-xl border px-2"><option value="">بدون افتراض</option>{["APARTMENT","VILLA","TOWNHOUSE","TWIN_HOUSE","CHALET","OFFICE","CLINIC","RETAIL","COMMERCIAL","ADMINISTRATIVE","MEDICAL","OTHER"].map(value=><option key={value}>{value}</option>)}</select></label><label className="text-xs font-bold">صف العناوين<div className="mt-1 flex gap-1"><input id={`header-${sheet.id}`} type="number" min="1" defaultValue={sheet.headerRow||1} className="h-11 min-w-0 flex-1 rounded-xl border px-2"/><button type="button" onClick={()=>{const input=document.getElementById(`header-${sheet.id}`) as HTMLInputElement;updateSheet(sheet.id,{headerRow:Number(input.value)})}} className="rounded-xl border px-3">تطبيق</button></div></label></div><div><h4 className="text-sm font-bold">معاينة المصدر</h4><div className="mt-2 overflow-x-auto"><table className="min-w-full text-xs"><thead><tr>{(sheet.columns||[]).map(column=><th key={column.key} className="whitespace-nowrap border p-2 text-start" dir="auto">{column.originalHeader}</th>)}</tr></thead><tbody>{(sheet.sourcePreview||[]).slice(0,5).map((row,index)=><tr key={index}>{(sheet.columns||[]).map(column=><td key={column.key} className="max-w-44 truncate border p-2" dir="auto">{row[column.key]==null?"—":String(row[column.key])}</td>)}</tr>)}</tbody></table></div></div><div><h4 className="text-sm font-bold">مراجعة الأعمدة</h4><div className="mt-2 space-y-2">{(sheet.columns||[]).map(column=><div key={column.key} className="grid items-center gap-2 rounded-xl border p-3 sm:grid-cols-[1fr_1fr_220px]"><div><b dir="auto">{column.originalHeader}</b><small className="mt-1 block truncate text-[#748079]" dir="auto">{(column.samples||[]).map(String).join(" · ")||"لا توجد عينات"}</small></div><span className="text-xs">{IMPORT_FIELD_LABELS[sheet.mappings?.[column.key]||""]||"يحتاج مراجعة"}<small className="block text-[#748079]">{sheet.mappingSources?.[column.key]||"غير محدد"}</small></span><select value={(sheet.mappings?.[column.key]||"").replace(/^__|__$/g,"")} onChange={event=>updateMapping(sheet.id,column.key,event.target.value)} className="h-10 rounded-lg border px-2 text-sm"><option value="">تعديل المعنى</option>{IMPORT_FIELDS.map(([value,label])=><option key={value} value={value}>{label}</option>)}<option value="METADATA">معلومة إضافية</option><option value="IGNORE">تجاهل العمود</option></select></div>)}</div></div>{sheet.previewMappingVersion!=null&&sheet.previewMappingVersion!==sheet.mappingVersion&&<p className="rounded-lg bg-amber-50 p-3 text-xs font-bold text-amber-800">تم تعديل التفسير. يجب إنشاء المعاينة مرة أخرى.</p>}</div>}</details>)}</section>;
}
function WorkbookReview({ item, chooseTable, loading }: { item: ImportData; chooseTable: (sheetName: string, headerRow: number) => void; loading: boolean }) {
  const analysis = item.analysis?.workbookAnalysis;
  const selected = item.analysis?.selectedTable;
  const [manualSheet, setManualSheet] = useState(analysis?.selectedSheet || analysis?.sheets?.[0]?.name || "");
  const [manualHeader, setManualHeader] = useState(String(selected?.headerRow || 1));
  if (!analysis?.sheets?.length) return null;
  return <details open className="rounded-2xl border bg-white p-4" dir="rtl"><summary className="cursor-pointer text-[14px] font-bold">تحليل صفحات الملف — {analysis.sheets.length} صفحات</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">{analysis.sheets.map((sheet:any) => <div key={sheet.name} className={`rounded-xl border p-3 ${analysis.selectedSheet === sheet.name ? "border-forest bg-[#f0f7f3]" : "bg-[#fbfaf7]"}`}><div className="flex items-start justify-between gap-2"><div><p className="font-bold" dir="auto">{sheet.name}</p><p className="mt-1 text-[12px] text-[#68756f]">{sheet.rowCount} rows · {sheet.columnCount} columns</p></div><span className="rounded-full bg-white px-2 py-1 text-[11px] font-bold">{sheet.classification} · {sheet.confidence}%</span></div>{sheet.candidateTables?.[0] && <><p className="mt-2 text-[12px]">Header row {sheet.candidateTables[0].headerRow} · Data rows {sheet.candidateTables[0].dataRowCount}</p><button disabled={loading || analysis.selectedTableId === sheet.candidateTables[0].id} onClick={() => chooseTable(sheet.name, sheet.candidateTables[0].headerRow)} className="mt-2 rounded-lg border px-3 py-2 text-[12px] font-bold disabled:opacity-40">{analysis.selectedTableId === sheet.candidateTables[0].id ? "Selected" : "Use this table"}</button></>}{!sheet.candidateTables?.length && <p className="mt-2 text-[12px] text-[#8f5b35]">No tabular region detected · ignored by default</p>}</div>)}</div><div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-dashed p-3"><label className="text-[12px] font-bold">Manual sheet<select value={manualSheet} onChange={(event) => setManualSheet(event.target.value)} className="mt-1 block h-10 rounded-lg border px-2 text-[14px]">{analysis.sheets.map((sheet:any) => <option key={sheet.name}>{sheet.name}</option>)}</select></label><label className="text-[12px] font-bold">Header row<input value={manualHeader} onChange={(event) => setManualHeader(event.target.value)} type="number" min={1} className="mt-1 block h-10 w-28 rounded-lg border px-2 text-[14px]"/></label><button disabled={loading || !manualSheet || Number(manualHeader) < 1} onClick={() => chooseTable(manualSheet, Number(manualHeader))} className="h-10 rounded-lg bg-forest px-3 text-[12px] font-bold text-white disabled:opacity-40">Apply manual header</button></div>{selected && <div className="mt-4 overflow-x-auto rounded-xl border bg-[#f7f6f2] p-3"><p className="text-[13px] font-bold">Detected table: rows {selected.startRow} → {selected.endRow} · header row {selected.headerRow} · confidence {selected.confidence}%</p><p className="mt-1 text-[11px] text-[#68756f]">Ignored above: {selected.ignoredRowsAbove} · ignored below: {selected.ignoredRowsBelow}</p><table className="mt-3 min-w-full text-[12px]"><thead><tr>{selected.columns.map((column:any) => <th key={column.key} className="whitespace-nowrap border p-2 text-start" dir="auto">{column.originalHeader}</th>)}</tr></thead><tbody>{selected.previewRows?.slice(0,5).map((row:any,index:number) => <tr key={index}>{selected.columns.map((column:any) => <td key={column.key} className="max-w-48 truncate border p-2" dir="auto">{row[column.key] == null ? "—" : String(row[column.key])}</td>)}</tr>)}</tbody></table></div>}</details>;
}
function MappingReview({ item }: { item: ImportData }) {
  const fieldOptions = item.issues.flatMap((entry) => entry.options?.fields || []) as Array<{ value: string; labelAr: string; labelEn: string }>;
  const labels = new globalThis.Map(fieldOptions.map((field) => [field.value, field]));
  const mappings = Object.entries(item.analysis?.mappings || {});
  const plans = Object.entries(item.analysis?.paymentPlanMappings || {}) as Array<[string, any]>;
  if (!mappings.length && !plans.length) return null;
  const sourceLabel = (source?: string) => source === "ADMIN_APPROVED_MEMORY" ? "ذاكرة معتمدة" : source === "ADMIN_APPROVED" ? "تم تأكيده" : source === "AI_SUGGESTION" ? "اقتراح ذكي — يحتاج تأكيد" : "قاعدة موثوقة — تحتاج تأكيد أول مرة";
  return <details className="rounded-2xl border bg-[#fbfaf7] p-4" dir="rtl"><summary className="cursor-pointer text-[14px] font-bold">مراجعة معاني أعمدة الملف</summary><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[560px] text-right text-[13px]"><thead><tr className="border-b text-[#6d7772]"><th className="p-2">عمود الملف</th><th className="p-2">المعنى في النظام</th><th className="p-2">المصدر</th></tr></thead><tbody>{mappings.map(([column, canonical]) => { const label = labels.get(String(canonical)); return <tr key={column} className="border-b last:border-0"><td className="p-2" dir="auto">{column}</td><td className="p-2">{label?.labelAr || label?.labelEn || "حقل أعمال معتمد"}</td><td className="p-2">{sourceLabel(item.analysis?.mappingSources?.[column])}</td></tr>; })}{plans.map(([column, plan]) => <tr key={column} className="border-b last:border-0"><td className="p-2" dir="auto">{column}</td><td className="p-2">سعر خطة سداد — {plan.durationMonths || "—"} شهر</td><td className="p-2">{plan.approved ? "تم تأكيده" : "يحتاج تأكيد"}</td></tr>)}</tbody></table></div></details>;
}
function Issues({ issues }: { issues: Issue[] }) {
  return (
    <div className="rounded-[18px] border bg-white p-4">
      <p className="text-[10px] font-bold">Issues</p>
      <div className="mt-4 space-y-3">
        {issues.length ? (
          issues.map((i) => (
            <div key={i.id} className="flex gap-2">
              <span
                className={`mt-1 h-2 w-2 rounded-full ${i.resolvedAt ? "bg-[#3d8c6c]" : i.severity === "BLOCKING" ? "bg-coral" : "bg-[#e3ad52]"}`}
              />
              <div>
                <p className="text-[8px] font-bold">{i.message}</p>
                <p className="text-[7px] text-[#8b958f]">
                  {i.resolvedAt ? "Resolved" : i.severity}
                </p>
              </div>
            </div>
          ))
        ) : (
          <p className="text-[8px] text-[#8b958f]">No issues detected</p>
        )}
      </div>
    </div>
  );
}
