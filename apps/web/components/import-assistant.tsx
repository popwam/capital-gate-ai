"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  FileSpreadsheet,
  Plus,
  Sparkles,
  UploadCloud,
  WandSparkles,
  X,
} from "lucide-react";
import { ManualUnitEntry } from "@/components/manual-unit-entry";
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
type ImportSheetData = { id:string; sheetName:string; tableId?:string|null; classification:string; confidence:number; action:"IMPORT"|"IGNORE"; headerRow?:number|null; startRow?:number|null; endRow?:number|null; rowsDetected:number; projectId?:string|null; phaseId?:string|null; developerId?:string|null; locationId?:string|null; defaultCurrency?:string|null; defaultUnitType?:string|null; defaultIsResale?:boolean; columns?:Array<{key:string;originalHeader:string;samples?:unknown[]}>; mappings?:Record<string,string>; mappingSources?:Record<string,unknown>; sourcePreview?:Array<Record<string,unknown>>; mappingVersion:number; previewMappingVersion?:number|null; project?:{name:string}|null; phase?:{id:string;name:string;code?:string|null}|null };
type Location = {
  id: string;
  name: string;
  type: string;
  parent?: { name: string } | null;
};
type SelectorItem = { id: string; name: string; slug?: string; developerId?: string; locationId?: string; developer?: { name: string }; location?: { name: string }; parent?: { name: string }; type?: string };
type CanonicalFieldOption = { value: string; group: string; labelAr: string; labelEn: string; type?: string; storage?: "UNIT" | "METADATA" | "CONTEXT" | "COMPOSITE"; keywords?: string[] };
type PhaseValueReview = { mode:"COLUMN"|"SINGLE"; sourceColumn:string|null; sourceHeader:string|null; totalRows:number; uniqueCount:number; matchedCount:number; unmatchedCount:number; values:Array<{normalizedValue:string;sourceValue:string;count:number;matched:boolean;phaseId:string|null;phaseName:string|null;phaseCode?:string|null;matchSource:string}>; phases?:Array<{id:string;name:string;code?:string|null}> };
type ProjectValueReview = { mode:"COLUMN"|"SINGLE"; sourceColumn:string|null; sourceHeader:string|null; totalRows:number; uniqueCount:number; resolvedCount:number; unresolvedCount:number; values:Array<{normalizedValue:string;sourceValue:string;count:number;resolved:boolean;projectId:string|null;projectName:string|null;phaseId:string|null;phaseName:string|null;suggestedProjectId:string|null;ambiguousCandidateCount:number}>; projects:Array<{id:string;name:string;developerName:string;locationId:string|null;locationName:string|null;phases:Array<{id:string;name:string;code?:string|null}>}> };


export function ImportAssistant() {
  const [item, setItem] = useState<ImportData | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectorOptions, setSelectorOptions] = useState<Record<string, SelectorItem[]>>({ projects: [], developers: [], locations: [] });
  const [canonicalFields, setCanonicalFields] = useState<CanonicalFieldOption[]>([]);
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [manualUnitOpen, setManualUnitOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const importId = new URLSearchParams(location.search).get("import");
    if (importId) adminApi.get<ImportData>(`/imports/${importId}`).then(setItem).catch((e) => setError(adminErrorMessage(e)));
    adminApi
      .get<Location[]>("/locations")
      .then(setLocations)
      .catch((e) => setError(e.message));
    for (const type of ["projects", "developers", "locations"])
      adminApi.get<{ items: SelectorItem[] }>(`/imports/options/selectors?type=${type}&pageSize=50`).then((result) => setSelectorOptions((current) => ({ ...current, [type]: result.items }))).catch(() => undefined);
    adminApi.get<{ items: CanonicalFieldOption[] }>("/imports/options/selectors?type=canonicalFields")
      .then((result) => setCanonicalFields(result.items))
      .catch(() => undefined);
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
  async function markAllSheetsInventory(){if(!item)return;setLoading(true);setError("");try{setItem(await adminApi.patch<ImportData>(`/imports/${item.id}/sheets/all-inventory`,{}))}catch(e){setError(adminErrorMessage(e))}finally{setLoading(false)}}
  async function updateSheetMapping(sheetId:string,sourceColumn:string,canonicalField:string){if(!item)return;setLoading(true);setError("");try{if(item.status==="COMPLETED"){const correction=await adminApi.post<{id:string}>(`/imports/${item.id}/sheets/${sheetId}/corrections`,{sourceColumn,canonicalField});const preview=await adminApi.post<{affected:number;conflicts:number;unchanged:number;changes:Array<{unitId:string;externalUnitId:string;conflict:boolean}>}>(`/imports/${item.id}/corrections/${correction.id}/preview`);const decisions:Record<string,string>={};for(const change of preview.changes.filter(change=>change.conflict)){const decision=globalThis.prompt(`تعارض في الوحدة ${change.externalUnitId}. اكتب APPLY لتطبيق القيمة المصححة، KEEP للاحتفاظ بالقيمة الحالية، أو SKIP لتخطي السجل.`,"KEEP")?.toUpperCase();decisions[change.unitId]=decision==="APPLY"?"APPLY_CORRECTED":decision==="SKIP"?"SKIP":"KEEP_CURRENT"}if(globalThis.confirm(`معاينة التصحيح: ${preview.affected} وحدة ستتأثر، ${preview.conflicts} تعارضات، ${preview.unchanged} بلا تغيير. هل تريد تطبيق القرارات؟`)){await adminApi.post(`/imports/${item.id}/corrections/${correction.id}/confirm`,{decisions});setItem(await adminApi.get<ImportData>(`/imports/${item.id}`))}}else setItem(await adminApi.patch<ImportData>(`/imports/${item.id}/sheets/${sheetId}/mapping`,{sourceColumn,canonicalField}))}catch(e){setError(adminErrorMessage(e))}finally{setLoading(false)}}
  async function mapPhaseValue(sheetId:string,sourceValue:string,phaseId:string){if(!item||!phaseId)return;setLoading(true);setError("");try{setItem(await adminApi.patch<ImportData>(`/imports/${item.id}/sheets/${sheetId}/phase-values`,{sourceValue,phaseId}))}catch(e){setError(adminErrorMessage(e))}finally{setLoading(false)}}
  async function mapProjectValue(sheetId:string,sourceValue:string,projectId:string,phaseId:string){if(!item||!projectId||!phaseId)return;setLoading(true);setError("");try{setItem(await adminApi.patch<ImportData>(`/imports/${item.id}/sheets/${sheetId}/project-values`,{sourceValue,projectId,phaseId}))}catch(e){setError(adminErrorMessage(e))}finally{setLoading(false)}}
  async function confirm() {
    if (!item) return;
    setLoading(true);
    try {
      const result = await adminApi.post<{ import: ImportData }>(
        `/imports/${item.id}/confirm`,
      );
      setItem(result.import);
    } catch (e) {
      setError(adminErrorMessage(e));
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
    <main className="min-h-[calc(100dvh-7rem)] bg-[#f6f5f1] text-ink [&_button]:min-h-11 [&_input:not([type=file])]:min-h-11 [&_select]:min-h-11">
      <section className="min-w-0">
        <div className="mx-auto max-w-[1250px] p-4 sm:p-7">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2 text-[12px] font-bold tracking-[.08em] text-coral">
                <Sparkles size={12} /> استيراد ذكي مع مراجعة بشرية
              </div>
              <h2 className="text-[22px] font-bold tracking-[-.035em] sm:text-[28px]">
                {item ? "راجع الاستيراد ثم اعتمده" : "أضف وحدة مباشرة أو استورد ملف مخزون"}
              </h2>
              {item && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#68756f]"><span className="max-w-full truncate rounded-full border bg-white px-3 py-1.5" dir="auto">{item.fileName}</span><span className="rounded-full bg-[#e8f0ec] px-3 py-1.5 font-bold text-forest">{item.status}</span></div>}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => upload(e.target.files?.[0])}
            />
            {!item && <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setManualUnitOpen(true)} className="flex h-11 items-center gap-2 rounded-xl border border-forest bg-white px-4 text-sm font-bold text-forest"><Plus size={15}/>إضافة وحدة بدون ملف</button>
              <button onClick={() => inputRef.current?.click()} disabled={loading} className="flex h-11 items-center gap-2 rounded-xl bg-forest px-4 text-sm font-bold text-white">
                <UploadCloud size={15} />{loading ? "جارٍ الرفع…" : "اختيار Excel أو CSV"}
              </button>
            </div>}
          </div>
          {error && (
            <div className="mb-4 rounded-xl border border-[#efc7be] bg-[#fbe9e5] px-4 py-3 text-[12px] font-semibold text-[#8f3f30]">
              {error}
            </div>
          )}
          {!item ? (
            <EmptyUpload onClick={() => inputRef.current?.click()} />
          ) : (
            <>
              <StepBar workflow={item.workflow} />
              <div className="mt-5 space-y-5">
                <section className="flex min-h-[560px] flex-col overflow-visible rounded-[22px] border border-[#dedfd9] bg-white shadow-[0_8px_30px_rgba(28,45,39,.05)]">
                  <div className="flex items-center justify-between border-b border-[#e5e6e1] px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="grid h-9 w-9 place-items-center rounded-xl bg-forest text-white">
                        <WandSparkles size={16} />
                      </div>
                      <div>
                        <p className="text-[11px] font-bold">
                          مساعد الاستيراد
                        </p>
                        <p className="mt-0.5 text-[11px] font-semibold text-[#749087]">
                          {item.fileName}
                        </p>
                      </div>
                    </div>
                    <span className="rounded-full bg-[#f1f0eb] px-2.5 py-1 text-[11px] font-bold">
                      {item.status}
                    </span>
                  </div>
                  <div className="flex-1 p-5 sm:p-7">
                    <div className="mx-auto max-w-[1080px] space-y-5">
                      <div className="rounded-2xl border border-[#dfe5e1] bg-[#f7f9f7] px-4 py-3" dir="rtl">
                        <p className="text-sm font-black">تمت قراءة المصدر بدون إضافة أي بيانات</p>
                        <p className="mt-1 text-xs leading-6 text-[#68756f]">تم العثور على <b>{item.rowsDetected}</b> صف. أكمل سياق المشروع ومعاني الحقول، ثم أنشئ المعاينة. الصف الخام لا يُعتبر خطأ لمجرد أن حقلًا يحتاج تفسيرًا.</p>
                      </div>
                      {!!item.sheets?.length && (
                        <SheetReview item={item} selectorOptions={selectorOptions} canonicalFields={canonicalFields} updateSheet={updateSheet} markAllInventory={markAllSheetsInventory} updateMapping={updateSheetMapping} mapPhaseValue={mapPhaseValue} mapProjectValue={mapProjectValue} loading={loading}/>
                      )}
                      {item.status!=="COMPLETED"&&item.sheets.filter(sheet=>sheet.action==="IMPORT").length>1&&item.sheets.some(sheet=>sheet.action==="IMPORT"&&sheet.projectId)&&<button type="button" disabled={loading} onClick={()=>{const source=item.sheets.find(sheet=>sheet.action==="IMPORT"&&sheet.projectId)!;updateAllSheets({projectId:source.projectId,phaseId:source.phaseId,defaultCurrency:source.defaultCurrency,defaultUnitType:source.defaultUnitType,defaultIsResale:source.defaultIsResale})}} className="rounded-xl border border-forest px-4 py-2 text-sm font-bold text-forest">تطبيق سياق أول جدول على باقي الجداول</button>}
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
                          text={`اكتمل الاستيراد. تم إنشاء ${item.rowsCreated} وحدة، وتحديث ${item.rowsUpdated}، ورفض ${item.rowsRejected}. لم تُحفظ أي بيانات قبل اعتمادك النهائي.`}
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
                      <div className="mx-auto mb-3 grid max-w-[1080px] gap-2 rounded-2xl border bg-white p-4 text-[14px] sm:grid-cols-2" dir="rtl"><p><b>{item.preview.readyRows ?? item.preview.valid ?? 0}</b> وحدة جاهزة للاستيراد</p><p>صفوف المصدر: <b>{item.preview.sourceRows ?? item.rowsDetected}</b></p><p>وحدات جديدة: <b>{item.preview.newUnits ?? 0}</b></p><p>وحدات موجودة: <b>{item.preview.existingUnits ?? 0}</b></p><p>تحتاج قرار: <b>{item.preview.needsReviewRows ?? item.preview.invalidRows ?? 0}</b></p><p>خطط سداد: <b>{item.preview.paymentPlanCount || 0}</b>{item.preview.paymentPlanDurations?.length ? ` — ${item.preview.paymentPlanDurations.join("، ")} شهر` : ""}</p></div>
                      {item.preview.removedUnits > 0 && <div className="mx-auto mb-3 max-w-[1080px] rounded-xl border bg-white p-3 text-[13px]"><p className="font-bold">{item.preview.removedUnits} وحدة غير موجودة في الملف الجديد. اختر السياسة قبل التأكيد:</p><div className="mt-2 flex flex-wrap gap-2">{[["LEAVE_UNCHANGED","اتركها بدون تغيير"],["MARK_UNAVAILABLE","علّمها غير متاحة"],["ARCHIVE","أرشفها"]].map(([value,label])=><button key={value} onClick={()=>missingPolicy(value)} className={`rounded-lg border px-3 py-2 ${item.preview.missingUnitPolicy===value?"bg-forest text-white":""}`}>{label}</button>)}</div></div>}
                      <button
                        onClick={confirm}
                        disabled={loading}
                        className="mx-auto flex h-11 w-full max-w-[1080px] items-center justify-center gap-2 rounded-xl bg-coral text-[12px] font-bold text-white"
                      >
                        <CheckCircle2 size={15} /> تأكيد الاستيراد
                      </button>
                    </div>
                  )}
                </section>
                <aside className="grid gap-3 md:grid-cols-3">
                  <Analysis item={item} />
                  <Issues issues={item.issues} />
                  <div className="rounded-[18px] border border-[#d9e3dd] bg-[#edf4f0] p-4" dir="rtl">
                    <p className="text-[12px] font-bold">الاعتماد آمن</p>
                    <p className="mt-2 text-[12px] leading-5 text-[#66736d]">لا يتم حفظ أي وحدة قبل المعاينة النهائية. أخطاء التفسير تظهر كقرارات مطلوبة، ولا يتم وصف الصف الخام بأنه تالف لمجرد وجود حقل يحتاج مراجعة.</p>
                    {!item.workflow.canPreview && item.workflow.blockingReasons.length > 0 && <p className="mt-3 text-xs font-bold text-amber-900">متبقي {item.workflow.blockingReasons.length} قرار قبل المعاينة.</p>}
                  </div>
                </aside>
              </div>
            </>
          )}
        </div>
      </section>
      <ManualUnitEntry open={manualUnitOpen} onClose={() => setManualUnitOpen(false)} />
    </main>
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
          ارفع ملف المخزون
        </h3>
        <p className="mx-auto mt-2 max-w-sm text-[12px] leading-5 text-[#7b8781]">
          يدعم XLSX وXLS وCSV. بعد الرفع ستراجع الجداول والسياق ومعاني الأعمدة قبل كتابة أي وحدة في قاعدة البيانات.
        </p>
      </div>
    </button>
  );
}
function Assistant({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-[#e0e4df] bg-[#fafaf7] px-3 py-2.5" dir="rtl">
      <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#e8f0ec] text-forest"><Sparkles size={13}/></div>
      <p className="text-xs leading-6 text-[#5f6d67]">{text}</p>
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
  const [createLocationType, setCreateLocationType] = useState("AREA");
  const [createLocationParentId, setCreateLocationParentId] = useState("");
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
    else if (inputType === "LOCATION_SELECT") created = await adminApi.post<{ id: string }>("/locations", { name: createName.trim(), nameAr: createName.trim(), slug, type: createLocationType, parentId: createLocationType === "COUNTRY" ? undefined : createLocationParentId });
    else created = await adminApi.post<{ id: string }>("/catalog/projects", { name: createName.trim(), slug, developerId: createDeveloperId, locationId: createLocationId });
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
        {inputType === "PROJECT_SELECT" && <><select value={createDeveloperId} onChange={(event) => setCreateDeveloperId(event.target.value)} className="h-12 w-full rounded-xl border px-3 text-[16px]"><option value="">اختر المطور</option>{selectorOptions.developers.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select><select value={createLocationId} onChange={(event) => setCreateLocationId(event.target.value)} className="h-12 w-full rounded-xl border px-3 text-[16px]"><option value="">اختر موقع المشروع</option>{selectorOptions.locations.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></>}
        {inputType === "LOCATION_SELECT" && <div className="grid gap-2 sm:grid-cols-2"><select value={createLocationType} onChange={(event) => { setCreateLocationType(event.target.value); if (event.target.value === "COUNTRY") setCreateLocationParentId(""); }} className="h-12 w-full rounded-xl border bg-white px-3 text-[16px]">{["COUNTRY","GOVERNORATE","CITY","AREA","SUBAREA"].map((type) => <option key={type}>{type}</option>)}</select><select disabled={createLocationType === "COUNTRY"} value={createLocationParentId} onChange={(event) => setCreateLocationParentId(event.target.value)} className="h-12 w-full rounded-xl border bg-white px-3 text-[16px] disabled:opacity-40"><option value="">اختر الموقع الأب</option>{selectorOptions.locations.map((option) => <option key={option.id} value={option.id}>{option.name}{option.type ? ` · ${option.type}` : ""}</option>)}</select></div>}
        <button disabled={!createName.trim() || (inputType === "PROJECT_SELECT" && (!createDeveloperId || !createLocationId)) || (inputType === "LOCATION_SELECT" && createLocationType !== "COUNTRY" && !createLocationParentId)} onClick={createEntity} className="rounded-xl bg-forest px-4 py-3 text-[14px] font-bold text-white disabled:opacity-40">حفظ ومتابعة الاستيراد</button>
      </div>}
    </div>;
  }
  if (inputType === "CURRENCY_SELECT") return <TypedSelect value={value} setValue={setValue} submit={submit} placeholder="اختر العملة" options={[['EGP','EGP — جنيه مصري'],['USD','USD — دولار أمريكي'],['EUR','EUR — يورو'],['AED','AED — درهم إماراتي'],['SAR','SAR — ريال سعودي'],['GBP','GBP — جنيه إسترليني'],['QAR','QAR — ريال قطري'],['KWD','KWD — دينار كويتي'],['BHD','BHD — دينار بحريني'],['OMR','OMR — ريال عماني']]} />;
  if (inputType === "WORKBOOK_TABLE_SELECT") return <WorkbookTableAnswer issue={issue} submit={submit} loading={loading}/>;
  if (inputType === "CANONICAL_FIELD_SELECT") {
    const sourceHeaders = issue.options?.sourceHeaders as string[] | undefined;
    const fields = issue.options?.fields as Array<{ value: string; group: string; labelAr: string; labelEn: string }> | undefined;
    if (Boolean(sourceHeaders)) return <ColumnPicker columns={issue.options?.detectedColumns || (sourceHeaders ?? []).map((header: string) => ({ key: header, originalHeader: header, samples: [] }))} submit={submit}/>;
    if (sourceHeaders) return <TypedSelect value={value} setValue={setValue} submit={submit} placeholder="اختر عمود كود الوحدة" options={sourceHeaders.map((header) => [header, header])} />;
    const selected = value || issue.options?.suggestedValue || "";
    return <div className="ms-0 sm:ms-11"><MappingPicker current={selected} fields={fields || []} sourceColumn={String(issue.options?.sourceColumn || issue.field || "column")} disabled={loading} allowCustom onChange={(target) => { setValue(target); submit(target); }}/></div>;
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
              className="rounded-full border px-3 py-1.5 text-[11px] font-bold"
            >
              Leave empty
            </button>
            <button
              onClick={() => submit("EXCLUDE_ROWS")}
              className="rounded-full border px-3 py-1.5 text-[11px] font-bold"
            >
              Exclude affected rows
            </button>
            <button
              onClick={() => submit("CONTACT_SALES")}
              className="rounded-full border px-3 py-1.5 text-[11px] font-bold"
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
      {!!column.samples?.length && <span className="mt-1 block truncate text-[12px] text-[#718078]" dir="auto">عينات: {column.samples.map(String).join(" · ")}</span>}
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
    <label className="block text-[14px] font-bold">مدة السداد بالشهور (إن وُجدت)<input type="number" min={1} max={360} step={1} value={durationMonths} onChange={(event) => setDurationMonths(event.target.value)} placeholder="مثال: 96" className="mt-1 h-12 w-full rounded-xl border px-3 text-[16px]"/></label>
    <label className="block text-[14px] font-bold">نوع القيمة<select value={valueType} onChange={(event) => setValueType(event.target.value)} className="mt-1 h-12 w-full rounded-xl border px-3 text-[16px]"><option value="TOTAL_PRICE">إجمالي سعر الوحدة</option><option value="INSTALLMENT_AMOUNT">قيمة القسط</option><option value="DOWN_PAYMENT_AMOUNT">مبلغ المقدم</option><option value="DOWN_PAYMENT_PERCENT">نسبة المقدم</option><option value="MAINTENANCE_AMOUNT">مبلغ الصيانة</option><option value="MAINTENANCE_PERCENT">نسبة الصيانة</option></select></label>
    <label className="block text-[14px] font-bold">العملة<select value={currency} onChange={(event) => setCurrency(event.target.value)} className="mt-1 h-12 w-full rounded-xl border px-3 text-[16px]"><option value="EGP">EGP — جنيه مصري</option><option value="USD">USD — دولار أمريكي</option><option value="EUR">EUR — يورو</option><option value="AED">AED — درهم إماراتي</option><option value="SAR">SAR — ريال سعودي</option><option value="GBP">GBP — جنيه إسترليني</option><option value="QAR">QAR — ريال قطري</option><option value="KWD">KWD — دينار كويتي</option><option value="BHD">BHD — دينار بحريني</option><option value="OMR">OMR — ريال عماني</option></select></label>
    <button onClick={() => submit({ durationMonths: durationMonths ? Number(durationMonths) : undefined, valueType, currency })} className="rounded-xl bg-forest px-4 py-3 text-[14px] font-bold text-white">اعتماد خطة السداد</button>
  </div>;
}
function ImportPreview({ item }: { item: ImportData }) {
  const preview = item.preview ?? {};
  const sheets = Array.isArray(preview.sheets) ? preview.sheets : [];
  const ready = preview.readyRows ?? preview.valid ?? 0;
  const needsReview = preview.needsReviewRows ?? preview.invalidRows ?? 0;
  const sourceRows = preview.sourceRows ?? sheets.reduce((sum: number, sheet: any) => sum + Number(sheet.sourceRows ?? sheet.rowsFound ?? 0), 0);
  const errorLabel = (entry: any) => {
    const labels: Record<string, string> = { externalUnitId: "معرّف الوحدة", deliveryDate: "تاريخ التسليم", deliveryYears: "مدة التسليم", currency: "العملة", status: "حالة الإتاحة", phase: "المرحلة", project: "المشروع", priceWithCurrency: "السعر والعملة" };
    const codes: Record<string, string> = { MISSING_IDENTITY: "لا يوجد كود وحدة", INVALID_NUMBER: "القيمة ليست رقمًا صالحًا", NEGATIVE_NUMBER: "القيمة السالبة غير مسموحة", INVALID_INTEGER: "يلزم عدد صحيح", INVALID_DATE: "القيمة ليست تاريخًا", INVALID_DURATION: "مدة التسليم غير مفهومة", INVALID_CURRENCY: "عملة غير مدعومة", INVALID_STATUS: "حالة غير معروفة ولا يمكن افتراض أنها متاحة", UNMATCHED_PHASE: "اسم المرحلة لا يطابق مرحلة مسجلة", MISSING_PROJECT: "اسم المشروع مفقود", UNRESOLVED_PROJECT: "المشروع أو مرحلته غير مؤكدين", MISSING_CURRENCY: "العملة غير موجودة", UNSUPPORTED_CURRENCY: "عملة غير مدعومة", INVALID_AMOUNT: "صيغة السعر غير صالحة", NEGATIVE_AMOUNT: "السعر السالب غير مسموح", TOO_MANY_DECIMALS: "دقة السعر أكبر من دقة التخزين" };
    return `${labels[entry.field] || entry.field}: ${codes[entry.code] || entry.code}`;
  };
  return (
    <section className="space-y-4 rounded-2xl border border-[#d9e3dd] bg-[#f5f8f6] p-4 sm:p-5" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="text-base font-black">معاينة قبل الحفظ</h3><p className="mt-1 text-xs leading-5 text-[#68756f]">المصدر لم يتغير. هنا نعرض فقط مدى جاهزية البيانات بعد تفسير الحقول وربطها بالمشروع.</p></div>
        <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${item.workflow.canConfirm ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-900"}`}>{item.workflow.canConfirm ? "جاهز للاعتماد" : "يوجد قرار يحتاج مراجعة"}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <PreviewMetric value={sourceRows} label="صف مقروء من المصدر" tone="neutral"/>
        <PreviewMetric value={ready} label="جاهز للاستيراد" tone="success"/>
        <PreviewMetric value={needsReview} label="يحتاج قرار" tone={needsReview ? "warning" : "neutral"}/>
        <PreviewMetric value={preview.newUnits ?? 0} label="وحدة جديدة" tone="neutral"/>
      </div>
      {Number(preview.distinctProjects ?? 0) > 0 && <div className="flex flex-wrap gap-2 text-xs font-bold"><span className="rounded-full border bg-white px-3 py-1.5">المشاريع المميزة: {preview.distinctProjects}</span><span className={`rounded-full px-3 py-1.5 ${preview.unresolvedProjects ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}>غير محلولة: {preview.unresolvedProjects || 0}</span></div>}
      {sheets.map((sheet: any) => (
        <details key={sheet.sheetId} className="rounded-xl border bg-white p-3" open={Number(sheet.needsReviewRows ?? sheet.invalidRows ?? 0) > 0}>
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
            <span><b dir="auto">{sheet.sheetName}</b><small className="mt-1 block text-[#748079]">{sheet.sourceRows ?? sheet.rowsFound} صف في المصدر</small></span>
            <span className="flex flex-wrap gap-2 text-[11px] font-bold"><span className="rounded-full bg-[#eaf4ee] px-2.5 py-1 text-green-800">جاهز {sheet.readyRows ?? sheet.valid ?? 0}</span>{Number(sheet.needsReviewRows ?? sheet.invalidRows ?? 0) > 0 && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-900">يحتاج قرار {sheet.needsReviewRows ?? sheet.invalidRows}</span>}{Number(sheet.duplicates ?? 0) > 0 && <span className="rounded-full bg-red-50 px-2.5 py-1 text-red-700">مكرر {sheet.duplicates}</span>}</span>
          </summary>
          {!!sheet.mappingAdjustments?.length && <div className="mt-3 space-y-2">{sheet.mappingAdjustments.map((adjustment: any, index: number) => <div key={`${adjustment.sourceKey}-${index}`} className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-950"><b dir="auto">{adjustment.sourceColumn}</b> تم فهم قيمه كـ <b>{adjustment.effectiveField === "deliveryYears" ? "مدة تسليم بالسنوات" : adjustment.effectiveField}</b> بدل تفسيرها كتاريخ ثابت.</div>)}</div>}
          {sheet.appliedDefaultStatus && <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-950">الحالة الافتراضية المؤكدة والمطبقة: {sheet.appliedDefaultStatus}</p>}
          {!!sheet.validationSummary?.length && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-black text-amber-950">المطلوب لتصبح كل الصفوف جاهزة</p><div className="mt-2 space-y-2">{sheet.validationSummary.map((entry: any) => <div key={`${entry.field}-${entry.code}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/80 px-3 py-2 text-xs"><span><b>{errorLabel(entry)}</b>{entry.sampleRows?.length ? <small className="mt-1 block text-[#7b817e]">أمثلة صفوف: {entry.sampleRows.join("، ")}</small> : null}</span><span className="rounded-full bg-amber-100 px-2 py-1 font-black">{entry.count} صف</span></div>)}</div></div>}
          {!!sheet.normalizedRows?.length && <details className="mt-3 rounded-xl border"><summary className="cursor-pointer px-3 py-2 text-xs font-bold">عرض عينة البيانات بعد التفسير</summary><div className="overflow-x-auto border-t"><table className="min-w-full text-xs"><thead><tr>{Object.keys(sheet.normalizedRows[0]).map((key) => <th key={key} className="whitespace-nowrap border-e p-2 text-start" dir="auto">{key}</th>)}</tr></thead><tbody>{sheet.normalizedRows.slice(0,5).map((row: Record<string, unknown>, index: number) => <tr key={index}>{Object.keys(sheet.normalizedRows[0]).map((key) => <td key={key} className="max-w-48 truncate border-e border-t p-2" dir="auto">{row[key] == null ? "—" : String(row[key])}</td>)}</tr>)}</tbody></table></div></details>}
        </details>
      ))}
      {!item.workflow.canConfirm && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950">لن يتم إسقاط الصفوف أو حذفها. أصلح القرار الموضح أعلاه ثم أعد المعاينة؛ زر الاعتماد يفتح فقط عندما تصبح البيانات قابلة للحفظ بأمان.</p>}
    </section>
  );
}

function PreviewMetric({ value, label, tone }: { value: number; label: string; tone: "neutral" | "success" | "warning" }) {
  const className = tone === "success" ? "border-emerald-200 bg-emerald-50" : tone === "warning" ? "border-amber-200 bg-amber-50" : "border-[#e1e4df] bg-white";
  return <div className={`rounded-xl border p-3 ${className}`}><b className="text-lg">{value}</b><span className="mt-1 block text-xs text-[#68756f]">{label}</span></div>;
}

function StepBar({ workflow }: { workflow: ImportWorkflow }) {
  return (
    <ol className="grid grid-cols-2 gap-2 rounded-2xl border bg-white p-2 sm:grid-cols-4" dir="rtl" aria-label="مراحل الاستيراد">
      {IMPORT_STEPS.map((label, index) => {
        const state = importStepState(workflow, index);
        return <li key={label} aria-current={state.active ? "step" : undefined} className={`flex min-h-14 items-center gap-3 rounded-xl px-3 py-2 ${state.active ? "bg-[#eef4f0] ring-1 ring-forest/20" : state.complete ? "bg-[#f7f8f5]" : "bg-white"}`}>
          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-black ${state.complete ? "bg-forest text-white" : state.active ? "border-2 border-forest bg-white text-forest" : "bg-[#efeee9] text-[#8a928e]"}`}>{state.complete ? <Check size={14}/> : state.count > 0 ? state.count : index + 1}</span>
          <span className="min-w-0"><b className="block text-xs">{label}</b><small className="mt-0.5 block text-[10px] text-[#7a8580]">{state.complete ? "مكتمل" : state.active ? "الخطوة الحالية" : "لاحقًا"}</small></span>
        </li>;
      })}
    </ol>
  );
}
function Analysis({ item }: { item: ImportData }) {
  const mappedFields = item.sheets?.length ? item.sheets.reduce((count, sheet) => count + Object.keys(sheet.mappings || {}).length, 0) : Object.keys(item.analysis?.mappings || {}).length;
  return (
    <div className="rounded-[18px] border bg-white p-4" dir="rtl">
      <p className="text-[12px] font-bold">المصدر</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {[[item.rowsDetected, "صف مقروء"], [mappedFields, "حقل مفسر"], [item.sheets?.length || item.analysis?.sheets?.length || 1, "جدول"]].map(([n, l]) => <div key={String(l)} className="rounded-xl bg-[#f4f3ee] px-3 py-2.5"><p className="text-[15px] font-black">{n}</p><p className="text-[10px] text-[#8b958f]">{l}</p></div>)}
      </div>
    </div>
  );
}
const FALLBACK_FIELD_LABELS: Record<string, string> = {
  __METADATA__: "معلومة إضافية بالاسم الأصلي",
  __IGNORE__: "تجاهل العمود",
  METADATA: "معلومة إضافية بالاسم الأصلي",
  IGNORE: "تجاهل العمود",
};

function slugifyAdmin(value: string) {
  return value.trim().toLowerCase().normalize("NFKD").replace(/[^a-z0-9\u0600-\u06ff]+/g, "-").replace(/^-|-$/g, "").slice(0, 120) || `item-${Date.now()}`;
}

function DeferredTextField({ value, placeholder, disabled, onCommit }: { value?: string | null; placeholder?: string; disabled?: boolean; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);
  const commit = () => {
    const next = draft.trim();
    if (next !== (value ?? "").trim()) onCommit(next);
  };
  return <input
    value={draft}
    disabled={disabled}
    onChange={(event) => setDraft(event.target.value)}
    onBlur={commit}
    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
    placeholder={placeholder}
    className="mt-1 h-11 w-full rounded-xl border bg-white px-3 text-sm disabled:opacity-40"
  />;
}

function MappingPicker({ current, fields, sourceColumn, disabled, allowCustom, onChange }: { current?: string; fields: CanonicalFieldOption[]; sourceColumn: string; disabled?: boolean; allowCustom: boolean; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const normalized = search.trim().toLocaleLowerCase("ar");
  const currentField = fields.find((field) => field.value === current);
  const customLabel = current?.startsWith("META:") ? current.slice(5) : undefined;
  const label = currentField?.labelAr || customLabel || FALLBACK_FIELD_LABELS[current || ""] || "حدد معنى العمود";
  const filtered = fields.filter((field) => {
    if (!normalized) return true;
    const haystack = [field.value, field.labelAr, field.labelEn, field.group, ...(field.keywords || [])].join(" ").toLocaleLowerCase("ar");
    return haystack.includes(normalized);
  }).slice(0, 240);
  const groups = [...new Set(filtered.map((field) => field.group))];
  const custom = search.trim().replace(/^META:/i, "").slice(0, 120);
  const storageLabel = (storage?: CanonicalFieldOption["storage"]) => storage === "METADATA" ? "معلومة" : storage === "CONTEXT" ? "سياق" : storage === "COMPOSITE" ? "مركب" : "أساسي";
  return <div className="relative">
    <button type="button" disabled={disabled} onClick={() => setOpen((value) => !value)} className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border bg-white px-3 text-start text-sm disabled:opacity-40">
      <span className="min-w-0"><b className="block truncate">{label}</b>{currentField && <small className="block truncate text-[#7a8680]">{currentField.group} · {currentField.labelEn}</small>}{customLabel && <small className="block text-[#7a8680]">حقل مخصص محفوظ في بيانات الوحدة</small>}</span><ChevronDown size={15}/>
    </button>
    {open && <div className="absolute start-0 top-[calc(100%+6px)] z-40 w-[min(520px,90vw)] rounded-2xl border bg-white p-3 shadow-2xl">
      <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="اكتب: مساحة، سعر متر، إطلالة، إيجار، ترخيص…" className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-forest" />
      <div className="mt-2 max-h-72 overflow-y-auto rounded-xl border">
        {groups.map((group) => <div key={group} className="border-b last:border-0"><p className="sticky top-0 bg-[#f5f6f3] px-3 py-2 text-[11px] font-black text-[#66736d]">{group}</p>{filtered.filter((field) => field.group === group).map((field) => <button key={field.value} type="button" onClick={() => { onChange(field.value); setOpen(false); setSearch(""); }} className="flex w-full items-center justify-between gap-3 border-t px-3 py-2.5 text-start hover:bg-[#f7faf8]"><span><b className="block text-sm">{field.labelAr}</b><small className="text-[#78847e]">{field.labelEn}</small></span><small className="shrink-0 rounded-full bg-[#edf2ef] px-2 py-1">{storageLabel(field.storage)}</small></button>)}</div>)}
        {!filtered.length && <p className="p-4 text-center text-xs text-[#78847e]">لا يوجد حقل مسجل بهذا الاسم.</p>}
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={() => { onChange("METADATA"); setOpen(false); setSearch(""); }} className="rounded-xl border border-dashed px-3 py-2.5 text-xs font-bold">احتفظ به كمعلومة إضافية باسم العمود الأصلي</button>
        <button type="button" onClick={() => { onChange("IGNORE"); setOpen(false); setSearch(""); }} className="rounded-xl border px-3 py-2.5 text-xs font-bold text-[#7b4b45]">تجاهل هذا العمود</button>
      </div>
      {allowCustom && custom && !filtered.some((field) => field.labelAr === custom || field.labelEn.toLowerCase() === custom.toLowerCase()) && <button type="button" onClick={() => { onChange(`META:${custom}`); setOpen(false); setSearch(""); }} className="mt-2 w-full rounded-xl bg-forest px-3 py-3 text-sm font-black text-white">+ احفظ «{custom}» كحقل مخصص</button>}
      <p className="mt-2 text-[11px] leading-5 text-[#7a8680]">مش لازم تدور في قائمة طويلة: اكتب أي كلمة. لو المعلومة غير موجودة في القاموس العقاري احفظها كحقل مخصص ولن تُفقد من الاستيراد.</p>
    </div>}
  </div>;
}

function SheetReview({ item, selectorOptions, canonicalFields, updateSheet, markAllInventory, updateMapping, mapPhaseValue, mapProjectValue, loading }: { item: ImportData; selectorOptions: Record<string, SelectorItem[]>; canonicalFields: CanonicalFieldOption[]; updateSheet: (id: string, data: Record<string, unknown>) => void; markAllInventory: () => void; updateMapping: (id: string, column: string, target: string) => void; mapPhaseValue: (id:string, sourceValue:string, phaseId:string) => void; mapProjectValue: (id:string, sourceValue:string, projectId:string, phaseId:string) => void; loading: boolean }) {
  const imported = item.sheets.filter((sheet) => sheet.action === "IMPORT").length;
  const [projects, setProjects] = useState<SelectorItem[]>(selectorOptions.projects || []);
  const [developers, setDevelopers] = useState<SelectorItem[]>(selectorOptions.developers || []);
  const [locations, setLocations] = useState<SelectorItem[]>(selectorOptions.locations || []);
  const [phasesByProject, setPhasesByProject] = useState<Record<string, Array<{ id: string; name: string; code?: string | null }>>>({});
  const [projectSearch, setProjectSearch] = useState<Record<string, string>>({});
  const [createForSheet, setCreateForSheet] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [newDeveloperId, setNewDeveloperId] = useState("");
  const [newDeveloperName, setNewDeveloperName] = useState("");
  const [newLocationId, setNewLocationId] = useState("");
  const [showNewLocation, setShowNewLocation] = useState(false);
  const [newLocationName, setNewLocationName] = useState("");
  const [newLocationType, setNewLocationType] = useState("AREA");
  const [newLocationParentId, setNewLocationParentId] = useState("");
  const [locationTargetSheetId, setLocationTargetSheetId] = useState<string | null>(null);
  const [phaseDraft, setPhaseDraft] = useState<{ sheetId: string; name: string; code: string; deliveryYear: string; sourceValue?: string } | null>(null);
  const [phaseReviews, setPhaseReviews] = useState<Record<string, PhaseValueReview>>({});
  const [projectReviews, setProjectReviews] = useState<Record<string, ProjectValueReview>>({});
  const [projectGroupDrafts, setProjectGroupDrafts] = useState<Record<string, { projectId:string; phaseId:string }>>({});
  const [contextError, setContextError] = useState("");

  useEffect(() => setProjects(selectorOptions.projects || []), [selectorOptions.projects]);
  useEffect(() => setDevelopers(selectorOptions.developers || []), [selectorOptions.developers]);
  useEffect(() => setLocations(selectorOptions.locations || []), [selectorOptions.locations]);
  useEffect(() => {
    const ids = [...new Set(item.sheets.map((sheet) => sheet.projectId).filter(Boolean) as string[])];
    ids.forEach((projectId) => {
      if (phasesByProject[projectId]) return;
      adminApi.get<Array<{ id: string; name: string; code?: string | null }>>(`/real-estate/projects/${projectId}/phases`)
        .then((phases) => setPhasesByProject((current) => ({ ...current, [projectId]: phases })))
        .catch(() => undefined);
    });
  }, [item.sheets, phasesByProject]);
  useEffect(() => {
    let cancelled = false;
    const targets = item.sheets.filter((sheet) => sheet.action === "IMPORT" && sheet.projectId && Object.values(sheet.mappings || {}).includes("phase"));
    Promise.all(targets.map(async (sheet) => {
      try { return [sheet.id, await adminApi.get<PhaseValueReview>(`/imports/${item.id}/sheets/${sheet.id}/phase-values`)] as const; }
      catch { return [sheet.id, null] as const; }
    })).then((entries) => { if (!cancelled) setPhaseReviews(Object.fromEntries(entries.filter((entry): entry is readonly [string, PhaseValueReview] => Boolean(entry[1])))); });
    return () => { cancelled = true; };
  }, [item.id, item.sheets]);
  useEffect(() => {
    let cancelled = false;
    const targets = item.sheets.filter((sheet) => sheet.action === "IMPORT" && Object.values(sheet.mappings || {}).includes("project"));
    Promise.all(targets.map(async (sheet) => {
      try { return [sheet.id, await adminApi.get<ProjectValueReview>(`/imports/${item.id}/sheets/${sheet.id}/project-values`)] as const; }
      catch { return [sheet.id, null] as const; }
    })).then((entries) => { if (!cancelled) setProjectReviews(Object.fromEntries(entries.filter((entry): entry is readonly [string, ProjectValueReview] => Boolean(entry[1])))); });
    return () => { cancelled = true; };
  }, [item.id, item.sheets]);

  async function searchProjects(term: string) {
    const query = term.trim();
    if (query.length < 2) return;
    try {
      const result = await adminApi.get<{ items: SelectorItem[] }>(`/imports/options/selectors?type=projects&search=${encodeURIComponent(query)}&page=1&pageSize=50`);
      setProjects((current) => {
        const merged = new Map(current.map((item) => [item.id, item]));
        result.items.forEach((item) => merged.set(item.id, item));
        return [...merged.values()];
      });
    } catch { /* local results remain available */ }
  }

  async function createPhase(sheet: ImportSheetData) {
    if (!sheet.projectId || !phaseDraft || phaseDraft.sheetId !== sheet.id || !phaseDraft.name.trim()) return;
    try {
      setContextError("");
      const deliveryYear = phaseDraft.deliveryYear ? Number(phaseDraft.deliveryYear) : undefined;
      const phase = await adminApi.post<{ id: string; name: string; code?: string | null }>(`/real-estate/projects/${sheet.projectId}/phases`, {
        name: phaseDraft.name.trim(),
        nameAr: phaseDraft.name.trim(),
        code: phaseDraft.code.trim() || undefined,
        deliveryYear: Number.isInteger(deliveryYear) ? deliveryYear : undefined,
      });
      setPhasesByProject((current) => ({ ...current, [sheet.projectId!]: [...(current[sheet.projectId!] || []), phase] }));
      const sourceValue = phaseDraft.sourceValue;
      setPhaseDraft(null);
      if (sourceValue) mapPhaseValue(sheet.id, sourceValue, phase.id);
      else updateSheet(sheet.id, { phaseId: phase.id });
    } catch (error) { setContextError(adminErrorMessage(error)); }
  }

  async function createDeveloperInline() {
    if (!newDeveloperName.trim()) return;
    try {
      setContextError("");
      const created = await adminApi.post<SelectorItem>("/catalog/developers", { name: newDeveloperName.trim(), slug: slugifyAdmin(`${newDeveloperName}-${Date.now()}`) });
      setDevelopers((items) => [...items.filter((item) => item.id !== created.id), created]);
      setNewDeveloperId(created.id); setNewDeveloperName("");
    } catch (error) { setContextError(adminErrorMessage(error)); }
  }

  async function createLocationInline() {
    if (!newLocationName.trim() || (newLocationType !== "COUNTRY" && !newLocationParentId)) return;
    try {
      setContextError("");
      const created = await adminApi.post<SelectorItem>("/locations", { name: newLocationName.trim(), nameAr: newLocationName.trim(), slug: slugifyAdmin(`${newLocationName}-${Date.now()}`), type: newLocationType, parentId: newLocationType === "COUNTRY" ? undefined : newLocationParentId });
      setLocations((items) => [...items.filter((item) => item.id !== created.id), created]);
      if (locationTargetSheetId) updateSheet(locationTargetSheetId, { locationId: created.id });
      else setNewLocationId(created.id);
      setNewLocationName(""); setShowNewLocation(false); setLocationTargetSheetId(null);
    } catch (error) { setContextError(adminErrorMessage(error)); }
  }

  async function createProjectInline(sheet: ImportSheetData) {
    if (!newProjectName.trim() || !newDeveloperId || !newLocationId) return;
    try {
      setContextError("");
      const created = await adminApi.post<SelectorItem>("/catalog/projects", { name: newProjectName.trim(), slug: slugifyAdmin(`${newProjectName}-${Date.now()}`), developerId: newDeveloperId, locationId: newLocationId });
      const enriched = { ...created, developerId: newDeveloperId, locationId: newLocationId, developer: developers.find((item) => item.id === newDeveloperId) ? { name: developers.find((item) => item.id === newDeveloperId)!.name } : undefined, location: locations.find((item) => item.id === newLocationId) ? { name: locations.find((item) => item.id === newLocationId)!.name } : undefined };
      setProjects((items) => [...items.filter((item) => item.id !== created.id), enriched]);
      setCreateForSheet(null); setNewProjectName("");
      updateSheet(sheet.id, { projectId: created.id, phaseId: null });
    } catch (error) { setContextError(adminErrorMessage(error)); }
  }

  const fieldLabel = (mapping?: string) => {
    if (!mapping) return "يحتاج مراجعة";
    if (mapping.startsWith("META:")) return mapping.slice(5);
    return canonicalFields.find((field) => field.value === mapping)?.labelAr || FALLBACK_FIELD_LABELS[mapping] || mapping;
  };

  return <section className="space-y-3 rounded-2xl border bg-[#fbfaf7] p-4" dir="rtl">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="font-bold">مراجعة الجداول والسياق</h3><p className="mt-1 max-w-3xl text-xs leading-6 text-[#68756f]">كل جدول له مشروع ومرحلة وسياق مستقل. لو المشروع أو المطور أو الموقع أو المرحلة غير موجودين، أنشئهم هنا بدون مغادرة الاستيراد. بعدها راجع الأعمدة بالبحث بدل القوائم الطويلة.</p></div>
      {item.status !== "COMPLETED" && <button type="button" disabled={loading || imported === item.sheets.length} onClick={markAllInventory} className="rounded-xl bg-forest px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40">اعتبر كل الجداول مخزون</button>}
    </div>
    <div className="flex flex-wrap gap-2 text-[11px] font-bold text-[#68756f]"><span className="rounded-full bg-white px-3 py-1.5">{item.sheets.length} جدول</span><span className="rounded-full bg-white px-3 py-1.5">{imported} للاستيراد</span><span className="rounded-full bg-white px-3 py-1.5">{canonicalFields.length || 200}+ حقل عقاري قابل للبحث + حقول مخصصة</span></div>
    {item.sheets.map((sheet) => {
      const phases = sheet.projectId ? phasesByProject[sheet.projectId] || [] : [];
      const usesPhaseColumn = Object.values(sheet.mappings || {}).includes("phase");
      const usesProjectColumn = Object.values(sheet.mappings || {}).includes("project");
      const phaseReview = phaseReviews[sheet.id];
      const projectReview = projectReviews[sheet.id];
      const sheetConfig = sheet.mappingSources?.__sheetConfig as { defaultStatus?: { value?: string; confirmed?: boolean } } | undefined;
      const sheetIssues = item.issues.filter((issue) => issue.field?.startsWith(`sheet:${sheet.id}:`) && !issue.resolvedAt);
      const search = (projectSearch[sheet.id] || "").trim().toLowerCase();
      const visibleProjects = projects.filter((project) => !search || [project.name, project.developer?.name, project.location?.name].filter(Boolean).join(" ").toLowerCase().includes(search)).slice(0, 80);
      const selectedProject = projects.find((project) => project.id === sheet.projectId);
      return <details key={sheet.id} open={sheet.action === "IMPORT"} className="rounded-2xl border bg-white p-3 sm:p-4">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
          <span><span className="flex flex-wrap items-center gap-2"><b dir="auto">{sheet.sheetName}</b>{sheet.defaultIsResale && <small className="rounded-full bg-[#f2eadc] px-2 py-1 font-bold text-[#765b31]">Resale</small>}{sheet.phase?.name && <small className="rounded-full bg-[#e9f2ee] px-2 py-1 font-bold text-forest">{sheet.phase.name}</small>}{sheetIssues.length > 0 && <small className="rounded-full bg-red-50 px-2 py-1 font-bold text-red-700">{sheetIssues.length} مطلوب</small>}</span><small className="mt-1 block text-[#748079]">{sheet.classification} · ثقة {sheet.confidence}% · {sheet.rowsDetected} صف{sheet.tableId ? ` · الصفوف ${sheet.startRow}–${sheet.endRow}` : ""}</small></span>
          <span className="flex rounded-lg border p-1"><button type="button" disabled={loading} onClick={(event) => { event.preventDefault(); updateSheet(sheet.id, { action: "IMPORT" }); }} className={`rounded-md px-3 py-2 text-xs font-bold ${sheet.action === "IMPORT" ? "bg-forest text-white" : ""}`}>استيراد</button><button type="button" disabled={loading} onClick={(event) => { event.preventDefault(); updateSheet(sheet.id, { action: "IGNORE" }); }} className={`rounded-md px-3 py-2 text-xs font-bold ${sheet.action === "IGNORE" ? "bg-[#ece9e1]" : ""}`}>تجاهل</button></span>
        </summary>
        {sheet.action === "IMPORT" && <div className="mt-4 space-y-5 border-t pt-4">
          {sheetIssues.length > 0 && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-black text-amber-950">أكمل هذه النقاط قبل المعاينة</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{sheetIssues.map((issue) => <div key={issue.id} className="rounded-xl bg-white/80 p-3 text-xs"><b>{issue.message}</b><small className="mt-1 block font-bold text-red-700">{issue.severity}</small></div>)}</div></div>}

          <div className="rounded-2xl border bg-[#f7f8f5] p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h4 className="text-sm font-black">1. سياق الجدول</h4><p className="mt-1 text-xs text-[#68756f]">المشروع يحدد المطور والموقع تلقائيًا، والمرحلة تمنع خلط وحدات مراحل مختلفة.</p></div>{selectedProject && <span className="rounded-full bg-white px-3 py-1 text-xs font-bold">{selectedProject.developer?.name || "—"} · {selectedProject.location?.name || "موقع يحتاج تحديد"}</span>}</div>
            {usesProjectColumn && <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><div><b className="text-sm">مشاريع متعددة من عمود {projectReview?.sourceHeader || "Project"}</b><p className="mt-1 text-[11px] leading-5 text-[#68756f]">اربط كل اسم خام بمشروع موجود ومرحلة مؤكدة. المطور والموقع يُشتقان من المشروع ولا يتم تخمينهما.</p></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${projectReview?.unresolvedCount ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}>{projectReview ? `${projectReview.resolvedCount}/${projectReview.uniqueCount} مكتمل` : "جاري قراءة المشاريع…"}</span></div>
              <div className="mt-3 space-y-2">{projectReview?.values.map((value) => {
                const key = `${sheet.id}:${value.normalizedValue}`;
                const draft = projectGroupDrafts[key] || { projectId: value.projectId || value.suggestedProjectId || "", phaseId: value.phaseId || "" };
                const selected = projectReview.projects.find((project) => project.id === draft.projectId);
                return <div key={value.normalizedValue} className={`grid gap-2 rounded-xl border p-3 lg:grid-cols-[minmax(180px,1fr)_minmax(220px,1fr)_minmax(180px,.8fr)] ${value.resolved ? "border-emerald-100 bg-white" : "border-amber-200 bg-amber-50"}`}>
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><b dir="auto">{value.sourceValue}</b><span className="rounded-full bg-[#f1f3ef] px-2 py-0.5 text-[10px] font-bold">{value.count} وحدة</span></div>{value.resolved ? <small className="mt-1 block text-emerald-800">{value.projectName} · {value.phaseName}</small> : value.ambiguousCandidateCount > 1 ? <small className="mt-1 block text-amber-900">أكثر من مشروع مطابق — يلزم اختيار صريح</small> : value.suggestedProjectId ? <small className="mt-1 block text-[#68756f]">يوجد اقتراح مطابق بالاسم، لكنه لن يُعتمد تلقائيًا.</small> : null}</div>
                  <select value={draft.projectId} disabled={loading} onChange={(event) => setProjectGroupDrafts((current) => ({ ...current, [key]: { projectId: event.target.value, phaseId: "" } }))} className="h-11 min-w-0 rounded-xl border bg-white px-2 text-xs"><option value="">اختر المشروع</option>{projectReview.projects.map((project) => <option key={project.id} value={project.id}>{project.name} — {project.developerName}{project.locationName ? ` — ${project.locationName}` : " — بدون موقع"}</option>)}</select>
                  <select value={draft.phaseId} disabled={loading || !selected?.locationId} onChange={(event) => { const phaseId = event.target.value; setProjectGroupDrafts((current) => ({ ...current, [key]: { ...draft, phaseId } })); if (phaseId) mapProjectValue(sheet.id, value.sourceValue, draft.projectId, phaseId); }} className="h-11 min-w-0 rounded-xl border bg-white px-2 text-xs disabled:bg-[#efefec]"><option value="">اختر المرحلة واعتمد</option>{(selected?.phases || []).map((phase) => <option key={phase.id} value={phase.id}>{phase.name}{phase.code ? ` · ${phase.code}` : ""}</option>)}</select>
                </div>;
              })}</div>
            </div>}
            <div className="grid gap-4 md:grid-cols-2">
              {!usesProjectColumn && <><div><label className="text-xs font-bold">المشروع</label><input type="search" value={projectSearch[sheet.id] || ""} onChange={(event) => { const term = event.target.value; setProjectSearch((current) => ({ ...current, [sheet.id]: term })); void searchProjects(term); }} placeholder="ابحث باسم المشروع أو المطور أو المنطقة" className="mt-1 h-11 w-full rounded-xl border bg-white px-3 text-sm"/><select value={sheet.projectId || ""} onChange={(event) => updateSheet(sheet.id, { projectId: event.target.value, phaseId: null })} className="mt-2 h-11 w-full rounded-xl border bg-white px-2 text-sm"><option value="">اختر المشروع</option>{visibleProjects.map((project) => <option key={project.id} value={project.id}>{project.name}{project.developer?.name ? ` — ${project.developer.name}` : ""}{project.location?.name ? ` — ${project.location.name}` : ""}</option>)}</select><button type="button" onClick={() => { setCreateForSheet(createForSheet === sheet.id ? null : sheet.id); setContextError(""); }} className="mt-2 text-xs font-black text-forest">+ المشروع غير موجود؟ أنشئه هنا</button></div>
              <div>
                <label className="text-xs font-bold">توزيع المراحل</label>
                {usesPhaseColumn ? <div className="mt-1 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2"><div><b className="text-sm">من عمود {phaseReview?.sourceHeader || "Phase"}</b><p className="mt-1 text-[11px] text-[#68756f]">كل قيمة فريدة تربطها مرة واحدة بمرحلة المشروع، ثم تُحفظ كـ Alias للاستيرادات القادمة.</p></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${phaseReview?.unmatchedCount ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}>{phaseReview ? `${phaseReview.matchedCount}/${phaseReview.uniqueCount} مطابق` : "جاري قراءة المراحل…"}</span></div>
                  {phaseReview?.values?.length ? <div className="mt-3 space-y-2">{phaseReview.values.map((value) => <div key={value.normalizedValue} className={`grid gap-2 rounded-xl border p-2.5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(180px,240px)] sm:items-center ${value.matched ? "border-emerald-100 bg-white" : "border-amber-200 bg-amber-50"}`}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><b dir="auto">{value.sourceValue}</b><span className="rounded-full bg-[#f1f3ef] px-2 py-0.5 text-[10px] font-bold">{value.count} وحدة</span></div>{value.matched && <small className="mt-1 block text-emerald-800">→ {value.phaseName}{value.phaseCode ? ` · ${value.phaseCode}` : ""}{value.matchSource === "ALIAS" ? " · Alias محفوظ" : ""}</small>}</div><button type="button" disabled={!sheet.projectId || loading} onClick={() => setPhaseDraft({ sheetId: sheet.id, name: value.sourceValue, code: "", deliveryYear: "", sourceValue: value.sourceValue })} className="rounded-lg border bg-white px-2.5 py-2 text-[11px] font-black text-forest">+ مرحلة جديدة</button><select disabled={loading} value={value.phaseId || ""} onChange={(event) => event.target.value && mapPhaseValue(sheet.id, value.sourceValue, event.target.value)} className="h-10 min-w-0 rounded-lg border bg-white px-2 text-xs"><option value="">{value.matched ? "تغيير الربط" : "اختر المرحلة"}</option>{phases.map((phase) => <option key={phase.id} value={phase.id}>{phase.name}{phase.code ? ` · ${phase.code}` : ""}</option>)}</select></div>)}</div> : phaseReview && <p className="mt-3 text-xs font-bold text-amber-800">لم نجد قيماً غير فارغة في عمود المرحلة.</p>}
                </div> : <div className="mt-1 flex gap-1"><select disabled={!sheet.projectId} value={sheet.phaseId || ""} onChange={(event) => updateSheet(sheet.id, { phaseId: event.target.value || null })} className="h-11 min-w-0 flex-1 rounded-xl border bg-white px-2 text-sm disabled:bg-[#efefec]"><option value="">مرحلة واحدة لكل الجدول</option>{phases.map((phase) => <option key={phase.id} value={phase.id}>{phase.name}{phase.code ? ` · ${phase.code}` : ""}</option>)}</select><button type="button" disabled={!sheet.projectId || loading} onClick={() => setPhaseDraft((current) => current?.sheetId === sheet.id ? null : { sheetId: sheet.id, name: "", code: "", deliveryYear: "" })} className="h-11 rounded-xl border bg-white px-3 text-lg font-bold text-forest disabled:opacity-40" title="إنشاء مرحلة جديدة">+</button></div>}
                {phaseDraft?.sheetId === sheet.id && <div className="mt-2 grid gap-2 rounded-xl border border-dashed bg-white p-2"><div className="flex items-center justify-between gap-2"><b className="text-xs">{phaseDraft.sourceValue ? `إنشاء مرحلة للقيمة «${phaseDraft.sourceValue}»` : "إنشاء مرحلة جديدة"}</b><button type="button" onClick={() => setPhaseDraft(null)}><X size={14}/></button></div><input autoFocus value={phaseDraft.name} onChange={(event) => setPhaseDraft({ ...phaseDraft, name: event.target.value })} placeholder="اسم المرحلة" className="h-10 rounded-lg border px-2 text-sm"/><div className="grid grid-cols-2 gap-2"><input value={phaseDraft.code} onChange={(event) => setPhaseDraft({ ...phaseDraft, code: event.target.value })} placeholder="كود المرحلة — اختياري" className="h-10 rounded-lg border px-2 text-sm"/><input type="number" min={1900} max={2200} value={phaseDraft.deliveryYear} onChange={(event) => setPhaseDraft({ ...phaseDraft, deliveryYear: event.target.value })} placeholder="سنة التسليم" className="h-10 rounded-lg border px-2 text-sm"/></div><button type="button" disabled={!phaseDraft.name.trim() || loading} onClick={() => createPhase(sheet)} className="h-10 rounded-lg bg-forest px-3 text-xs font-black text-white disabled:opacity-40">{phaseDraft.sourceValue ? "إنشاء وربط هذه القيمة" : "إنشاء المرحلة وربط الجدول"}</button></div>}
              </div></>}
              <label className="text-xs font-bold">العملة<select value={sheet.defaultCurrency || ""} onChange={(event) => updateSheet(sheet.id, { defaultCurrency: event.target.value })} className="mt-1 h-11 w-full rounded-xl border bg-white px-2 text-sm"><option value="">من الملف</option>{["EGP","USD","EUR","AED","SAR","GBP","QAR","KWD","BHD","OMR"].map((value) => <option key={value}>{value}</option>)}</select></label>
              <label className="text-xs font-bold">السوق<button type="button" disabled={loading} onClick={() => updateSheet(sheet.id, { defaultIsResale: !sheet.defaultIsResale })} className={`mt-1 flex h-11 w-full items-center justify-between rounded-xl border px-3 text-sm ${sheet.defaultIsResale ? "border-[#b08c52] bg-[#f7f0e5] text-[#71562e]" : "bg-white"}`}><span>{sheet.defaultIsResale ? "Resale" : "Primary"}</span><span className={`h-5 w-9 rounded-full p-0.5 ${sheet.defaultIsResale ? "bg-[#b08c52]" : "bg-[#d9dfdc]"}`}><span className={`block h-4 w-4 rounded-full bg-white transition ${sheet.defaultIsResale ? "translate-x-0" : "-translate-x-4"}`}/></span></button></label>
              {(usesProjectColumn || Object.values(sheet.mappings || {}).includes("priceWithCurrency")) && !Object.values(sheet.mappings || {}).includes("status") && <label className="text-xs font-bold md:col-span-2">الحالة الافتراضية المؤكدة<select value={sheetConfig?.defaultStatus?.confirmed ? sheetConfig.defaultStatus.value || "" : ""} onChange={(event) => updateSheet(sheet.id, { defaultStatus: event.target.value })} className="mt-1 h-11 w-full rounded-xl border border-amber-300 bg-white px-2 text-sm"><option value="">يلزم تأكيد الحالة</option>{["AVAILABLE","RESERVED","SOLD","UNAVAILABLE","CONTACT_SALES"].map((value) => <option key={value} value={value}>{value === "AVAILABLE" ? "متاحة" : value}</option>)}</select><small className="mt-1 block font-normal leading-5 text-[#7a6a48]">لن تُفترض «متاحة» تلقائيًا. الاختيار يُسجّل كقرار Admin ويظهر في المعاينة والمصدر.</small></label>}
            </div>
            {sheet.projectId && !selectedProject?.locationId && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3"><div className="flex flex-wrap items-end gap-2"><label className="min-w-[220px] flex-1 text-xs font-black text-amber-950">هذا المشروع لا يملك موقعاً بعد — اختر موقعه الآن<select value={sheet.locationId || ""} onChange={(event) => updateSheet(sheet.id, { locationId: event.target.value })} className="mt-2 h-11 w-full rounded-xl border bg-white px-2 text-sm text-ink"><option value="">اختر موقع المشروع</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}{location.parent?.name ? ` — ${location.parent.name}` : ""}</option>)}</select></label><button type="button" onClick={() => { setLocationTargetSheetId(sheet.id); setShowNewLocation(true); setContextError(""); }} className="h-11 rounded-xl border border-amber-300 bg-white px-3 text-xs font-black text-forest">+ إنشاء موقع</button></div><p className="mt-2 text-[11px] leading-5 text-amber-900">الحفظ هنا يربط الموقع بالمشروع نفسه وبالجدول، لذلك لن يتكرر السؤال في الاستيرادات التالية.</p>{showNewLocation && locationTargetSheetId === sheet.id && <div className="mt-3 grid gap-2 rounded-xl bg-white p-3 sm:grid-cols-4"><input value={newLocationName} onChange={(event) => setNewLocationName(event.target.value)} placeholder="اسم الموقع" className="h-10 rounded-xl border px-2 text-sm"/><select value={newLocationType} onChange={(event) => { setNewLocationType(event.target.value); if (event.target.value === "COUNTRY") setNewLocationParentId(""); }} className="h-10 rounded-xl border bg-white px-2 text-sm">{["COUNTRY","GOVERNORATE","CITY","AREA","SUBAREA"].map((type) => <option key={type}>{type}</option>)}</select><select disabled={newLocationType === "COUNTRY"} value={newLocationParentId} onChange={(event) => setNewLocationParentId(event.target.value)} className="h-10 rounded-xl border bg-white px-2 text-sm disabled:opacity-40"><option value="">الموقع الأب</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name} · {location.type}</option>)}</select><button type="button" disabled={!newLocationName.trim() || (newLocationType !== "COUNTRY" && !newLocationParentId)} onClick={createLocationInline} className="rounded-xl bg-forest px-3 text-xs font-black text-white disabled:opacity-40">إنشاء وربط</button></div>}</div>}
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-xs font-bold">نوع افتراضي عند غياب العمود<DeferredTextField value={sheet.defaultUnitType} disabled={loading} onCommit={(value) => updateSheet(sheet.id, { defaultUnitType: value || null })} placeholder="مثال: Apartment / Villa / Office" /></label>
              <label className="text-xs font-bold">صف العناوين<div className="mt-1 flex gap-1"><input id={`header-${sheet.id}`} type="number" min="1" defaultValue={sheet.headerRow || 1} className="h-11 min-w-0 flex-1 rounded-xl border bg-white px-2 text-sm"/><button type="button" onClick={() => { const input = document.getElementById(`header-${sheet.id}`) as HTMLInputElement; updateSheet(sheet.id, { headerRow: Number(input.value) }); }} className="rounded-xl border bg-white px-3">تطبيق</button></div></label>
            </div>

            {createForSheet === sheet.id && <div className="mt-4 rounded-2xl border border-dashed bg-white p-4">
              <div className="flex items-center justify-between"><b>إنشاء مشروع وربطه بهذا الجدول</b><button type="button" onClick={() => setCreateForSheet(null)}><X size={16}/></button></div>{contextError && <p className="mt-2 rounded-xl bg-red-50 p-2 text-xs text-red-700">{contextError}</p>}
              <div className="mt-3 grid gap-3 md:grid-cols-3"><label className="text-xs font-bold">اسم المشروع<input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} className="mt-1 h-11 w-full rounded-xl border px-3 text-sm" placeholder="اسم المشروع"/></label><label className="text-xs font-bold">المطور<select value={newDeveloperId} onChange={(event) => setNewDeveloperId(event.target.value)} className="mt-1 h-11 w-full rounded-xl border bg-white px-2 text-sm"><option value="">اختر المطور</option>{developers.map((developer) => <option key={developer.id} value={developer.id}>{developer.name}</option>)}</select></label><label className="text-xs font-bold">موقع المشروع<select value={newLocationId} onChange={(event) => setNewLocationId(event.target.value)} className="mt-1 h-11 w-full rounded-xl border bg-white px-2 text-sm"><option value="">اختر الموقع</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}{location.parent?.name ? ` — ${location.parent.name}` : ""}</option>)}</select></label></div>
              <div className="mt-2 grid gap-2 md:grid-cols-2"><div className="flex gap-2"><input value={newDeveloperName} onChange={(event) => setNewDeveloperName(event.target.value)} placeholder="مطور غير موجود؟ اكتب اسمه" className="h-10 min-w-0 flex-1 rounded-xl border px-3 text-sm"/><button type="button" disabled={!newDeveloperName.trim()} onClick={createDeveloperInline} className="rounded-xl border px-3 text-xs font-black disabled:opacity-40">إضافة المطور</button></div><button type="button" onClick={() => { setLocationTargetSheetId(null); setShowNewLocation((value) => !value); }} className="h-10 rounded-xl border border-dashed px-3 text-xs font-black">+ الموقع غير موجود؟</button></div>
              {showNewLocation && <div className="mt-2 grid gap-2 rounded-xl bg-[#f7f8f5] p-3 sm:grid-cols-4"><input value={newLocationName} onChange={(event) => setNewLocationName(event.target.value)} placeholder="اسم الموقع" className="h-10 rounded-xl border px-2 text-sm"/><select value={newLocationType} onChange={(event) => { setNewLocationType(event.target.value); if (event.target.value === "COUNTRY") setNewLocationParentId(""); }} className="h-10 rounded-xl border bg-white px-2 text-sm">{["COUNTRY","GOVERNORATE","CITY","AREA","SUBAREA"].map((type) => <option key={type}>{type}</option>)}</select><select disabled={newLocationType === "COUNTRY"} value={newLocationParentId} onChange={(event) => setNewLocationParentId(event.target.value)} className="h-10 rounded-xl border bg-white px-2 text-sm disabled:opacity-40"><option value="">الموقع الأب</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name} · {location.type}</option>)}</select><button type="button" disabled={!newLocationName.trim() || (newLocationType !== "COUNTRY" && !newLocationParentId)} onClick={createLocationInline} className="rounded-xl border bg-white px-3 text-xs font-black disabled:opacity-40">إضافة الموقع</button></div>}
              <button type="button" disabled={!newProjectName.trim() || !newDeveloperId || !newLocationId} onClick={() => createProjectInline(sheet)} className="mt-3 h-11 rounded-xl bg-forest px-5 text-sm font-black text-white disabled:opacity-40">إنشاء المشروع وربطه بالجدول</button>
            </div>}
          </div>

          <details className="rounded-2xl border bg-white p-3 sm:p-4"><summary className="cursor-pointer list-none"><div className="flex items-center justify-between gap-2"><div><h4 className="text-sm font-black">2. عينة المصدر</h4><p className="mt-1 text-xs text-[#68756f]">الملف مقروء كما هو. افتح العينة فقط إذا أردت مراجعة صف العناوين والقيم الأصلية.</p></div><span className="rounded-full bg-[#f1f3ef] px-3 py-1 text-[11px] font-bold">{sheet.rowsDetected} صف</span></div></summary><div className="mt-3 overflow-x-auto rounded-xl border"><table className="min-w-full text-xs"><thead className="bg-[#f5f6f3]"><tr>{(sheet.columns || []).map((column) => <th key={column.key} className="whitespace-nowrap border-e p-2 text-start" dir="auto">{column.originalHeader}</th>)}</tr></thead><tbody>{(sheet.sourcePreview || []).slice(0, 5).map((row, index) => <tr key={index}>{(sheet.columns || []).map((column) => <td key={column.key} className="max-w-44 truncate border-e border-t p-2" dir="auto">{row[column.key] == null ? "—" : String(row[column.key])}</td>)}</tr>)}</tbody></table></div></details>

          <details className="rounded-2xl border bg-white p-3 sm:p-4" open={sheetIssues.some((entry) => entry.field?.includes(":column:") || entry.field?.includes(":mapping:"))}><summary className="cursor-pointer list-none"><div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="text-sm font-black">3. معاني الأعمدة</h4><p className="mt-1 text-xs leading-5 text-[#68756f]">راجع فقط ما تحتاجه. البحث يقبل العربي والإنجليزي، ويمكن حفظ أي عمود غير معتاد كمعلومة مخصصة.</p></div><span className="rounded-full bg-[#f1f3ef] px-3 py-1 text-[11px] font-bold">{Object.keys(sheet.mappings || {}).length}/{(sheet.columns || []).length} محدد</span></div></summary><div className="mt-4 space-y-2">{(sheet.columns || []).map((column) => { const mapping = sheet.mappings?.[column.key]; return <div key={column.key} className="grid gap-3 rounded-xl border p-3 lg:grid-cols-[minmax(0,1fr)_minmax(300px,1fr)]"><div className="min-w-0"><b dir="auto">{column.originalHeader}</b><small className="mt-1 block truncate text-[#748079]" dir="auto">{(column.samples || []).map(String).join(" · ") || "لا توجد عينات"}</small><small className="mt-1 block text-[10px] text-[#8a948f]">{mapping ? `${fieldLabel(mapping)} · ${String(sheet.mappingSources?.[column.key] || "محدد")}` : "يحتاج تحديد"}</small></div><MappingPicker current={mapping} fields={canonicalFields} sourceColumn={column.key} disabled={loading} allowCustom={item.status !== "COMPLETED"} onChange={(target) => updateMapping(sheet.id, column.key, target)}/></div>; })}</div></details>
          {sheet.previewMappingVersion != null && sheet.previewMappingVersion !== sheet.mappingVersion && <p className="rounded-lg bg-amber-50 p-3 text-xs font-bold text-amber-800">تم تعديل سياق أو تفسير الجدول. أنشئ المعاينة مرة أخرى قبل الاعتماد.</p>}
        </div>}
      </details>;
    })}
  </section>;
}

function WorkbookReview({ item, chooseTable, loading }: { item: ImportData; chooseTable: (sheetName: string, headerRow: number) => void; loading: boolean }) {
  const analysis = item.analysis?.workbookAnalysis;
  const selected = item.analysis?.selectedTable;
  const [manualSheet, setManualSheet] = useState(analysis?.selectedSheet || analysis?.sheets?.[0]?.name || "");
  const [manualHeader, setManualHeader] = useState(String(selected?.headerRow || 1));
  if (!analysis?.sheets?.length) return null;
  return <details open className="rounded-2xl border bg-white p-4" dir="rtl"><summary className="cursor-pointer text-[14px] font-bold">تحليل صفحات الملف — {analysis.sheets.length} صفحات</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">{analysis.sheets.map((sheet:any) => <div key={sheet.name} className={`rounded-xl border p-3 ${analysis.selectedSheet === sheet.name ? "border-forest bg-[#f0f7f3]" : "bg-[#fbfaf7]"}`}><div className="flex items-start justify-between gap-2"><div><p className="font-bold" dir="auto">{sheet.name}</p><p className="mt-1 text-[12px] text-[#68756f]">{sheet.rowCount} صف · {sheet.columnCount} عمود</p></div><span className="rounded-full bg-white px-2 py-1 text-[11px] font-bold">{sheet.classification} · {sheet.confidence}%</span></div>{sheet.candidateTables?.[0] && <><p className="mt-2 text-[12px]">صف العناوين {sheet.candidateTables[0].headerRow} · صفوف البيانات {sheet.candidateTables[0].dataRowCount}</p><button disabled={loading || analysis.selectedTableId === sheet.candidateTables[0].id} onClick={() => chooseTable(sheet.name, sheet.candidateTables[0].headerRow)} className="mt-2 rounded-lg border px-3 py-2 text-[12px] font-bold disabled:opacity-40">{analysis.selectedTableId === sheet.candidateTables[0].id ? "محدد" : "استخدم هذا الجدول"}</button></>}{!sheet.candidateTables?.length && <p className="mt-2 text-[12px] text-[#8f5b35]">لم يتم اكتشاف جدول واضح · سيتم تجاهله افتراضيًا</p>}</div>)}</div><div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-dashed p-3"><label className="text-[12px] font-bold">اختيار صفحة يدويًا<select value={manualSheet} onChange={(event) => setManualSheet(event.target.value)} className="mt-1 block h-10 rounded-lg border px-2 text-[14px]">{analysis.sheets.map((sheet:any) => <option key={sheet.name}>{sheet.name}</option>)}</select></label><label className="text-[12px] font-bold">صف العناوين<input value={manualHeader} onChange={(event) => setManualHeader(event.target.value)} type="number" min={1} className="mt-1 block h-10 w-28 rounded-lg border px-2 text-[14px]"/></label><button disabled={loading || !manualSheet || Number(manualHeader) < 1} onClick={() => chooseTable(manualSheet, Number(manualHeader))} className="h-10 rounded-lg bg-forest px-3 text-[12px] font-bold text-white disabled:opacity-40">تطبيق صف العناوين</button></div>{selected && <div className="mt-4 overflow-x-auto rounded-xl border bg-[#f7f6f2] p-3"><p className="text-[13px] font-bold">الجدول المحدد: الصفوف {selected.startRow} → {selected.endRow} · صف العناوين {selected.headerRow} · الثقة {selected.confidence}%</p><p className="mt-1 text-[11px] text-[#68756f]">متجاهل أعلى الجدول: {selected.ignoredRowsAbove} · متجاهل أسفل الجدول: {selected.ignoredRowsBelow}</p><table className="mt-3 min-w-full text-[12px]"><thead><tr>{selected.columns.map((column:any) => <th key={column.key} className="whitespace-nowrap border p-2 text-start" dir="auto">{column.originalHeader}</th>)}</tr></thead><tbody>{selected.previewRows?.slice(0,5).map((row:any,index:number) => <tr key={index}>{selected.columns.map((column:any) => <td key={column.key} className="max-w-48 truncate border p-2" dir="auto">{row[column.key] == null ? "—" : String(row[column.key])}</td>)}</tr>)}</tbody></table></div>}</details>;
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
  const unresolved = issues.filter((issue) => !issue.resolvedAt);
  return (
    <div className="rounded-[18px] border bg-white p-4" dir="rtl">
      <div className="flex items-center justify-between gap-2"><p className="text-[12px] font-bold">القرارات المطلوبة</p><span className={`rounded-full px-2 py-1 text-[10px] font-black ${unresolved.length ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-800"}`}>{unresolved.length}</span></div>
      <div className="mt-3 space-y-2">
        {unresolved.length ? unresolved.slice(0, 5).map((issue) => <div key={issue.id} className="flex gap-2 rounded-xl bg-[#faf9f5] p-2.5"><span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${issue.severity === "BLOCKING" ? "bg-coral" : "bg-[#e3ad52]"}`}/><div><p className="text-[11px] font-bold leading-5">{issue.message}</p><p className="text-[10px] text-[#8b958f]">{issue.severity === "BLOCKING" ? "مطلوب قبل المعاينة" : "مراجعة"}</p></div></div>) : <p className="rounded-xl bg-emerald-50 px-3 py-2 text-[11px] font-bold text-emerald-800">لا توجد قرارات معلقة.</p>}
        {unresolved.length > 5 && <p className="text-[10px] text-[#7c8781]">+ {unresolved.length - 5} قرارات أخرى تظهر داخل الجدول المرتبط بها.</p>}
      </div>
    </div>
  );
}
