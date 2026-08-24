"use client";

import { FormEvent, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, MessageSquareText, Search, UserRound } from "lucide-react";
import { adminApi, adminErrorMessage } from "@/lib/api";

type Item = {
  id: string;
  title?: string;
  detectedLanguage?: string;
  updatedAt: string;
  _count: { messages: number; leads: number };
  leads: { id: string; name: string; status: string; intentScore: number }[];
};
type Data = { items: Item[]; page: number; total: number; totalPages: number; limit: number };
type ExportFormat = "xlsx" | "csv" | "json" | "md";

const fmtDate = (value: string) => new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export default function Conversations() {
  const [data, setData] = useState<Data>({ items: [], page: 1, total: 0, totalPages: 1, limit: 20 });
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("xlsx");
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function load(page = 1, searchValue = appliedSearch) {
    setLoading(true); setError("");
    try {
      setData(await adminApi.get<Data>(`/conversations?page=${page}&limit=20&search=${encodeURIComponent(searchValue)}`));
      setAppliedSearch(searchValue);
    } catch (e) { setError(adminErrorMessage(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(1, ""); }, []);
  function submit(e: FormEvent) { e.preventDefault(); void load(1, search); }

  async function exportConversations() {
    setExporting(true); setError(""); setExportNotice("");
    try {
      const query = new URLSearchParams({ format: exportFormat });
      if (appliedSearch) query.set("search", appliedSearch);
      const result = await adminApi.download(
        `/conversations/export?${query.toString()}`,
        `conversations.${exportFormat}`,
      );
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setExportNotice(`تم تنزيل ${data.total.toLocaleString("ar-EG")} محادثة بصيغة ${exportFormat.toUpperCase()}.`);
    } catch (e) { setError(adminErrorMessage(e)); }
    finally { setExporting(false); }
  }

  return (
    <main className="mx-auto max-w-[1480px] p-4 sm:p-6 lg:p-8" dir="rtl">
      <section className="rounded-[24px] border border-[#dfe4e0] bg-white p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <div className="flex items-center gap-2 text-[12px] font-bold text-[#4f7568]"><MessageSquareText size={16}/> سياق العملاء</div>
            <h2 className="mt-2 text-[24px] font-bold sm:text-[28px]">المحادثات</h2>
            <p className="mt-1 text-[13px] text-[#74817b]">راجع ما طلبه العميل، الردود، وأي فرصة بيع مرتبطة بالمحادثة.</p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row lg:max-w-[660px]">
            <form onSubmit={submit} className="relative min-w-0 flex-1">
              <label htmlFor="conversation-search" className="sr-only">ابحث في المحادثات</label>
              <Search size={17} aria-hidden="true" className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#8a9690]"/>
              <input id="conversation-search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="ابحث بعنوان المحادثة أو اسم العميل" className="h-12 w-full rounded-xl border border-[#dce1dd] bg-[#fafbf9] pr-10 pl-3 text-[14px] outline-none focus:border-[#8eaa9f]"/>
            </form>
            <div className="flex shrink-0 gap-2">
              <label htmlFor="conversation-export-format" className="sr-only">صيغة التصدير</label>
              <select
                id="conversation-export-format"
                value={exportFormat}
                onChange={event=>setExportFormat(event.target.value as ExportFormat)}
                className="h-12 min-w-24 rounded-xl border border-[#dce1dd] bg-[#fafbf9] px-3 text-[13px] font-bold text-[#40554e]"
                disabled={exporting}
              >
                <option value="xlsx">Excel</option>
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
                <option value="md">Markdown</option>
              </select>
              <button
                type="button"
                onClick={()=>void exportConversations()}
                disabled={exporting || loading || data.total === 0}
                title="تصدير كل المحادثات المطابقة للبحث الحالي"
                className="inline-flex h-12 min-w-28 items-center justify-center gap-2 rounded-xl bg-[#173f3b] px-4 text-[13px] font-bold text-white transition hover:bg-[#24564f] disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Download size={16} aria-hidden="true"/>
                {exporting ? "جارٍ التصدير…" : "تصدير"}
              </button>
            </div>
          </div>
        </div>
        {exportNotice ? <p className="mt-3 text-[12px] text-[#55756a]" aria-live="polite">{exportNotice}</p> : null}
      </section>

      {error && <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 p-4 text-[13px] text-red-800">{error}</div>}

      <section className="mt-5 overflow-hidden rounded-[24px] border border-[#dfe4e0] bg-white">
        <div className="grid grid-cols-[1fr_auto] gap-3 border-b bg-[#fafbf9] px-5 py-3 text-[12px] font-bold text-[#74817b] sm:grid-cols-[1.3fr_.65fr_.55fr_auto] sm:px-6">
          <span>المحادثة</span><span className="hidden sm:block">النشاط</span><span className="hidden sm:block">الفرصة</span><span>آخر تحديث</span>
        </div>
        <div className="divide-y divide-[#edf0ed]">
          {loading && !data.items.length ? <div className="p-10 text-center text-[13px] text-[#7d8983]">جارٍ تحميل المحادثات…</div> : data.items.map(x => (
            <a href={`/admin/conversations/${x.id}`} key={x.id} className="grid grid-cols-[1fr_auto] gap-3 px-5 py-4 transition hover:bg-[#fafbf9] sm:grid-cols-[1.3fr_.65fr_.55fr_auto] sm:items-center sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#eaf2ee] text-[#315f50]"><MessageSquareText size={17}/></span>
                <div className="min-w-0"><p className="truncate text-[14px] font-bold" dir="auto">{x.title || "محادثة بدون عنوان"}</p><p className="mt-1 text-[12px] text-[#84908a]">{x.detectedLanguage || "لغة غير محددة"}</p></div>
              </div>
              <div className="hidden text-[12px] text-[#65736d] sm:block"><b>{x._count.messages}</b> رسالة<br/><span>{x._count.leads} فرصة</span></div>
              <div className="hidden sm:block">
                {x.leads[0] ? <div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#f1f3f1]"><UserRound size={14}/></span><div><p className="max-w-[150px] truncate text-[12px] font-bold" dir="auto">{x.leads[0].name}</p><p className="text-[11px] text-[#7d8983]">{x.leads[0].intentScore}/100 · {x.leads[0].status}</p></div></div> : <span className="text-[12px] text-[#9aa49f]">لا توجد فرصة</span>}
              </div>
              <span className="whitespace-nowrap text-[11px] text-[#7d8983]">{fmtDate(x.updatedAt)}</span>
            </a>
          ))}
          {!loading && !data.items.length && <div className="p-12 text-center text-[13px] text-[#7d8983]">لا توجد محادثات مطابقة.</div>}
        </div>
      </section>

      <div className="mt-4 flex items-center justify-between gap-3 text-[12px]">
        <button disabled={data.page<=1 || loading} onClick={()=>load(data.page-1, appliedSearch)} className="flex h-10 items-center gap-1 rounded-xl border bg-white px-4 font-bold disabled:opacity-40"><ChevronRight size={15}/> السابق</button>
        <span className="text-[#728079]">صفحة {data.page} من {Math.max(1,data.totalPages)} · {data.total} محادثة</span>
        <button disabled={data.page>=data.totalPages || loading} onClick={()=>load(data.page+1, appliedSearch)} className="flex h-10 items-center gap-1 rounded-xl border bg-white px-4 font-bold disabled:opacity-40">التالي <ChevronLeft size={15}/></button>
      </div>
    </main>
  );
}
