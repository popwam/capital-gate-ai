"use client";

import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { AdminSectionNav } from "./admin-section-nav";
import { LogoMark } from "./logo";
import { adminApi } from "@/lib/api";

export function AdminShell({ children, privateEntry = false }: { children: React.ReactNode; privateEntry?: boolean }) {
  const pathname = usePathname();
  if (privateEntry || pathname === "/admin/login") return children;
  return <div className="min-h-[100dvh] bg-[#f6f5f1] text-ink" dir="rtl">
    <header className="sticky top-0 z-40 border-b bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-4 sm:px-7">
        <LogoMark />
        <div className="text-center"><p className="text-[15px] font-bold">إدارة مقار</p><p className="text-[11px] text-[#75817b]">مساحة التشغيل الخاصة</p></div>
        <button onClick={async () => { await adminApi.logout(); location.href = "/"; }} className="flex h-10 items-center gap-2 rounded-xl border px-3 text-[13px] font-bold text-[#59655f]"><LogOut size={15}/> تسجيل الخروج</button>
      </div>
      <AdminSectionNav active="" />
    </header>
    <div className="admin-shell-content">{children}</div>
  </div>;
}
