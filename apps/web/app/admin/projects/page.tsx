"use client";
import { FormEvent, useEffect, useState } from "react";
import { BookOpen, Building2, MapPin, Plus } from "lucide-react";
import { AdminSectionNav } from "@/components/admin-section-nav";
import { adminApi, adminErrorMessage } from "@/lib/api";
type Developer = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  _count?: { projects: number; units: number };
};
type Location = { id: string; name: string; type: string };
type Project = {
  id: string;
  name: string;
  slug: string;
  developer: { id: string; name: string };
  location?: { id: string; name: string } | null;
  _count?: { units: number; knowledgeItems: number };
};
const slug = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [developers, setDevelopers] = useState<Developer[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [error, setError] = useState("");
  const [show, setShow] = useState<"developer" | "project" | null>(null);
  const load = () =>
    Promise.all([
      adminApi.get<Project[]>("/catalog/projects"),
      adminApi.get<Developer[]>("/catalog/developers"),
      adminApi.get<Location[]>("/locations"),
    ])
      .then(([p, d, l]) => {
        setProjects(p);
        setDevelopers(d);
        setLocations(l);
      })
      .catch((e) => setError(adminErrorMessage(e)));
  useEffect(() => {
    void load();
  }, []);
  async function developer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await adminApi.post("/catalog/developers", {
        ...data,
        slug: slug(String(data.name)),
      });
      setShow(null);
      load();
    } catch (e) {
      setError(adminErrorMessage(e));
    }
  }
  async function project(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await adminApi.post("/catalog/projects", {
        ...data,
        locationId: data.locationId || undefined,
        slug: slug(String(data.name)),
      });
      setShow(null);
      load();
    } catch (e) {
      setError(adminErrorMessage(e));
    }
  }
  async function editDeveloper(item: Developer) { const name=prompt("اسم المطور",item.name)?.trim(); if(!name)return; try{await adminApi.patch(`/catalog/developers/${item.id}`,{name,slug:slug(name),description:item.description||undefined});load()}catch(e){setError(adminErrorMessage(e))} }
  async function editProject(item: Project) { const name=prompt("اسم المشروع",item.name)?.trim(); if(!name)return; try{await adminApi.patch(`/catalog/projects/${item.id}`,{name,slug:slug(name)});load()}catch(e){setError(adminErrorMessage(e))} }
  return (
    <main className="min-h-screen bg-[#f6f5f1]" dir="rtl">
      <header className="border-b bg-white px-5 py-5">
        <div className="mx-auto max-w-7xl">
          <h1 className="text-2xl font-bold">المطورون والمشروعات</h1>
          <p className="mt-2 text-sm text-[#78837e]">
            إدارة بيانات المشروع، ربط المنطقة، ومراجعة المعرفة والمستندات.
          </p>
        </div>
      </header>
      <AdminSectionNav active="المطورون والمشروعات" />
      <section className="mx-auto max-w-7xl p-5 sm:p-8">
        {error && (
          <div className="mb-4 rounded-xl bg-red-50 p-4 text-red-800">
            {error}
          </div>
        )}
        <div className="mb-5 flex flex-wrap gap-2">
          <button
            onClick={() => setShow("developer")}
            className="flex h-10 items-center gap-2 rounded-xl border bg-white px-4 text-sm font-bold"
          >
            <Plus size={15} />
            إضافة مطور
          </button>
          <button
            onClick={() => setShow("project")}
            className="flex h-10 items-center gap-2 rounded-xl bg-forest px-4 text-sm font-bold text-white"
          >
            <Plus size={15} />
            إضافة مشروع
          </button>
        </div>
        <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {developers.map((item) => (
            <div key={item.id} className="rounded-2xl border bg-white p-4">
              <Building2 className="text-forest" size={18} />
              <h2 className="mt-3 font-bold" dir="auto">
                {item.name}
              </h2>
              <p className="mt-2 text-xs text-[#78837e]">
                {item._count?.projects || 0} مشروع · {item._count?.units || 0}{" "}
                وحدة
              </p>
              <button onClick={()=>editDeveloper(item)} className="mt-3 rounded-lg border px-3 py-1 text-xs font-bold">تعديل</button>
            </div>
          ))}
        </div>
        <h2 className="mb-4 text-lg font-bold">المشروعات</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((item) => (
            <a
              key={item.id}
              href={`/admin/projects/${item.id}/knowledge`}
              className="group rounded-2xl border bg-white p-5 shadow-sm transition hover:-translate-y-1"
            >
              <div className="flex items-start justify-between">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#e4efe9] text-forest">
                  <Building2 size={17} />
                </div>
                <BookOpen size={16} />
              </div>
              <h3 className="mt-4 text-base font-bold" dir="auto">
                {item.name}
              </h3>
              <p className="mt-1 text-sm text-[#7d8983]" dir="auto">
                {item.developer.name}
              </p>
              <p className="mt-3 flex items-center gap-1 text-xs text-[#8b958f]">
                <MapPin size={12} />
                <span dir="auto">
                  {item.location?.name || "لم تُحدد المنطقة"}
                </span>
              </p>
              <p className="mt-2 text-xs">
                {item._count?.units || 0} وحدة ·{" "}
                {item._count?.knowledgeItems || 0} معلومة
              </p>
              <button onClick={(event)=>{event.preventDefault();void editProject(item)}} className="mt-3 rounded-lg border px-3 py-1 text-xs font-bold">تعديل المشروع</button>
            </a>
          ))}
        </div>
      </section>
      {show && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4">
          <form
            onSubmit={show === "developer" ? developer : project}
            className="w-full max-w-lg rounded-2xl bg-white p-5"
          >
            <h2 className="text-lg font-bold">
              {show === "developer" ? "إضافة مطور" : "إضافة مشروع"}
            </h2>
            <div className="mt-4 space-y-3">
              <input
                required
                name="name"
                placeholder="الاسم"
                className="h-11 w-full rounded-xl border px-3 text-base"
              />
              {show === "developer" ? (
                <textarea
                  name="description"
                  placeholder="نبذة اختيارية"
                  className="min-h-24 w-full rounded-xl border p-3"
                />
              ) : (
                <>
                  <select
                    required
                    name="developerId"
                    className="h-11 w-full rounded-xl border px-3"
                  >
                    <option value="">اختر المطور</option>
                    {developers.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                  <select
                    name="locationId"
                    className="h-11 w-full rounded-xl border px-3"
                  >
                    <option value="">اختر المنطقة</option>
                    {locations.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                  <textarea
                    name="description"
                    placeholder="وصف المشروع"
                    className="min-h-24 w-full rounded-xl border p-3"
                  />
                </>
              )}
              <div className="flex gap-2">
                <button className="h-11 flex-1 rounded-xl bg-forest font-bold text-white">
                  حفظ
                </button>
                <button
                  type="button"
                  onClick={() => setShow(null)}
                  className="h-11 rounded-xl border px-5"
                >
                  إلغاء
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
