"use client";
import { Activity, Building2, Database, FileSpreadsheet, Landmark, LayoutDashboard, Map, MessageSquareText, TrendingUp, Users } from "lucide-react";
import { usePathname } from "next/navigation";
const items = [
  [LayoutDashboard,"لوحة التحكم","/admin"],
  [FileSpreadsheet,"البيانات والاستيراد","/admin/data"],
  [Database,"المخزون","/admin/inventory"],
  [Users,"المطورون","/admin/developers"],
  [Building2,"المشروعات","/admin/projects"],
  [Map,"المناطق","/admin/locations"],
  [TrendingUp,"الاستثمار والسوق","/admin/projects"],
  [Landmark,"معرفة المشروعات","/admin/projects"],
  [Users,"العملاء المحتملون","/admin/leads"],
  [MessageSquareText,"المحادثات","/admin/conversations"],
  [Activity,"حالة النظام","/admin/system"],
] as const;
export function AdminSectionNav({active}:{active:string}){const pathname=usePathname();return <nav className="admin-section-nav flex flex-row gap-1 p-3 lg:flex-col">{items.map(([Icon,label,href],index)=>{const selected=active===label||pathname===href||(href!=="/admin"&&pathname.startsWith(`${href}/`));return <a key={`${label}-${index}`} href={href} className={`flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-[13px] font-bold ${selected?"bg-forest text-white":"text-[#59665f] hover:bg-[#eef2ef]"}`}><Icon size={15}/><span>{label}</span></a>})}</nav>}
