"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Bell, CheckCircle2, Loader2, LogOut, Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { AdminSectionNav } from "./admin-section-nav";
import { adminApi, type AdminMutationDetail } from "@/lib/api";

const routeTitles: Array<[string, string, string]> = [
  ["/admin/requirements", "المتطلبات العقارية", "كل ما يبحث عنه العملاء في مكان واحد"],
  ["/admin/follow-ups", "المتابعات", "المهام المجدولة وقنوات التواصل"],
  ["/admin/team", "الفريق", "ملكية المحادثات وتوزيع العمل"],
  ["/admin/analytics", "التحليلات", "مؤشرات رحلة العميل والمبيعات"],
  ["/admin/settings", "الإعدادات", "إعدادات Nadim والتشغيل"],
  ["/admin/data/import", "استيراد المخزون", "مراجعة الملف وربط البيانات قبل الحفظ"],
  ["/admin/data", "البيانات والاستيراد", "إدارة دفعات المخزون ومصادرها"],
  ["/admin/inventory", "المخزون", "الوحدات والأسعار والحالة والموقع الداخلي"],
  ["/admin/developers", "المطورون", "بيانات المطورين وسابقة الأعمال"],
  ["/admin/projects", "المشروعات", "المشروع، المستر بلان، البوابات وخطط السداد"],
  ["/admin/locations", "المناطق", "الهيكل الجغرافي والمسافات الموثقة"],
  ["/admin/leads", "فرص البيع", "متابعة الفرص المؤهلة والمهام القادمة"],
  ["/admin/conversations", "المحادثات", "مراجعة سياق محادثات العملاء"],
  ["/admin/system", "حالة النظام", "صحة الذكاء الاصطناعي والاستخدام"],
  ["/admin", "نظرة عامة", "مركز تشغيل Cg Ai"],
];

function titleFor(pathname: string) {
  return routeTitles.find(([path]) => pathname === path || (path !== "/admin" && pathname.startsWith(`${path}/`))) ?? routeTitles.at(-1)!;
}

export function AdminShell({ children, privateEntry = false }: { children: React.ReactNode; privateEntry?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mutation, setMutation] = useState<AdminMutationDetail | null>(null);
  const [activeMutationCount, setActiveMutationCount] = useState(0);
  const [trustAlertCount, setTrustAlertCount] = useState(0);
  const activeMutationsRef = useRef(new Set<string>());
  useEffect(() => {
    if (privateEntry || pathname === "/admin/login") return;
    let cancelled = false;
    const loadTrustAlerts = async () => {
      try {
        const summary = await adminApi.get<{ trustAlertsOpen?: number }>("/leads/summary");
        if (!cancelled) setTrustAlertCount(Number(summary.trustAlertsOpen ?? 0));
      } catch {
        // A trust badge must never block the admin shell. The leads page still shows the full alert list.
      }
    };
    void loadTrustAlerts();
    const timer = window.setInterval(loadTrustAlerts, 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [pathname, privateEntry]);

  useEffect(() => {
    let clearTimer: number | undefined;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<AdminMutationDetail>).detail;
      if (clearTimer) window.clearTimeout(clearTimer);
      if (detail.state === "saving") {
        activeMutationsRef.current.add(detail.id);
        setActiveMutationCount(activeMutationsRef.current.size);
        setMutation(detail);
        return;
      }
      activeMutationsRef.current.delete(detail.id);
      setActiveMutationCount(activeMutationsRef.current.size);
      if (detail.state === "error") {
        setMutation(detail);
        clearTimer = window.setTimeout(() => { if (!activeMutationsRef.current.size) setMutation(null); }, 9000);
        return;
      }
      if (activeMutationsRef.current.size) {
        setMutation({ ...detail, state: "saving" });
      } else {
        setMutation(detail);
        clearTimer = window.setTimeout(() => setMutation((current) => current?.state === "saved" ? null : current), 3000);
      }
    };
    window.addEventListener("cg-admin-mutation", handler);
    return () => { window.removeEventListener("cg-admin-mutation", handler); if (clearTimer) window.clearTimeout(clearTimer); activeMutationsRef.current.clear(); };
  }, []);
  if (privateEntry || pathname === "/admin/login") return children;

  const [, title] = titleFor(pathname);
  async function logout() {
    await adminApi.logout();
    location.href = "/";
  }

  return (
    <div className="min-h-[100dvh] bg-[#f4f5f2] text-[#17211e]" dir="rtl">
      <aside className="fixed inset-y-0 right-0 z-50 hidden w-[236px] flex-col border-l border-[#e1e5e1] bg-white text-[#17211e] lg:flex">
        <div className="flex h-[60px] items-center border-b border-[#e8ebe8] px-5">
          <b className="text-lg tracking-[-.04em]">Cg</b>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-none">
          <AdminSectionNav />
        </div>
        <div className="border-t border-[#e8ebe8] p-3">
          <button onClick={logout} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg text-xs font-bold text-[#68756f] hover:bg-[#f3f5f2] hover:text-[#17211e]">
            <LogOut size={16} /> تسجيل الخروج
          </button>
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <button aria-label="إغلاق القائمة" className="absolute inset-0 bg-black/20" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 right-0 flex w-[276px] max-w-[86vw] flex-col bg-white text-[#17211e] shadow-xl">
            <div className="flex h-[60px] items-center justify-between border-b border-[#e8ebe8] px-4">
              <b className="text-lg tracking-[-.04em]">Cg</b>
              <button onClick={() => setOpen(false)} className="grid h-11 w-11 place-items-center rounded-lg hover:bg-[#f3f5f2]"><X size={18} /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto"><AdminSectionNav onNavigate={() => setOpen(false)} /></div>
          </aside>
        </div>
      )}

      <div className="lg:mr-[236px]">
        <header className="sticky top-0 z-40 border-b border-[#e1e5e1] bg-white">
          <div className="flex min-h-[60px] items-center justify-between gap-4 px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button onClick={() => setOpen(true)} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg hover:bg-[#f3f5f2] lg:hidden" aria-label="فتح القائمة"><Menu size={19} /></button>
              <div className="min-w-0">
                <h1 className="truncate text-[16px] font-bold sm:text-[17px]">{title}</h1>
              </div>
            </div>
<div className="flex min-w-[132px] items-center justify-end gap-2">
              {trustAlertCount > 0 ? <a href="/admin/leads" className="inline-flex h-10 items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 text-xs font-black text-amber-800" title="بيانات عملاء تحتاج مراجعة"><Bell size={14}/><span>{trustAlertCount}</span><span className="hidden sm:inline">تحتاج تحقق</span></a> : null}
              {mutation ? <div className={`inline-flex max-w-[360px] items-center gap-2 rounded-full border px-3 py-2 text-xs font-black shadow-sm ${mutation.state === "saving" ? "border-[#d7ded9] bg-white text-[#55645e]" : mutation.state === "saved" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
                {mutation.state === "saving" ? <Loader2 size={14} className="animate-spin" /> : mutation.state === "saved" ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                <span className="truncate">{mutation.state === "saving" ? `جاري الحفظ${activeMutationCount > 1 ? ` · ${activeMutationCount} عمليات` : ""}…` : mutation.state === "saved" ? "تم حفظ كل التغييرات" : "فشل الحفظ"}</span>
                {mutation.state === "error" && mutation.requestId ? <span dir="ltr" className="hidden font-mono text-[9px] opacity-60 sm:inline">{mutation.requestId.slice(0, 8)}</span> : null}
              </div> : <div className="h-10" aria-hidden="true" />}
            </div>
          </div>
        </header>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
