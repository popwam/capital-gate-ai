"use client";

import { FormEvent, useMemo, useState } from "react";
import { adminApi, adminErrorMessage } from "@/lib/api";

type Plan = Record<string, any>;
type ScheduleRow = { label: string; percent: number; sequence: number };

const unitLabel: Record<string,string> = { DAY:"يوم", MONTH:"شهر", YEAR:"سنة" };
const timingLabel: Record<string,string> = { SAME_CYCLE:"من نفس الدورة", NEXT_MONTH:"من الشهر التالي", NEXT_CYCLE:"من دورة السداد القادمة" };
const toMonths = (value:number, unit:string) => unit === "YEAR" ? value * 12 : unit === "MONTH" ? value : Math.max(0, Math.round(value / 30));
const toDays = (value:number, unit:string) => unit === "YEAR" ? value * 365 : unit === "MONTH" ? value * 30 : value;

function buildSchedule(durationValue:number, durationUnit:string, everyValue:number, everyUnit:string, downPaymentPercent:number) {
  const durationDays = toDays(durationValue, durationUnit);
  const cycleDays = Math.max(1, toDays(everyValue, everyUnit));
  const count = durationDays <= 0 ? 0 : Math.max(1, Math.min(180, Math.ceil(durationDays / cycleDays)));
  const remaining = Math.max(0, 100 - downPaymentPercent);
  if (!count) return [] as ScheduleRow[];
  const each = remaining / count;
  return Array.from({ length: count }, (_, index) => ({ label: `القسط ${index + 1}`, percent: Number(each.toFixed(6)), sequence: index + 1 }));
}

export function PaymentPlanDesigner({ projectId, plans, onChanged }:{ projectId:string; plans:Plan[]; onChanged:()=>Promise<void>|void }) {
  const [planType,setPlanType]=useState<"CASH"|"INSTALLMENT">("INSTALLMENT");
  const [durationPreset,setDurationPreset]=useState("8");
  const [customDuration,setCustomDuration]=useState(8);
  const [durationUnit,setDurationUnit]=useState("YEAR");
  const [everyValue,setEveryValue]=useState(1);
  const [everyUnit,setEveryUnit]=useState("MONTH");
  const [downPaymentPercent,setDownPaymentPercent]=useState(10);
  const [schedule,setSchedule]=useState<ScheduleRow[]>(() => buildSchedule(8,"YEAR",1,"MONTH",10));
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);

  const duration = durationPreset === "CUSTOM" ? customDuration : Number(durationPreset);
  const actualDurationUnit = durationPreset === "CUSTOM" ? durationUnit : "YEAR";
  const durationMonths = toMonths(duration, actualDurationUnit);
  const scheduleTotal = useMemo(() => schedule.reduce((sum,row)=>sum+(Number(row.percent)||0),0),[schedule]);
  const allocated = planType === "CASH" ? 100 : downPaymentPercent + scheduleTotal;
  const remaining = Number((100 - allocated).toFixed(6));

  const regenerate = (dp = downPaymentPercent) => setSchedule(buildSchedule(duration, actualDurationUnit, everyValue, everyUnit, dp));
  const distributeRemaining = () => {
    if (!schedule.length) return;
    const target = Math.max(0,100-downPaymentPercent);
    const each = target/schedule.length;
    setSchedule(rows=>rows.map((row,index)=>({...row,percent:index===rows.length-1 ? Number((target-each*(rows.length-1)).toFixed(6)) : Number(each.toFixed(6))})));
  };

  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if (planType === "INSTALLMENT" && Math.abs(remaining) > 0.001) return setError(`إجمالي النسب لازم يساوي 100%. المتبقي حاليًا ${remaining.toFixed(2)}%.`);
    const form = new FormData(event.currentTarget);
    const reservation = String(form.get("reservationAmount")||"").trim();
    const discount = String(form.get("discountPercent")||"").trim();
    const payload:Record<string,unknown> = {
      name:String(form.get("name")||"").trim() || (planType === "CASH" ? "كاش" : `${duration} ${unitLabel[actualDurationUnit]}`),
      planType,
      currency:"EGP",
      reservationAmount:reservation ? Number(reservation) : undefined,
      discountPercent:discount ? Number(discount) : undefined,
      durationValue:planType === "INSTALLMENT" ? duration : 0,
      durationUnit:planType === "INSTALLMENT" ? actualDurationUnit : "MONTH",
      durationMonths:planType === "INSTALLMENT" ? durationMonths : 0,
      downPaymentPercent:planType === "INSTALLMENT" ? downPaymentPercent : 100,
      installmentFrequency:planType === "INSTALLMENT" ? "CUSTOM" : undefined,
      installmentEveryValue:planType === "INSTALLMENT" ? everyValue : undefined,
      installmentEveryUnit:planType === "INSTALLMENT" ? everyUnit : undefined,
      firstInstallmentTiming:planType === "INSTALLMENT" ? String(form.get("firstInstallmentTiming")||"NEXT_CYCLE") : undefined,
      percentageSchedule:planType === "INSTALLMENT" ? schedule : [],
      maintenancePercent:String(form.get("maintenancePercent")||"").trim() ? Number(form.get("maintenancePercent")) : undefined,
      validFrom:String(form.get("validFrom")||"")||undefined,
      validTo:String(form.get("validTo")||"")||undefined,
      notes:String(form.get("notes")||"").trim()||undefined,
    };
    try { setBusy(true); setError(""); await adminApi.post(`/catalog/projects/${projectId}/payment-plans`,payload); (event.currentTarget as HTMLFormElement).reset(); await onChanged(); }
    catch(e){setError(adminErrorMessage(e));} finally{setBusy(false);}
  }

  return <section className="mt-6 rounded-[24px] border bg-white p-5" dir="rtl">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-5">
      <div><h2 className="text-lg font-extrabold">خطط السداد</h2><p className="mt-1 max-w-3xl text-sm leading-7 text-[#68756f]">سعر الوحدة موجود في المخزون؛ هنا بنسجل منطق السداد فقط. لا تدخل سعر جديد للخطة. الحجز ممكن يكون مبلغ، وباقي الخطة نسب من 100%.</p></div>
      <div className="flex rounded-xl bg-[#f3f1eb] p-1"><button type="button" onClick={()=>{setPlanType("INSTALLMENT");regenerate();}} className={`rounded-lg px-4 py-2 text-sm font-bold ${planType==="INSTALLMENT"?"bg-forest text-white":""}`}>تقسيط</button><button type="button" onClick={()=>{setPlanType("CASH");setSchedule([])}} className={`rounded-lg px-4 py-2 text-sm font-bold ${planType==="CASH"?"bg-forest text-white":""}`}>كاش</button></div>
    </div>

    {plans.length>0 && <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{plans.map(plan=><article key={plan.id} className="rounded-2xl border bg-[#faf9f5] p-4"><div className="flex items-center justify-between gap-2"><strong>{plan.name|| (plan.planType==="CASH"?"كاش":"خطة تقسيط")}</strong><span className="rounded-full bg-white px-2 py-1 text-xs">{plan.planType==="CASH"?"كاش":"تقسيط"}</span></div><p className="mt-2 text-xs leading-6 text-[#68756f]">{plan.planType==="CASH" ? (plan.discountPercent ? `خصم ${Number(plan.discountPercent)}%` : "السعر الأساسي بدون خصم") : `${plan.durationMonths??0} شهر · مقدم ${Number(plan.downPaymentPercent??0)}% · كل ${plan.installmentEveryValue??1} ${unitLabel[plan.installmentEveryUnit]??"دورة"}`}</p>{plan.reservationAmount!=null&&<p className="mt-1 text-xs">حجز: {Number(plan.reservationAmount).toLocaleString("en-EG")} EGP</p>}</article>)}</div>}

    <form onSubmit={submit} className="mt-5 space-y-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <input name="name" placeholder={planType==="CASH"?"اسم الخطة — مثال كاش بخصم":"اسم الخطة — اختياري"} className="h-12 rounded-xl border px-3"/>
        <input name="reservationAmount" type="number" min="0" step="any" placeholder="مبلغ الحجز — اختياري" className="h-12 rounded-xl border px-3"/>
        <input name="discountPercent" type="number" min="0" max="100" step="any" placeholder="خصم % — اختياري" className="h-12 rounded-xl border px-3"/>
        <input name="maintenancePercent" type="number" min="0" max="100" step="any" placeholder="صيانة % — اختياري" className="h-12 rounded-xl border px-3"/>
      </div>

      {planType==="INSTALLMENT" && <>
        <div className="rounded-2xl border bg-[#f8f7f2] p-4">
          <h3 className="font-bold">المدة ودورة السداد</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <select value={durationPreset} onChange={e=>{const v=e.target.value;setDurationPreset(v);setTimeout(()=>regenerate(),0)}} className="h-12 rounded-xl border bg-white px-3"><option value="0">0 سنة</option>{Array.from({length:15},(_,i)=>i+1).map(y=><option key={y} value={String(y)}>{y} سنة</option>)}<option value="CUSTOM">مدة مخصصة</option></select>
            {durationPreset==="CUSTOM" && <><input value={customDuration} onChange={e=>setCustomDuration(Math.max(0,Number(e.target.value)))} type="number" min="0" className="h-12 rounded-xl border px-3" placeholder="قيمة المدة"/><select value={durationUnit} onChange={e=>setDurationUnit(e.target.value)} className="h-12 rounded-xl border bg-white px-3"><option value="DAY">يوم</option><option value="MONTH">شهر</option><option value="YEAR">سنة</option></select></>}
            <div className="grid grid-cols-[1fr_1.2fr] gap-2"><input value={everyValue} onChange={e=>setEveryValue(Math.max(1,Number(e.target.value)))} type="number" min="1" className="h-12 rounded-xl border px-3"/><select value={everyUnit} onChange={e=>setEveryUnit(e.target.value)} className="h-12 rounded-xl border bg-white px-3"><option value="DAY">كل يوم/أيام</option><option value="MONTH">كل شهر/شهور</option><option value="YEAR">كل سنة/سنين</option></select></div>
            <button type="button" onClick={()=>regenerate()} className="h-12 rounded-xl border bg-white font-bold">إنشاء فترات السداد</button>
          </div>
        </div>

        <div className="rounded-2xl border p-4">
          <div className="grid gap-3 md:grid-cols-3"><label className="text-sm font-bold">المقدم %<input value={downPaymentPercent} onChange={e=>{const v=Math.min(100,Math.max(0,Number(e.target.value)));setDownPaymentPercent(v)}} type="number" min="0" max="100" step="any" className="mt-2 h-12 w-full rounded-xl border px-3"/></label><label className="text-sm font-bold">أول قسط<select name="firstInstallmentTiming" defaultValue="NEXT_CYCLE" className="mt-2 h-12 w-full rounded-xl border bg-white px-3"><option value="SAME_CYCLE">يبدأ من نفس الدورة</option><option value="NEXT_MONTH">يبدأ من الشهر التالي</option><option value="NEXT_CYCLE">يبدأ من دورة السداد القادمة</option></select></label><div className="rounded-xl bg-[#f3f1eb] p-3"><div className="flex justify-between text-sm"><b>الخطة</b><b>100%</b></div><div className="mt-1 flex justify-between text-xs"><span>المقدم</span><span>{downPaymentPercent.toFixed(2)}%</span></div><div className="flex justify-between text-xs"><span>الأقساط</span><span>{scheduleTotal.toFixed(2)}%</span></div><div className={`mt-1 flex justify-between border-t pt-1 text-sm font-bold ${Math.abs(remaining)>.001?"text-red-700":"text-forest"}`}><span>المتبقي</span><span>{remaining.toFixed(2)}%</span></div></div></div>
          <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={()=>regenerate()} className="rounded-lg border px-3 py-2 text-sm">إعادة إنشاء الفترات</button><button type="button" onClick={distributeRemaining} className="rounded-lg border px-3 py-2 text-sm">توزيع الباقي بالتساوي</button><button type="button" onClick={()=>setSchedule(rows=>[...rows,{label:`دفعة خاصة ${rows.length+1}`,percent:0,sequence:rows.length+1}])} className="rounded-lg border px-3 py-2 text-sm">+ دفعة خاصة</button></div>
          <div className="mt-4 max-h-[420px] overflow-auto rounded-xl border"><div className="sticky top-0 grid grid-cols-[70px_1fr_120px_70px] gap-2 border-b bg-white px-3 py-2 text-xs font-bold"><span>#</span><span>الفترة / الدفعة</span><span>النسبة من 100</span><span></span></div>{schedule.map((row,index)=><div key={index} className="grid grid-cols-[70px_1fr_120px_70px] items-center gap-2 border-b px-3 py-2"><span className="text-xs text-[#68756f]">{index+1}</span><input value={row.label} onChange={e=>setSchedule(rows=>rows.map((x,i)=>i===index?{...x,label:e.target.value}:x))} className="h-10 rounded-lg border px-2"/><input value={row.percent} onChange={e=>setSchedule(rows=>rows.map((x,i)=>i===index?{...x,percent:Number(e.target.value)}:x))} type="number" min="0" max="100" step="0.000001" className="h-10 rounded-lg border px-2"/><button type="button" onClick={()=>setSchedule(rows=>rows.filter((_,i)=>i!==index).map((x,i)=>({...x,sequence:i+1})))} className="text-xs text-red-700">حذف</button></div>)}</div>
        </div>
      </>}

      <div className="grid gap-3 md:grid-cols-2"><label className="text-xs">صالح من<input name="validFrom" type="date" className="mt-1 h-11 w-full rounded-xl border px-3"/></label><label className="text-xs">صالح حتى<input name="validTo" type="date" className="mt-1 h-11 w-full rounded-xl border px-3"/></label></div>
      <textarea name="notes" placeholder="ملاحظات على الخطة" className="min-h-20 w-full rounded-xl border p-3"/>
      {error&&<p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <button disabled={busy || (planType==="INSTALLMENT"&&Math.abs(remaining)>.001)} className="h-12 rounded-xl bg-forest px-8 font-bold text-white disabled:opacity-40">{busy?"جارٍ الحفظ…":"إضافة الخطة"}</button>
    </form>
  </section>;
}
