"use client";
import { useEffect, useState } from "react";
import { ArrowRight, Bot, MessageSquareText, UserRound } from "lucide-react";
import { adminApi, adminErrorMessage } from "@/lib/api";

export default function ConversationDetail({params}:{params:Promise<{id:string}>}){
  const [item,setItem]=useState<any>(); const [error,setError]=useState("");
  useEffect(()=>{params.then(({id})=>adminApi.get(`/conversations/${id}`).then(setItem).catch(e=>setError(adminErrorMessage(e))))},[params]);
  if(!item)return <main className="mx-auto max-w-[1100px] p-6" dir="rtl"><div className="rounded-2xl border bg-white p-8 text-center text-[13px] text-[#7b8781]">{error||"جارٍ تحميل المحادثة…"}</div></main>;
  return <main className="mx-auto max-w-[1100px] p-4 sm:p-6 lg:p-8" dir="rtl">
    <div className="mb-4"><a href="/admin/conversations" className="inline-flex items-center gap-2 text-[12px] font-bold text-[#547267]"><ArrowRight size={15}/> الرجوع للمحادثات</a></div>
    <section className="rounded-[24px] border border-[#dfe4e0] bg-white p-5 sm:p-6"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><div className="flex items-center gap-2 text-[12px] font-bold text-[#4f7568]"><MessageSquareText size={15}/> سياق المحادثة</div><h2 className="mt-2 text-[22px] font-bold" dir="auto">{item.title||"محادثة بدون عنوان"}</h2><p className="mt-1 text-[12px] text-[#7b8781]">{item.detectedLanguage||"لغة غير محددة"} · آخر تحديث {new Date(item.updatedAt).toLocaleString("ar-EG")}</p></div><div className="flex flex-wrap gap-2">{item.leads?.map((l:any)=><a key={l.id} href={`/admin/leads/${l.id}`} className="rounded-full bg-[#edf3f0] px-3 py-1.5 text-[11px] font-bold text-[#365e51]" dir="auto">{l.name} · {l.status}</a>)}</div></div></section>
    {item.state?.summary&&<section className="mt-4 rounded-[22px] border border-[#dfe4e0] bg-white p-5"><h3 className="text-[14px] font-bold">ملخص السياق</h3><pre className="mt-3 max-h-[260px] overflow-auto whitespace-pre-wrap rounded-xl bg-[#f7f8f6] p-4 font-sans text-[12px] leading-7 text-[#596761]" dir="auto">{typeof item.state.summary==="string"?item.state.summary:JSON.stringify(item.state.summary,null,2)}</pre></section>}
    <section className="mt-4 space-y-3">{item.messages?.map((m:any)=><div key={m.id} className={`flex gap-3 ${m.role==="USER"?"":"flex-row-reverse"}`}><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${m.role==="USER"?"bg-white border text-[#46645a]":"bg-[#123c33] text-white"}`}>{m.role==="USER"?<UserRound size={15}/>:<Bot size={15}/>}</span><div dir="auto" className={`max-w-[86%] rounded-2xl px-4 py-3 text-[14px] leading-7 ${m.role==="USER"?"border bg-white":"bg-[#e8f0ec]"}`}><p className="whitespace-pre-wrap">{m.content}</p><p className="mt-2 text-[11px] text-[#82908a]">{m.role==="USER"?"العميل":"المستشار"} · {new Date(m.createdAt).toLocaleString("ar-EG")}</p></div></div>)}</section>
  </main>
}
