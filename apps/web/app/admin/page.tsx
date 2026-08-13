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
};
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

export default function AdminPage() {
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
      item?.issues.find((i) => !i.resolvedAt && i.severity === "BLOCKING") ||
      item?.issues.find((i) => !i.resolvedAt),
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
    try {
      setItem(await adminApi.post<ImportData>(`/imports/${item.id}/preview`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setLoading(false);
    }
  }
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
    <main className="flex min-h-[100dvh] bg-[#f6f5f1] text-ink">
      <aside className="hidden w-[245px] shrink-0 border-r border-[#dfe0da] bg-[#183b33] text-white lg:flex lg:flex-col">
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
        <header className="flex h-[66px] items-center justify-between border-b border-[#e0e1dc] bg-white px-4 sm:px-7">
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
              <StepBar status={item.status} />
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
                      ) : item.status === "COMPLETED" ? (
                        <Assistant
                          text={`Import complete. ${item.rowsCreated} units were created, ${item.rowsUpdated} updated and ${item.rowsRejected} rejected. No data was inserted before confirmation.`}
                        />
                      ) : (
                        <>
                          <Assistant text="تم حل كل الأسئلة المطلوبة. أنشئ المعاينة النهائية قبل تأكيد الاستيراد." />
                          <button
                            onClick={preview}
                            disabled={loading}
                            className="ml-11 rounded-xl bg-forest px-5 py-3 text-[9px] font-bold text-white"
                          >
                            إنشاء المعاينة
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {item.preview?.canConfirm && item.status !== "COMPLETED" && (
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
  if (inputType === "CANONICAL_FIELD_SELECT") {
    const sourceHeaders = issue.options?.sourceHeaders as string[] | undefined;
    const fields = issue.options?.fields as Array<{ value: string; group: string; labelAr: string; labelEn: string }> | undefined;
    if (sourceHeaders) return <TypedSelect value={value} setValue={setValue} submit={submit} placeholder="اختر عمود كود الوحدة" options={sourceHeaders.map((header) => [header, header])} />;
    return <div className="ms-0 sm:ms-11"><select value={value} onChange={(event) => { setValue(event.target.value); if (event.target.value) submit(event.target.value); }} className="h-12 w-full rounded-xl border bg-white px-3 text-[16px]"><option value="">اختر معنى العمود</option>{[...new Set((fields || []).map((field) => field.group))].map((group) => <optgroup key={group} label={group}>{(fields || []).filter((field) => field.group === group).map((field) => <option key={field.value} value={field.value}>{field.labelAr} — {field.labelEn}</option>)}</optgroup>)}<optgroup label="معلومات إضافية"><option value="METADATA">الاحتفاظ كمعلومة إضافية</option><option value="IGNORE">تجاهل هذا العمود</option></optgroup></select></div>;
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
function StepBar({ status }: { status: string }) {
  const active = status === "COMPLETED" ? 4 : status === "READY" ? 3 : 2;
  return (
    <div className="overflow-x-auto rounded-2xl border bg-white px-4 py-3">
      <div className="flex min-w-[560px] items-center">
        {["Upload", "Analyze", "Resolve", "Preview", "Import"].map((s, i) => (
          <div key={s} className="flex flex-1 items-center last:flex-none">
            <span
              className={`grid h-6 w-6 place-items-center rounded-full text-[8px] font-bold ${i < active ? "bg-forest text-white" : i === active ? "border-2 border-coral text-coral" : "bg-[#eee] text-[#999]"}`}
            >
              {i < active ? <Check size={11} /> : i + 1}
            </span>
            <span className="ml-2 text-[8px] font-bold">{s}</span>
            {i < 4 && (
              <div
                className={`mx-3 h-px flex-1 ${i < active ? "bg-forest" : "bg-[#ddd]"}`}
              />
            )}
          </div>
        ))}
      </div>
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
                <p className="text-[8px] font-bold">{i.field}</p>
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
