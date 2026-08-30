"use client";

import { FormEvent, useEffect, useState } from "react";
import { Bot, CalendarClock, ChevronLeft, ChevronRight, Download, MessageSquareText, Search, UsersRound } from "lucide-react";
import { adminApi, adminErrorMessage } from "@/lib/api";

type Item = {
  id: string; identity: string; channel: string; locale?: string; mode: "AI" | "HUMAN" | "PAUSED"; updatedAt: string;
  activeRequirement?: { title: string; status: string; propertyType?: string; locations: string[] };
  propertyRequirements: { title: string; status: string }[];
  _count: { turns: number; participants: number; followUpTasks: number };
};
type Data = { items: Item[]; page: number; total: number; totalPages: number; limit: number };

const date = (value: string) => new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const modeLabel = { AI: "نديم", HUMAN: "فريق بشري", PAUSED: "متوقفة" };
const modeClass = { AI: "bg-emerald-50 text-emerald-800", HUMAN: "bg-amber-50 text-amber-800", PAUSED: "bg-slate-100 text-slate-700" };
const statusLabel: Record<string, string> = { OPEN: "مفتوح", MATCHED: "له نتائج", NEEDS_MATCH: "يحتاج مطابقة", HUMAN_REVIEW: "مراجعة بشرية", CLOSED: "مغلق" };

export default function Conversations() {
  const [data, setData] = useState<Data>({ items: [], page: 1, total: 0, totalPages: 1, limit: 20 });
  const [search, setSearch] = useState(""); const [applied, setApplied] = useState("");
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  async function load(page = 1, term = applied) { setLoading(true); setError(""); try { setData(await adminApi.get<Data>(`/conversations?page=${page}&limit=20&search=${encodeURIComponent(term)}`)); setApplied(term); } catch (e) { setError(adminErrorMessage(e)); } finally { setLoading(false); } }
  useEffect(() => { void load(1, ""); }, []);
  function submit(event: FormEvent) { event.preventDefault(); void load(1, search); }
  async function exportRows() { setExporting(true); setError(""); try { const query = new URLSearchParams({ format: "xlsx" }); if (applied) query.set("search", applied); const file = await adminApi.download(`/conversations/export?${query}`, "conversations.xlsx"); const url = URL.createObjectURL(file.blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.fileName; anchor.click(); URL.revokeObjectURL(url); } catch (e) { setError(adminErrorMessage(e)); } finally { setExporting(false); } }

  return <main className="mx-auto max-w-[1480px] p-4 sm:p-6 lg:p-8" dir="rtl">
    <header className="rounded-[24px] border border-[#dfe4e0] bg-white p-5 sm:p-6">
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div><p className="flex items-center gap-2 text-xs font-bold text-[#4f7568]"><MessageSquareText size={16}/> عمليات خدمة العملاء</p><h1 className="mt-2 text-2xl font-bold sm:text-[28px]">محادثات نديم</h1><p className="mt-1 max-w-2xl text-[13px] leading-6 text-[#74817b]">ملكية المحادثة، متطلبات العقار، والمتابعات المجدولة من مصدرها الحقيقي.</p></div>
        <div className="flex w-full gap-2 lg:max-w-xl"><form onSubmit={submit} className="relative min-w-0 flex-1"><label htmlFor="conversation-search" className="sr-only">البحث في المحادثات</label><Search size={17} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#8a9690]"/><input id="conversation-search" value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="اسم العميل، القناة، أو المتطلب" className="h-12 w-full rounded-xl border border-[#dce1dd] bg-[#fafbf9] pr-10 pl-3 text-sm outline-none focus:border-[#628c7e] focus:ring-2 focus:ring-[#dceae4]"/></form><button onClick={()=>void exportRows()} disabled={exporting||!data.total} className="inline-flex h-12 items-center gap-2 rounded-xl border px-4 text-xs font-bold disabled:opacity-40"><Download size={16}/>{exporting ? "جارٍ…" : "Excel"}</button></div>
      </div>
    </header>
    {error ? <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-800">{error}</div> : null}
    <section className="mt-5 overflow-hidden rounded-[24px] border border-[#dfe4e0] bg-white">
      <div className="hidden grid-cols-[1.1fr_.65fr_1.15fr_.55fr_auto] gap-4 border-b bg-[#fafbf9] px-6 py-3 text-xs font-bold text-[#74817b] md:grid"><span>العميل والقناة</span><span>الملكية</span><span>المتطلب النشط</span><span>الحالة</span><span>آخر نشاط</span></div>
      <div className="divide-y divide-[#edf0ed]">
        {data.items.map((item) => <a key={item.id} href={`/admin/conversations/${item.id}`} className="grid gap-4 px-5 py-5 transition hover:bg-[#fafbf9] md:grid-cols-[1.1fr_.65fr_1.15fr_.55fr_auto] md:items-center md:px-6">
          <div className="flex min-w-0 items-center gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#eaf2ee] text-[#315f50]"><MessageSquareText size={18}/></span><div className="min-w-0"><p className="truncate text-sm font-bold" dir="auto">{item.identity}</p><p className="mt-1 text-xs text-[#84908a]">{item.channel} · {item._count.turns} دور</p></div></div>
          <div><span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold ${modeClass[item.mode]}`}><Bot size={13}/>{modeLabel[item.mode]}</span></div>
          <div className="min-w-0"><p className="truncate text-[13px] font-semibold" dir="auto">{item.activeRequirement?.title ?? "لا يوجد متطلب نشط"}</p><p className="mt-1 truncate text-[11px] text-[#7c8983]">{item.activeRequirement ? [item.activeRequirement.propertyType, ...item.activeRequirement.locations].filter(Boolean).join(" · ") : `${item.propertyRequirements.length} متطلبات مفتوحة`}</p></div>
          <div className="flex flex-wrap gap-2 text-[11px]"><span className="rounded-lg bg-[#f1f4f2] px-2 py-1 font-bold">{statusLabel[item.activeRequirement?.status ?? ""] ?? "—"}</span>{item._count.followUpTasks ? <span className="inline-flex items-center gap-1 rounded-lg bg-sky-50 px-2 py-1 font-bold text-sky-800"><CalendarClock size={12}/>{item._count.followUpTasks}</span> : null}{item._count.participants > 1 ? <span className="inline-flex items-center gap-1 text-[#65736d]"><UsersRound size={13}/>{item._count.participants}</span> : null}</div>
          <time className="whitespace-nowrap text-[11px] text-[#7d8983]">{date(item.updatedAt)}</time>
        </a>)}
        {loading && !data.items.length ? <div className="p-12 text-center text-sm text-[#7d8983]">جارٍ تحميل المحادثات…</div> : null}
        {!loading && !data.items.length ? <div className="p-12 text-center text-sm text-[#7d8983]">لا توجد محادثات حقيقية مطابقة.</div> : null}
      </div>
    </section>
    <nav className="mt-4 flex items-center justify-between gap-3 text-xs" aria-label="صفحات المحادثات"><button disabled={data.page<=1||loading} onClick={()=>void load(data.page-1)} className="flex h-11 items-center gap-1 rounded-xl border bg-white px-4 font-bold disabled:opacity-40"><ChevronRight size={15}/>السابق</button><span className="text-[#728079]">صفحة {data.page} من {data.totalPages} · {data.total} محادثة</span><button disabled={data.page>=data.totalPages||loading} onClick={()=>void load(data.page+1)} className="flex h-11 items-center gap-1 rounded-xl border bg-white px-4 font-bold disabled:opacity-40">التالي<ChevronLeft size={15}/></button></nav>
  </main>;
}
