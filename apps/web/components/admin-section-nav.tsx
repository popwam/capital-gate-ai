"use client";

import {
  Activity,
  Building2,
  Database,
  FileSpreadsheet,
  Landmark,
  LayoutDashboard,
  Map,
  MessageSquareText,
  TrendingUp,
  Users,
} from "lucide-react";

import { usePathname } from "next/navigation";

const items = [
  [LayoutDashboard, "لوحة التحكم", "/admin"],
  [FileSpreadsheet, "البيانات والاستيراد", "/admin/data"],
  [Database, "المخزون", "/admin/inventory"],
  [Users, "المطورون", "/admin/developers"],
  [Building2, "المشروعات", "/admin/projects"],
  [Map, "المناطق", "/admin/locations"],

  // Routes مستقلة
  [TrendingUp, "الاستثمار والسوق", "/admin/market"],
  [Landmark, "معرفة المشروعات", "/admin/knowledge"],

  [Users, "العملاء المحتملون", "/admin/leads"],
  [MessageSquareText, "المحادثات", "/admin/conversations"],
  [Activity, "حالة النظام", "/admin/system"],
] as const;

export function AdminSectionNav({
  active,
}: {
  active?: string;
}) {
  const pathname = usePathname();

  return (
    <nav className="admin-section-nav flex flex-row gap-1 p-3 lg:flex-col">
      {items.map(
        ([Icon, label, href], index) => {
          const isExactRoute =
            pathname === href;

          const isChildRoute =
            href !== "/admin" &&
            pathname.startsWith(`${href}/`);

          /*
           * active نستخدمه فقط لو مفيش Route
           * مطابق بالفعل.
           */
          const hasRouteMatch = items.some(
            ([, , itemHref]) =>
              pathname === itemHref ||
              (itemHref !== "/admin" &&
                pathname.startsWith(
                  `${itemHref}/`,
                )),
          );

          const selected =
            isExactRoute ||
            isChildRoute ||
            (!hasRouteMatch &&
              active === label);

          return (
            <a
              key={`${label}-${index}`}
              href={href}
              aria-current={
                selected
                  ? "page"
                  : undefined
              }
              className={[
                "flex min-h-10 shrink-0",
                "items-center gap-2",
                "rounded-xl px-3",
                "text-[13px] font-bold",
                "transition-colors",

                selected
                  ? "bg-forest text-white"
                  : "text-[#59665f] hover:bg-[#eef2ef]",
              ].join(" ")}
            >
              <Icon size={15} />

              <span>{label}</span>
            </a>
          );
        },
      )}
    </nav>
  );
}