"use client";

import {
  Activity,
  Building2,
  Database,
  FileSpreadsheet,
  LayoutDashboard,
  MapPinned,
  MessageSquareText,
  UsersRound,
  Warehouse,
} from "lucide-react";
import { usePathname } from "next/navigation";

type NavItem = {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const groups: NavGroup[] = [
  {
    label: "التشغيل",
    items: [
      { icon: LayoutDashboard, label: "نظرة عامة", href: "/admin" },
      { icon: FileSpreadsheet, label: "البيانات والاستيراد", href: "/admin/data" },
      { icon: Warehouse, label: "المخزون", href: "/admin/inventory" },
    ],
  },
  {
    label: "الكتالوج العقاري",
    items: [
      { icon: UsersRound, label: "المطورون", href: "/admin/developers" },
      { icon: Building2, label: "المشروعات", href: "/admin/projects" },
      { icon: MapPinned, label: "المناطق", href: "/admin/locations" },
    ],
  },
  {
    label: "المبيعات والمحادثات",
    items: [
      { icon: Database, label: "العملاء المحتملون", href: "/admin/leads" },
      { icon: MessageSquareText, label: "المحادثات", href: "/admin/conversations" },
    ],
  },
  {
    label: "النظام",
    items: [{ icon: Activity, label: "حالة النظام والذكاء", href: "/admin/system" }],
  },
];

function isSelected(pathname: string, href: string) {
  if (href === "/admin") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminSectionNav({ onNavigate }: { active?: string; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-5 px-3 py-4" aria-label="التنقل الإداري">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="mb-2 px-3 text-[11px] font-bold tracking-[.08em] text-white/40">
            {group.label}
          </p>
          <div className="space-y-1">
            {group.items.map(({ icon: Icon, label, href }) => {
              const selected = isSelected(pathname, href);
              return (
                <a
                  key={href}
                  href={href}
                  onClick={onNavigate}
                  aria-current={selected ? "page" : undefined}
                  className={`group flex min-h-11 items-center gap-3 rounded-xl px-3 text-[14px] font-bold transition-all ${
                    selected
                      ? "bg-white text-[#143d34] shadow-sm"
                      : "text-white/72 hover:bg-white/8 hover:text-white"
                  }`}
                >
                  <span
                    className={`grid h-8 w-8 place-items-center rounded-lg transition-colors ${
                      selected ? "bg-[#e7f2ed]" : "bg-white/7 group-hover:bg-white/10"
                    }`}
                  >
                    <Icon size={17} strokeWidth={2} />
                  </span>
                  <span>{label}</span>
                </a>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
