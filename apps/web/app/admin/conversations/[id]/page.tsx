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
    {item.state?.summary&&<section className="mt-4 rounded-[22px] border border-[#dfe4e0] bg-white p-5"><h3 className="text-[14px] font-bold">ملخص السياق</h3><ContextSummary value={item.state.summary}/></section>}
    <section className="mt-4 space-y-3">{item.messages?.map((m:any)=><div key={m.id} className={`flex gap-3 ${m.role==="USER"?"":"flex-row-reverse"}`}><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${m.role==="USER"?"bg-white border text-[#46645a]":"bg-[#123c33] text-white"}`}>{m.role==="USER"?<UserRound size={15}/>:<Bot size={15}/>}</span><div dir="auto" className={`max-w-[86%] rounded-2xl px-4 py-3 text-[14px] leading-7 ${m.role==="USER"?"border bg-white":"bg-[#e8f0ec]"}`}><p className="whitespace-pre-wrap">{m.content}</p><p className="mt-2 text-[11px] text-[#82908a]">{m.role==="USER"?"العميل":"المستشار"} · {new Date(m.createdAt).toLocaleString("ar-EG")}</p></div></div>)}</section>
  </main>
}


function ContextSummary({value}:{value:any}){
  if(!value||typeof value!=="object")return <p className="mt-3 text-[12px] text-[#74817b]" dir="auto">{String(value||"لا يوجد ملخص منظم بعد.")}</p>;
  const {recentConversation:_recentConversation,...clean}=value;
  const labels:Record<string,string>={customerGoal:"الهدف",budget:"الميزانية",preferredLocations:"المناطق المفضلة",propertyTypes:"نوع العقار",bedrooms:"غرف النوم",bathrooms:"الحمامات",preferredPhase:"المرحلة",preferredBuilding:"المبنى",preferredPaymentDurationMonths:"مدة السداد",maxDownPayment:"أقصى مقدم",hardRequirements:"شروط أساسية",softPreferences:"تفضيلات",intentScore:"درجة الجدية",selectedUnitCode:"الوحدة المختارة"};
  const format=(key:string,v:any)=>{
    if(key==="budget"&&v&&typeof v==="object"){const parts=[v.min!=null?`من ${Number(v.min).toLocaleString()}`:null,v.max!=null?`حتى ${Number(v.max).toLocaleString()}`:null,v.currency||null].filter(Boolean);return parts.join(" ")||"—";}
    if(key==="preferredPaymentDurationMonths"&&Number.isFinite(Number(v)))return `${v} شهر`;
    if(key==="maxDownPayment"&&Number.isFinite(Number(v)))return Number(v).toLocaleString();
    if(Array.isArray(v))return v.join("، ");
    if(v&&typeof v==="object")return Object.entries(v).filter(([,x])=>x!=null).map(([k,x])=>`${k}: ${String(x)}`).join(" · ");
    return String(v);
  };
  const rows=Object.entries(clean).filter(([,v])=>v!=null&&v!==""&&(!Array.isArray(v)||v.length));
  if(!rows.length)return <p className="mt-3 text-[12px] text-[#74817b]">لا يوجد ملخص منظم بعد.</p>;
  return <div className="mt-4 grid gap-3 sm:grid-cols-2">{rows.map(([key,v])=><div key={key} className="rounded-2xl bg-[#f7f8f6] p-4"><p className="text-[10px] font-bold text-[#7d8983]">{labels[key]||key.replace(/([A-Z])/g," $1")}</p><p className="mt-1 text-[13px] font-semibold leading-6 text-[#26352f]" dir="auto">{format(key,v)}</p></div>)}</div>;
}
