"use client";

import {
  Activity,
  BarChart3,
  Building2,
  CalendarClock,
  ClipboardList,
  Cog,
  LayoutDashboard,
  MapPinned,
  MessageSquareText,
  PanelsTopLeft,
  UserRoundCog,
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
    label: "مساحة العمل",
    items: [
      { icon: LayoutDashboard, label: "نظرة عامة", href: "/admin" },
      { icon: MessageSquareText, label: "المحادثات", href: "/admin/conversations" },
      { icon: ClipboardList, label: "المتطلبات العقارية", href: "/admin/requirements" },
      { icon: CalendarClock, label: "المتابعات", href: "/admin/follow-ups" },
      { icon: UsersRound, label: "فرص البيع", href: "/admin/leads" },
      { icon: Warehouse, label: "المخزون", href: "/admin/inventory" },
      { icon: UserRoundCog, label: "الفريق", href: "/admin/team" },
      { icon: BarChart3, label: "التحليلات", href: "/admin/analytics" },
      { icon: Cog, label: "الإعدادات", href: "/admin/settings" },
    ],
  },
  {
    label: "بيانات العقارات",
    items: [
      { icon: PanelsTopLeft, label: "المشروعات", href: "/admin/projects" },
      { icon: Building2, label: "المطورون", href: "/admin/developers" },
      { icon: MapPinned, label: "المناطق", href: "/admin/locations" },
    ],
  },
  {
    label: "أدوات الإدارة",
    items: [{ icon: Activity, label: "حالة النظام", href: "/admin/system" }],
  },
];

function isSelected(pathname: string, href: string) {
  if (href === "/admin") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminSectionNav({ onNavigate }: { active?: string; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-4 px-2 py-3" aria-label="التنقل الإداري">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="mb-1 px-3 text-[10px] font-bold text-[#8a9590]">
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
                  className={`group flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-[13px] font-bold transition-all ${
                    selected
                      ? "bg-[#edf3f0] text-[#245d50]"
                      : "text-[#5f6d67] hover:bg-[#f4f6f3] hover:text-[#17211e]"
                  }`}
                >
                  <span
                    className="grid h-7 w-7 place-items-center"
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
