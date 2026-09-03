"use client";
import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Building2, Plus, Search } from "lucide-react";
import { adminApi, adminErrorMessage } from "@/lib/api";
import { CatalogDeleteButton } from "@/components/catalog-delete-button";

type Developer = { id: string; name: string; slug: string; brandName?: string | null; country?: string | null; _count?: { projects: number; units: number } };
const makeSlug = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");

export default function DevelopersPage() {
  const [items, setItems] = useState<Developer[]>([]), [search, setSearch] = useState(""), [error, setError] = useState(""), [show, setShow] = useState(false);
  const load = () => adminApi.get<Developer[]>("/catalog/developers").then(setItems).catch(error => setError(adminErrorMessage(error)));
  useEffect(() => { void load(); }, []);
  const filtered = useMemo(() => items.filter(item => `${item.name} ${item.brandName ?? ""} ${item.country ?? ""}`.toLowerCase().includes(search.toLowerCase())), [items, search]);
  async function create(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get("name") ?? "").trim(); try { await adminApi.post("/catalog/developers", { name, slug: makeSlug(name) }); setShow(false); await load(); } catch (error) { setError(adminErrorMessage(error)); } }
  return <main className="mx-auto min-h-screen max-w-7xl p-4 sm:p-8" dir="rtl">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-2xl font-bold">المطورون</h1><p className="mt-2 text-sm text-[#68756f]">هوية المطور، سجله السابق، وانتشاره وتخصصاته الموثقة.</p></div><button onClick={() => setShow(true)} className="flex h-11 items-center gap-2 rounded-xl bg-forest px-5 text-sm font-bold text-white"><Plus size={17}/>إضافة مطور</button></div>
    {error && <div className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</div>}
    <label className="mt-6 flex h-11 max-w-md items-center gap-2 rounded-xl border bg-white px-3"><Search size={16}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="ابحث عن مطور" className="w-full bg-transparent outline-none"/></label>
    <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{filtered.map(item => <article key={item.id} className="flex min-h-52 flex-col rounded-2xl border bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><Link href={`/admin/developers/${item.id}`} className="min-w-0 flex-1 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest"><Building2 size={20} className="text-forest"/><h2 className="mt-4 truncate text-lg font-bold" dir="auto">{item.brandName || item.name}</h2><p className="mt-2 text-xs text-[#748079]">{item._count?.projects ?? 0} مشروع · {item._count?.units ?? 0} وحدة</p>{item.country && <p className="mt-2 text-xs" dir="auto">{item.country}</p>}</Link><div className="mt-4 flex items-center justify-between gap-3 border-t pt-3"><Link href={`/admin/developers/${item.id}`} className="text-xs font-bold text-forest hover:underline">فتح بيانات المطور</Link><CatalogDeleteButton id={item.id} name={item.brandName || item.name} resource="developers" entityLabel="المطور" onDeleted={load}/></div></article>)}</div>
    {!error && filtered.length === 0 ? <div className="mt-5 rounded-2xl border border-dashed bg-white p-8 text-center"><Building2 className="mx-auto text-[#8a9590]"/><p className="mt-3 font-bold">{items.length ? "لا يوجد مطور مطابق للبحث." : "لم تتم إضافة مطورين بعد."}</p></div> : null}
    {show && <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4"><form onSubmit={create} className="w-full max-w-md rounded-2xl bg-white p-5"><h2 className="text-lg font-bold">إضافة مطور</h2><input required name="name" placeholder="اسم المطور" className="mt-4 h-11 w-full rounded-xl border px-3"/><div className="mt-4 flex gap-2"><button className="h-11 flex-1 rounded-xl bg-forest font-bold text-white">حفظ كمسودة</button><button type="button" onClick={() => setShow(false)} className="h-11 rounded-xl border px-5">إلغاء</button></div></form></div>}
  </main>;
}
