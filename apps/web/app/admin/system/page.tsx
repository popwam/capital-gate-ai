"use client";
import { useEffect, useState } from "react";
import { Activity, CheckCircle2, XCircle } from "lucide-react";
import { AdminSectionNav } from "@/components/admin-section-nav";
import { adminApi, adminErrorMessage } from "@/lib/api";
type Health = {
  provider: string;
  configured: boolean;
  healthy: boolean;
  model: string | null;
  errorCode?: string;
};
type Usage = {
  periodDays: number;
  byProvider: Array<{
    provider: string;
    success: boolean;
    _count: { _all: number };
    _avg: { latencyMs: number | null };
  }>;
};
export default function SystemPage() {
  const [health, setHealth] = useState<Health[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([
      adminApi.get<Health[]>("/system/ai-health"),
      adminApi.get<Usage>("/system/ai-usage"),
    ])
      .then(([h, u]) => {
        setHealth(h);
        setUsage(u);
      })
      .catch((e) => setError(adminErrorMessage(e)));
  }, []);
  return (
    <main className="min-h-screen bg-[#f6f5f1]" dir="rtl">
      <header className="border-b bg-white px-5 py-5">
        <div className="mx-auto max-w-6xl">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Activity />
            حالة النظام والذكاء الاصطناعي
          </h1>
          <p className="mt-2 text-sm text-[#68756f]">
            معلومات آمنة عن التهيئة والصحة بدون عرض أي مفاتيح سرية.
          </p>
        </div>
      </header>
      <AdminSectionNav active="حالة النظام" />
      <section className="mx-auto max-w-6xl p-5">
        {error && (
          <div className="rounded-xl bg-red-50 p-4 text-red-800">{error}</div>
        )}
        <div className="grid gap-4 md:grid-cols-3">
          {health.map((item) => (
            <div
              key={item.provider}
              className="rounded-2xl border bg-white p-5"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">{item.provider}</h2>
                {item.healthy ? (
                  <CheckCircle2 className="text-green-700" />
                ) : (
                  <XCircle className="text-red-700" />
                )}
              </div>
              <p className="mt-4 text-sm" dir="auto">
                {item.model || "غير مهيأ"}
              </p>
              <p className="mt-2 text-xs text-[#78847e]">
                مهيأ: {item.configured ? "نعم" : "لا"} · سليم:{" "}
                {item.healthy ? "نعم" : "لا"}
              </p>
              {item.errorCode && (
                <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">
                  {item.errorCode}
                </p>
              )}
            </div>
          ))}
        </div>
        <div className="mt-6 rounded-2xl border bg-white p-5">
          <h2 className="font-bold">
            استخدام آخر {usage?.periodDays || 7} أيام
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {usage?.byProvider.map((row, i) => (
              <div
                key={`${row.provider}-${i}`}
                className="rounded-xl bg-[#f0f2ef] p-4"
              >
                <p className="font-bold">{row.provider}</p>
                <p className="mt-1 text-sm">
                  {row.success ? "ناجح" : "فشل"}: {row._count._all}
                </p>
                <p className="text-xs text-[#78847e]">
                  متوسط {Math.round(row._avg.latencyMs || 0)} ms
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
