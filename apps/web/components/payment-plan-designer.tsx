"use client";

import { FormEvent, useMemo, useState } from "react";
import { CalendarClock, Equal, SlidersHorizontal, WalletCards } from "lucide-react";
import { adminApi, adminErrorMessage } from "@/lib/api";

type Plan = Record<string, any>;
type ScheduleRow = { label: string; percent: number; sequence: number };

const unitLabel: Record<string, string> = { DAY: "يوم", MONTH: "شهر", YEAR: "سنة" };
const toMonths = (value: number, unit: string) => unit === "YEAR" ? value * 12 : unit === "MONTH" ? value : Math.max(0, Math.round(value / 30));
const toDays = (value: number, unit: string) => unit === "YEAR" ? value * 365 : unit === "MONTH" ? value * 30 : value;

function buildSchedule(durationValue: number, durationUnit: string, everyValue: number, everyUnit: string, downPaymentPercent: number) {
  const durationDays = toDays(durationValue, durationUnit);
  const cycleDays = Math.max(1, toDays(everyValue, everyUnit));
  const count = durationDays <= 0 ? 0 : Math.max(1, Math.min(180, Math.ceil(durationDays / cycleDays)));
  const remaining = Math.max(0, 100 - downPaymentPercent);
  if (!count) return [] as ScheduleRow[];
  const each = remaining / count;
  return Array.from({ length: count }, (_, index) => ({ label: `القسط ${index + 1}`, percent: Number(each.toFixed(6)), sequence: index + 1 }));
}

export function PaymentPlanDesigner({
  projectId,
  phaseId,
  plans,
  onChanged,
}: {
  projectId: string;
  phaseId?: string | null;
  plans: Plan[];
  onChanged: () => Promise<void> | void;
}) {
  const [planType, setPlanType] = useState<"CASH" | "INSTALLMENT">("INSTALLMENT");
  const [durationValue, setDurationValue] = useState(8);
  const [durationUnit, setDurationUnit] = useState("YEAR");
  const [everyValue, setEveryValue] = useState(3);
  const [everyUnit, setEveryUnit] = useState("MONTH");
  const [downPaymentPercent, setDownPaymentPercent] = useState(10);
  const [firstAfterValue, setFirstAfterValue] = useState(1);
  const [firstAfterUnit, setFirstAfterUnit] = useState("MONTH");
  const [distributionMode, setDistributionMode] = useState<"EQUAL" | "CUSTOM">("EQUAL");
  const [schedule, setSchedule] = useState<ScheduleRow[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const durationMonths = toMonths(durationValue, durationUnit);
  const customTotal = useMemo(() => schedule.reduce((sum, row) => sum + (Number(row.percent) || 0), 0), [schedule]);
  const customRemaining = Number((100 - downPaymentPercent - customTotal).toFixed(6));
  const endpoint = phaseId ? `/catalog/phases/${phaseId}/payment-plans` : `/catalog/projects/${projectId}/payment-plans`;

  function enableCustom() {
    setDistributionMode("CUSTOM");
    setSchedule(buildSchedule(durationValue, durationUnit, everyValue, everyUnit, downPaymentPercent));
  }

  function distributeEqual() {
    setSchedule(buildSchedule(durationValue, durationUnit, everyValue, everyUnit, downPaymentPercent));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (planType === "INSTALLMENT" && distributionMode === "CUSTOM" && Math.abs(customRemaining) > 0.001) {
      setError(`إجمالي المقدم والدفعات لازم يساوي 100%. المتبقي ${customRemaining.toFixed(2)}%.`);
      return;
    }
    const form = new FormData(event.currentTarget);
    const payload = {
      name: String(form.get("name") || "").trim() || (planType === "CASH" ? "كاش" : `${durationValue} ${unitLabel[durationUnit]}`),
      planType,
      currency: "EGP",
      reservationAmount: String(form.get("reservationAmount") || "").trim() ? Number(form.get("reservationAmount")) : undefined,
      discountPercent: String(form.get("discountPercent") || "").trim() ? Number(form.get("discountPercent")) : undefined,
      maintenancePercent: String(form.get("maintenancePercent") || "").trim() ? Number(form.get("maintenancePercent")) : undefined,
      durationValue: planType === "INSTALLMENT" ? durationValue : 0,
      durationUnit: planType === "INSTALLMENT" ? durationUnit : "MONTH",
      durationMonths: planType === "INSTALLMENT" ? durationMonths : 0,
      downPaymentPercent: planType === "INSTALLMENT" ? downPaymentPercent : 100,
      installmentFrequency: planType === "INSTALLMENT" ? "CUSTOM" : undefined,
      installmentEveryValue: planType === "INSTALLMENT" ? everyValue : undefined,
      installmentEveryUnit: planType === "INSTALLMENT" ? everyUnit : undefined,
      firstInstallmentTiming: planType === "INSTALLMENT" ? "AFTER_DELAY" : undefined,
      firstInstallmentAfterValue: planType === "INSTALLMENT" ? firstAfterValue : undefined,
      firstInstallmentAfterUnit: planType === "INSTALLMENT" ? firstAfterUnit : undefined,
      distributionMode: planType === "INSTALLMENT" ? distributionMode : "EQUAL",
      percentageSchedule: planType === "INSTALLMENT" && distributionMode === "CUSTOM" ? schedule : [],
      notes: String(form.get("notes") || "").trim() || undefined,
      validFrom: String(form.get("validFrom") || "") || undefined,
      validTo: String(form.get("validTo") || "") || undefined,
    };
    try {
      setBusy(true);
      setError("");
      await adminApi.post(endpoint, payload);
      event.currentTarget.reset();
      setDistributionMode("EQUAL");
      setSchedule([]);
      await onChanged();
    } catch (err) {
      setError(adminErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[26px] border border-[#dfe4e0] bg-white p-4 sm:p-5" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[#b08c52]"><WalletCards size={17} /><span className="text-[11px] font-black uppercase tracking-[.18em]">Payment logic</span></div>
          <h2 className="mt-1 text-xl font-black">{phaseId ? "خطط سداد المرحلة" : "خطط سداد المشروع"}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-7 text-[#74817b]">التوزيع المتساوي هو الافتراضي. جدول الدفعات لا يظهر إلا لما تختار توزيع يدوي.</p>
        </div>
        <div className="flex rounded-2xl bg-[#f2f3ef] p-1">
          <button type="button" onClick={() => setPlanType("INSTALLMENT")} className={`rounded-xl px-4 py-2 text-sm font-black ${planType === "INSTALLMENT" ? "bg-[#173f3b] text-white shadow" : ""}`}>تقسيط</button>
          <button type="button" onClick={() => setPlanType("CASH")} className={`rounded-xl px-4 py-2 text-sm font-black ${planType === "CASH" ? "bg-[#173f3b] text-white shadow" : ""}`}>كاش</button>
        </div>
      </div>

      {plans.length ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((plan) => <article key={plan.id} className="rounded-2xl border border-[#e2e6e3] bg-[#faf9f5] p-4">
            <div className="flex items-center justify-between gap-2"><b>{plan.name || (plan.planType === "CASH" ? "كاش" : "تقسيط")}</b><span className="rounded-full bg-white px-2 py-1 text-[11px] font-bold">{plan.planType === "CASH" ? "Cash" : plan.distributionMode === "CUSTOM" ? "Custom" : "Equal"}</span></div>
            <p className="mt-2 text-xs leading-6 text-[#74817b]">{plan.planType === "CASH" ? (plan.discountPercent ? `خصم ${Number(plan.discountPercent)}%` : "سداد كامل") : `مقدم ${Number(plan.downPaymentPercent ?? 0)}% · ${plan.durationValue ?? plan.durationMonths ?? 0} ${unitLabel[plan.durationUnit] ?? "شهر"}`}</p>
            {plan.firstInstallmentAfterValue != null ? <p className="text-xs text-[#74817b]">أول قسط بعد {plan.firstInstallmentAfterValue} {unitLabel[plan.firstInstallmentAfterUnit] ?? ""}</p> : null}
          </article>)}
        </div>
      ) : null}

      <form onSubmit={submit} className="mt-5 space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <input name="name" placeholder="اسم الخطة — اختياري" className="h-12 rounded-2xl border px-3" />
          <input name="reservationAmount" type="number" min="0" step="any" placeholder="مبلغ الحجز — اختياري" className="h-12 rounded-2xl border px-3" />
          <input name="discountPercent" type="number" min="0" max="100" step="any" placeholder="خصم % — اختياري" className="h-12 rounded-2xl border px-3" />
          <input name="maintenancePercent" type="number" min="0" max="100" step="any" placeholder="صيانة % — اختياري" className="h-12 rounded-2xl border px-3" />
        </div>

        {planType === "INSTALLMENT" ? (
          <div className="grid gap-4 rounded-[22px] border border-[#e4e7e4] bg-[#f8f8f4] p-4 lg:grid-cols-2">
            <div>
              <div className="flex items-center gap-2"><CalendarClock size={16} /><b>المدة والدورية</b></div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <input value={durationValue} onChange={(event) => setDurationValue(Math.max(0, Number(event.target.value)))} type="number" min="0" className="h-12 rounded-2xl border bg-white px-3" />
                <select value={durationUnit} onChange={(event) => setDurationUnit(event.target.value)} className="h-12 rounded-2xl border bg-white px-3"><option value="MONTH">شهر</option><option value="YEAR">سنة</option><option value="DAY">يوم</option></select>
                <input value={everyValue} onChange={(event) => setEveryValue(Math.max(1, Number(event.target.value)))} type="number" min="1" className="h-12 rounded-2xl border bg-white px-3" />
                <select value={everyUnit} onChange={(event) => setEveryUnit(event.target.value)} className="h-12 rounded-2xl border bg-white px-3"><option value="MONTH">قسط كل شهر/شهور</option><option value="YEAR">قسط كل سنة/سنين</option><option value="DAY">قسط كل يوم/أيام</option></select>
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2"><Equal size={16} /><b>المقدم وبداية الأقساط</b></div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="relative"><input value={downPaymentPercent} onChange={(event) => setDownPaymentPercent(Math.min(100, Math.max(0, Number(event.target.value))))} type="number" min="0" max="100" className="h-12 w-full rounded-2xl border bg-white px-3 pe-10" /><span className="absolute end-3 top-3.5 text-sm text-[#74817b]">%</span></label>
                <div className="rounded-2xl border bg-white px-3 py-2 text-xs leading-5"><b className="block">{(100 - downPaymentPercent).toFixed(2)}%</b><span className="text-[#74817b]">تتوزع بالتساوي تلقائيًا</span></div>
                <input value={firstAfterValue} onChange={(event) => setFirstAfterValue(Math.max(0, Number(event.target.value)))} type="number" min="0" className="h-12 rounded-2xl border bg-white px-3" />
                <select value={firstAfterUnit} onChange={(event) => setFirstAfterUnit(event.target.value)} className="h-12 rounded-2xl border bg-white px-3"><option value="MONTH">أول قسط بعد شهور</option><option value="YEAR">أول قسط بعد سنين</option><option value="DAY">أول قسط بعد أيام</option></select>
              </div>
            </div>
          </div>
        ) : null}

        {planType === "INSTALLMENT" ? (
          <div className="rounded-[22px] border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><b>توزيع الأقساط</b><p className="mt-1 text-xs text-[#74817b]">افتراضيًا النظام يقسم المتبقي بعد المقدم بالتساوي.</p></div>
              {distributionMode === "EQUAL" ? <button type="button" onClick={enableCustom} className="inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-bold"><SlidersHorizontal size={14} />توزيع يدوي</button> : <button type="button" onClick={() => { setDistributionMode("EQUAL"); setSchedule([]); }} className="h-10 rounded-xl border px-4 text-sm font-bold">رجوع للتوزيع المتساوي</button>}
            </div>
            {distributionMode === "EQUAL" ? <div className="mt-4 rounded-2xl bg-[#edf3f0] p-4 text-sm text-[#26483f]"><b>Equal installments</b><span className="me-2">— لا يوجد جدول يدوي مطلوب.</span></div> : (
              <div className="mt-4">
                <div className="mb-3 flex flex-wrap items-center gap-2"><button type="button" onClick={distributeEqual} className="rounded-xl border px-3 py-2 text-xs font-bold">إعادة توزيع بالتساوي</button><button type="button" onClick={() => setSchedule((rows) => [...rows, { label: `دفعة خاصة ${rows.length + 1}`, percent: 0, sequence: rows.length + 1 }])} className="rounded-xl border px-3 py-2 text-xs font-bold">+ دفعة خاصة</button><span className={`text-xs font-bold ${Math.abs(customRemaining) > .001 ? "text-red-700" : "text-[#173f3b]"}`}>المتبقي {customRemaining.toFixed(2)}%</span></div>
                <div className="max-h-[360px] overflow-auto rounded-2xl border">
                  {schedule.map((row, index) => <div key={index} className="grid grid-cols-[40px_1fr_105px_50px] items-center gap-2 border-b p-2 last:border-0"><span className="text-center text-xs text-[#74817b]">{index + 1}</span><input value={row.label} onChange={(event) => setSchedule((rows) => rows.map((item, i) => i === index ? { ...item, label: event.target.value } : item))} className="h-10 rounded-xl border px-2" /><input value={row.percent} onChange={(event) => setSchedule((rows) => rows.map((item, i) => i === index ? { ...item, percent: Number(event.target.value) } : item))} type="number" min="0" max="100" step="0.000001" className="h-10 rounded-xl border px-2" /><button type="button" onClick={() => setSchedule((rows) => rows.filter((_, i) => i !== index).map((item, i) => ({ ...item, sequence: i + 1 })))} className="text-xs font-bold text-red-700">حذف</button></div>)}
                </div>
              </div>
            )}
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2"><label className="text-xs font-bold">صالح من<input name="validFrom" type="date" className="mt-1 h-11 w-full rounded-xl border px-3 font-normal" /></label><label className="text-xs font-bold">صالح حتى<input name="validTo" type="date" className="mt-1 h-11 w-full rounded-xl border px-3 font-normal" /></label></div>
        <textarea name="notes" placeholder="ملاحظات على الخطة" className="min-h-20 w-full rounded-2xl border p-3" />
        {error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        <button disabled={busy || (planType === "INSTALLMENT" && distributionMode === "CUSTOM" && Math.abs(customRemaining) > .001)} className="h-12 rounded-2xl bg-[#173f3b] px-7 font-black text-white disabled:opacity-40">{busy ? "جارٍ الإضافة…" : "إضافة الخطة"}</button>
      </form>
    </section>
  );
}
