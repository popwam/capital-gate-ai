"use client";
import {
  Building2,
  LayoutDashboard,
  Map,
  MessageSquareText,
  Database,
  FileSpreadsheet,
  Activity,
  Users,
} from "lucide-react";

const items = [
  [LayoutDashboard, "لوحة التحكم", "/admin"],
  [FileSpreadsheet, "البيانات والاستيراد", "/admin/data"],
  [Database, "المخزون", "/admin/inventory"],
  [Building2, "المطورون والمشروعات", "/admin/projects"],
  [Map, "المناطق", "/admin/locations"],
  [Users, "العملاء المحتملون", "/admin/leads"],
  [MessageSquareText, "المحادثات", "/admin/conversations"],
  [Activity, "حالة النظام", "/admin/system"],
] as const;
export function AdminSectionNav({ active }: { active: string }) {
  return (
    <nav className="scrollbar-none flex gap-1 overflow-x-auto border-b bg-white px-4 py-2 sm:px-6">
      {items.map(([Icon, label, href]) => (
        <a
          key={label}
          href={href}
          className={`flex h-9 shrink-0 items-center gap-2 rounded-xl px-3 text-[9px] font-bold ${active === label ? "bg-forest text-white" : "text-[#66736d] hover:bg-[#eef2ef]"}`}
        >
          <Icon size={13} />
          {label}
        </a>
      ))}
    </nav>
  );
}
