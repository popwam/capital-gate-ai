"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Bot, Building2, CheckCircle2, Clock3, FileSpreadsheet, MapPinned, MessageSquareText, Network, Sparkles, UsersRound, Warehouse } from "lucide-react";
import { adminApi, adminErrorMessage } from "@/lib/api";

type Dashboard = {
  units:number; availableUnits:number; reservedUnits?:number; soldUnits?:number; unavailableUnits?:number;
  projects:number; developers:number; activeImports:number; importsNeedingInput:number; newLeads:number; followUps:number;
  mappedUnits?:number; projectsWithBoundary?:number; activePaymentPlans?:number; pendingKnowledge?:number; conversations24h?:number;
};
type ImportBatch = { id:string; name?:string|null; fileName:string; uploadedAt:string; status:string; rowsDetected:number; rowsCreated:number; rowsUpdated:number; rowsFailed:number; project?:{name:string}|null; developer?:{name:string}|null };
type ImportPage = { items:ImportBatch[]; total:number };
type AIHealthItem = { provider?:string; healthy?:boolean; status?:string; model?:string|null; selectedModel?:string|null; errorCode?:string };
type AIHealth = AIHealthItem | AIHealthItem[];
type LeadSummary = { newLeads:number; highIntent:number; followUpsDue:number; thisWeek:number; trustAlertsOpen:number };
type Tab = "OVERVIEW" | "INVENTORY" | "AI" | "ATTENTION";

const fmt = new Intl.NumberFormat("ar-EG");
const tabs:Array<[Tab,string]> = [["OVERVIEW","نظرة سريعة"],["INVENTORY","المخزون"],["AI","الذكاء الاصطناعي"],["ATTENTION","تحتاج انتباه"]];

function Stat({label,value,sub}:{label:string;value:number;sub:string}){
  return <div className="rounded-2xl border border-[#e0e4e1] bg-white p-4"><p className="text-[11px] font-bold text-[#73817a]">{label}</p><p className="mt-2 text-2xl font-extrabold tracking-[-.04em]">{fmt.format(value||0)}</p><p className="mt-1 text-xs text-[#7d8983]">{sub}</p></div>;
}
function Action({icon:Icon,label,value,href,warn=false}:{icon:typeof Warehouse;label:string;value:number;href:string;warn?:boolean}){
  return <a href={href} className="flex items-center gap-3 rounded-2xl border bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-sm"><span className={`grid h-10 w-10 place-items-center rounded-xl ${warn&&value>0?"bg-[#f6ead7] text-[#8a672f]":"bg-[#edf2ef] text-[#35594d]"}`}><Icon size={18}/></span><span className="min-w-0 flex-1"><b className="block truncate text-sm">{label}</b><small className="text-[#7d8983]">فتح ومراجعة</small></span><b>{fmt.format(value||0)}</b></a>;
}
function statusLabel(status:string){return ({UPLOADED:"تم الرفع",ANALYZING:"تحليل",NEEDS_INPUT:"يحتاج مراجعة",READY:"جاهز",IMPORTING:"استيراد",COMPLETED:"مكتمل",FAILED:"فشل"} as Record<string,string>)[status]||status;}

export default function AdminDashboardPage(){
  const [dashboard,setDashboard]=useState<Dashboard|null>(null),[imports,setImports]=useState<ImportBatch[]>([]),[leadSummary,setLeadSummary]=useState<LeadSummary|null>(null),[health,setHealth]=useState<AIHealth|null>(null),[tab,setTab]=useState<Tab>("OVERVIEW"),[error,setError]=useState("");
  useEffect(()=>{Promise.allSettled([adminApi.get<Dashboard>("/real-estate/dashboard"),adminApi.get<ImportPage>("/imports?page=1&pageSize=4"),adminApi.get<LeadSummary>("/leads/summary"),adminApi.get<AIHealth>("/system/ai-health")]).then((results)=>{if(results[0].status==="fulfilled")setDashboard(results[0].value);else setError(adminErrorMessage(results[0].reason));if(results[1].status==="fulfilled")setImports(results[1].value.items.slice(0,4));if(results[2].status==="fulfilled")setLeadSummary(results[2].value);if(results[3].status==="fulfilled")setHealth(results[3].value);});},[]);
  const aiItems=useMemo(()=>Array.isArray(health)?health:health?[health]:[],[health]);
  const aiHealthy=aiItems.length>0&&aiItems.every((item)=>item.healthy!==false&&item.status!=="down");
  const availability=dashboard?.units?Math.round(((dashboard.availableUnits||0)/dashboard.units)*100):0;
  const mapped=dashboard?.units?Math.round(((dashboard.mappedUnits||0)/dashboard.units)*100):0;

  return <main className="mx-auto max-w-[1420px] p-4 sm:p-6 lg:p-8" dir="rtl">
    <section className="overflow-hidden rounded-[26px] bg-[#14211f] text-white shadow-[0_20px_65px_rgba(20,33,31,.14)]">
      <div className="grid gap-5 p-5 sm:p-7 lg:grid-cols-[1.2fr_.8fr]">
        <div><div className="flex items-center gap-2 text-xs font-bold text-[#d6bf95]"><Sparkles size={15}/> Cg Ai Operations</div><h2 className="mt-3 max-w-2xl text-[25px] font-extrabold leading-[1.45] sm:text-[31px]">المهم قدامك. التفاصيل تفتحها لما تحتاجها.</h2><p className="mt-2 max-w-2xl text-sm leading-7 text-white/60">مخزون، AI، استيراد ومتابعات في Dashboard قصيرة بدل صفحة تشغيل طويلة.</p><div className="mt-5 flex flex-wrap gap-2"><a href="/admin/data/import" className="rounded-xl bg-[#b08c52] px-4 py-2.5 text-xs font-extrabold text-[#14211f]">استيراد مخزون</a><a href="/admin/inventory" className="rounded-xl border border-white/15 px-4 py-2.5 text-xs font-bold">فتح المخزون</a><a href="/admin/projects" className="rounded-xl border border-white/15 px-4 py-2.5 text-xs font-bold">المشروعات</a></div></div>
        <div className="grid grid-cols-2 gap-3 self-center"><div className="rounded-2xl bg-white/10 p-4"><small className="text-white/50">الوحدات المتاحة</small><b className="mt-2 block text-3xl">{availability}%</b><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#d6bf95]" style={{width:`${Math.min(100,availability)}%`}}/></div></div><div className="rounded-2xl bg-white/10 p-4"><small className="text-white/50">محدد على المستر بلان</small><b className="mt-2 block text-3xl">{mapped}%</b><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#9dbeb3]" style={{width:`${Math.min(100,mapped)}%`}}/></div></div></div>
      </div>
    </section>
    {error&&<div className="mt-4 rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</div>}

    <section className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="إجمالي المخزون" value={dashboard?.units??0} sub={`${fmt.format(dashboard?.availableUnits??0)} متاح`}/><Stat label="المشروعات" value={dashboard?.projects??0} sub={`${fmt.format(dashboard?.developers??0)} مطور`}/><Stat label="عملاء جدد" value={leadSummary?.newLeads??dashboard?.newLeads??0} sub={`${fmt.format(leadSummary?.highIntent??0)} نية مرتفعة`}/><Stat label="متابعات" value={leadSummary?.followUpsDue??dashboard?.followUps??0} sub="تحتاج إجراء"/>
    </section>

    <div className="mt-4 overflow-x-auto rounded-2xl border bg-white p-1.5"><div className="flex min-w-max gap-1">{tabs.map(([value,label])=><button key={value} onClick={()=>setTab(value)} className={`rounded-xl px-4 py-2.5 text-xs font-extrabold transition ${tab===value?"bg-[#14211f] text-white":"text-[#65736d] hover:bg-[#f2f4f1]"}`}>{label}</button>)}</div></div>

    <section className="mt-4 min-h-[300px]">
      {tab==="OVERVIEW"&&<div className="grid gap-4 xl:grid-cols-[1.25fr_.75fr]"><div className="overflow-hidden rounded-2xl border bg-white"><div className="flex items-center justify-between border-b p-4"><div><b>آخر الاستيرادات</b><p className="mt-1 text-xs text-[#7d8983]">أربع دفعات فقط</p></div><a href="/admin/data" className="text-xs font-bold text-[#765b31]">عرض الكل</a></div><div className="divide-y">{imports.length?imports.map((batch)=><a key={batch.id} href={`/admin/data/import?import=${batch.id}`} className="grid gap-2 p-4 hover:bg-[#fafaf7] sm:grid-cols-[1fr_auto_auto] sm:items-center"><div className="min-w-0"><b className="block truncate text-sm" dir="auto">{batch.name||batch.fileName}</b><small className="text-[#7d8983]">{fmt.format(batch.rowsDetected)} صف · {fmt.format(batch.rowsCreated)} جديد</small></div><small>{new Date(batch.uploadedAt).toLocaleDateString("ar-EG",{day:"numeric",month:"short"})}</small><span className="w-fit rounded-full bg-[#eef2ef] px-2.5 py-1 text-[11px] font-bold">{statusLabel(batch.status)}</span></a>):<p className="p-8 text-center text-sm text-[#7d8983]">لا توجد دفعات.</p>}</div></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1"><Action icon={FileSpreadsheet} label="استيراد يحتاج مراجعة" value={dashboard?.importsNeedingInput??0} href="/admin/data" warn/><Action icon={MessageSquareText} label="محادثات آخر 24 ساعة" value={dashboard?.conversations24h??0} href="/admin/conversations"/><Action icon={UsersRound} label="متابعات مستحقة" value={leadSummary?.followUpsDue??0} href="/admin/leads" warn/></div></div>}

      {tab==="INVENTORY"&&<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Stat label="متاح" value={dashboard?.availableUnits??0} sub={`${availability}% من المخزون`}/><Stat label="محجوز" value={dashboard?.reservedUnits??0} sub="Reserved"/><Stat label="مباع" value={dashboard?.soldUnits??0} sub="Sold"/><Stat label="على المستر بلان" value={dashboard?.mappedUnits??0} sub={`${mapped}% محدد`}/><Action icon={Warehouse} label="إدارة الوحدات" value={dashboard?.units??0} href="/admin/inventory"/><Action icon={MapPinned} label="مشروعات بحدود مرسومة" value={dashboard?.projectsWithBoundary??0} href="/admin/projects"/><Action icon={Building2} label="المشروعات" value={dashboard?.projects??0} href="/admin/projects"/><Action icon={Network} label="خطط سداد نشطة" value={dashboard?.activePaymentPlans??0} href="/admin/projects"/></div>}

      {tab==="AI"&&<div className="rounded-2xl border bg-white p-5"><div className="flex items-center justify-between gap-3"><div><b>عقول Cg Ai</b><p className="mt-1 text-xs text-[#7d8983]">الحالة الفعلية للمزودين والموديلات</p></div><span className={`grid h-11 w-11 place-items-center rounded-xl ${aiHealthy?"bg-[#eaf3ee] text-[#356c58]":"bg-[#f8ecdd] text-[#8a672f]"}`}>{aiHealthy?<CheckCircle2 size={20}/>:<AlertCircle size={20}/>}</span></div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{aiItems.length?aiItems.map((item,index)=><div key={`${item.provider}-${index}`} className="rounded-2xl border bg-[#fbfbf8] p-4"><div className="flex items-center gap-2"><Bot size={17}/><b>{item.provider||"AI"}</b><span className={`me-auto h-2.5 w-2.5 rounded-full ${item.healthy===false?"bg-red-500":"bg-emerald-500"}`}/></div><p className="mt-2 truncate text-xs text-[#718079]" dir="auto">{item.model||item.selectedModel||"Dynamic route"}</p>{item.errorCode&&<p className="mt-2 text-xs text-red-700">{item.errorCode}</p>}</div>):<p className="text-sm text-[#7d8983]">لم تصل بيانات الصحة بعد.</p>}</div><a href="/admin/system" className="mt-4 inline-flex rounded-xl border px-4 py-2.5 text-xs font-bold">تفاصيل النظام</a></div>}

      {tab==="ATTENTION"&&<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Action icon={FileSpreadsheet} label="استيرادات تحتاج قرار" value={dashboard?.importsNeedingInput??0} href="/admin/data" warn/><Action icon={Sparkles} label="معرفة تحتاج مراجعة" value={dashboard?.pendingKnowledge??0} href="/admin/projects" warn/><Action icon={Clock3} label="متابعات مطلوبة" value={leadSummary?.followUpsDue??dashboard?.followUps??0} href="/admin/leads" warn/><Action icon={AlertCircle} label="بيانات عملاء تحتاج تحقق" value={leadSummary?.trustAlertsOpen??0} href="/admin/leads" warn/><Action icon={MapPinned} label="مشروعات بحدود" value={dashboard?.projectsWithBoundary??0} href="/admin/projects"/><Action icon={Network} label="وحدات محددة مكانيًا" value={dashboard?.mappedUnits??0} href="/admin/inventory"/></div>}
    </section>
  </main>;
}
