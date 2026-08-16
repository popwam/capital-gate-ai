"use client";
import { FormEvent, useEffect, useState } from "react";
import { Archive, CheckSquare, Edit3, Search } from "lucide-react";
import { adminApi, adminErrorMessage } from "@/lib/api";
type Unit = {
  id: string;
  externalUnitId: string;
  unitType?: string | null;
  bedrooms?: number | null;
  builtUpArea?: string | null;
  price?: string | null;
  currency?: string | null;
  status: string;
  updatedAt: string;
  project: { id: string; name: string; location?: { name: string } | null };
  developer: { id: string; name: string };
  sourceImport?: { id: string; name?: string | null; fileName: string } | null;
  media?: Array<{ id: string; type: string; url: string; altTextAr?: string | null; altText?: string | null; isCover?: boolean }> | null;
};
type Page = { items: Unit[]; page: number; pageSize: number; total: number };
export default function InventoryPage() {
  const [data, setData] = useState<Page>({
    items: [],
    page: 1,
    pageSize: 50,
    total: 0,
  });
  const [filters, setFilters] = useState({
    unitCode: "",
    status: "",
    unitType: "",
    minPrice: "",
    maxPrice: "",
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<Unit | null>(null);
  const [editingDetails, setEditingDetails] = useState<Unit | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = (page = 1) => {
    const q = new URLSearchParams({
      ...filters,
      page: String(page),
      pageSize: "50",
    });
    adminApi
      .get<Page>(`/catalog/units?${q}`)
      .then(setData)
      .catch((e) => setError(adminErrorMessage(e)));
  };
  useEffect(() => {
    void load();
  }, []);
  async function openEditor(unit: Unit) {
    setEditing(unit);
    setEditingDetails(null);
    try {
      const detail = await adminApi.get<Unit>(`/catalog/units/${unit.id}`);
      setEditingDetails(detail);
    } catch (e) {
      setError(adminErrorMessage(e));
    }
  }
  async function uploadUnitMedia(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const form = new FormData(e.currentTarget);
    form.append("unitId", editing.id);
    try {
      setBusy(true);
      await adminApi.upload("/catalog/media", form);
      const detail = await adminApi.get<Unit>(`/catalog/units/${editing.id}`);
      setEditingDetails(detail);
      e.currentTarget.reset();
    } catch (err) {
      setError(adminErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const form = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await adminApi.patch(
        `/catalog/units/${editing.id}`,
        Object.fromEntries([...form.entries()].filter(([, v]) => v !== "")),
      );
      setEditing(null);
      load(data.page);
    } catch (e) {
      setError(adminErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function bulk(action: string) {
    if (!selected.length) return;
    const confirmation = prompt(
      `سيتم تطبيق الإجراء على ${selected.length} وحدة. اكتب CONFIRM ${selected.length}`,
    );
    if (confirmation !== `CONFIRM ${selected.length}`) return;
    setBusy(true);
    try {
      await adminApi.post("/catalog/units/bulk", {
        unitIds: selected,
        action,
        confirmation,
      });
      setSelected([]);
      load(data.page);
    } catch (e) {
      setError(adminErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto max-w-[1480px] p-4 sm:p-6 lg:p-8" dir="rtl">
      <section className="mb-5 rounded-[24px] border border-[#dfe4e0] bg-white p-5 sm:p-6">
        <h2 className="text-[24px] font-bold">المخزون العقاري</h2><p className="mt-1 text-[13px] text-[#74817b]">ابحث وعدّل الوحدات، الأسعار، الحالة، خطط السداد والموقع داخل المستر بلان.</p>
      </section>
      <section>
        {error && (
          <div className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">
            {error}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            load(1);
          }}
          className="mb-4 grid gap-2 rounded-2xl border bg-white p-4 sm:grid-cols-6"
        >
          <input
            placeholder="كود الوحدة"
            value={filters.unitCode}
            onChange={(e) =>
              setFilters({ ...filters, unitCode: e.target.value })
            }
            className="h-11 rounded-xl border px-3 text-base"
          />
          <input
            placeholder="نوع الوحدة"
            value={filters.unitType}
            onChange={(e) =>
              setFilters({ ...filters, unitType: e.target.value })
            }
            className="h-11 rounded-xl border px-3 text-base"
          />
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            className="h-11 rounded-xl border px-3 text-sm"
          >
            <option value="">كل الحالات</option>
            {[
              "AVAILABLE",
              "RESERVED",
              "SOLD",
              "UNAVAILABLE",
              "CONTACT_SALES",
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <input
            type="number"
            placeholder="أقل سعر"
            value={filters.minPrice}
            onChange={(e) =>
              setFilters({ ...filters, minPrice: e.target.value })
            }
            className="h-11 rounded-xl border px-3 text-base"
          />
          <input
            type="number"
            placeholder="أعلى سعر"
            value={filters.maxPrice}
            onChange={(e) =>
              setFilters({ ...filters, maxPrice: e.target.value })
            }
            className="h-11 rounded-xl border px-3 text-base"
          />
          <button className="flex h-11 items-center justify-center gap-2 rounded-xl bg-forest text-sm font-bold text-white">
            <Search size={15} />
            بحث
          </button>
        </form>
        {selected.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl bg-[#183b33] p-3 text-white">
            <span className="px-2 text-sm font-bold">
              {selected.length} محددة
            </span>
            {[
              ["MARK_AVAILABLE", "متاحة"],
              ["MARK_RESERVED", "محجوزة"],
              ["MARK_SOLD", "مباعة"],
              ["MARK_UNAVAILABLE", "غير متاحة"],
              ["ARCHIVE", "أرشفة"],
            ].map(([action, label]) => (
              <button
                key={action}
                disabled={busy}
                onClick={() => bulk(action)}
                className="rounded-lg bg-white/10 px-3 py-2 text-xs font-bold hover:bg-white/20"
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="overflow-x-auto rounded-2xl border bg-white">
          <table className="w-full min-w-[1000px] text-right text-sm">
            <thead className="bg-[#eef1ee]">
              <tr>
                <th className="p-3">
                  <CheckSquare size={15} />
                </th>
                {[
                  "الكود",
                  "المشروع",
                  "المطور",
                  "النوع",
                  "الغرف",
                  "المساحة",
                  "السعر",
                  "الحالة",
                  "مصدر البيانات",
                  "تعديل",
                ].map((x) => (
                  <th key={x} className="p-3">
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.items.map((unit) => (
                <tr key={unit.id}>
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={selected.includes(unit.id)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, unit.id]
                            : selected.filter((id) => id !== unit.id),
                        )
                      }
                    />
                  </td>
                  <td className="p-3 font-bold" dir="auto">
                    {unit.externalUnitId}
                  </td>
                  <td className="p-3" dir="auto">
                    {unit.project.name}
                    <span className="block text-xs text-[#84908a]">
                      {unit.project.location?.name}
                    </span>
                  </td>
                  <td className="p-3" dir="auto">
                    {unit.developer.name}
                  </td>
                  <td className="p-3" dir="auto">
                    {unit.unitType || "—"}
                  </td>
                  <td className="p-3">{unit.bedrooms ?? "—"}</td>
                  <td className="p-3">{unit.builtUpArea || "—"}</td>
                  <td className="p-3" dir="ltr">
                    {unit.price
                      ? `${Number(unit.price).toLocaleString("en")} ${unit.currency || "EGP"}`
                      : "—"}
                  </td>
                  <td className="p-3">
                    <span className="rounded-full bg-[#e7efe9] px-2 py-1 text-xs font-bold">
                      {unit.status}
                    </span>
                  </td>
                  <td className="p-3 text-xs" dir="auto">
                    {unit.sourceImport?.name ||
                      unit.sourceImport?.fileName ||
                      "تعديل يدوي"}
                  </td>
                  <td className="p-3">
                    <button
                      onClick={() => void openEditor(unit)}
                      className="rounded-lg border p-2"
                    >
                      <Edit3 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex items-center justify-between text-sm">
          <button
            disabled={data.page <= 1}
            onClick={() => load(data.page - 1)}
            className="rounded-lg border bg-white px-4 py-2"
          >
            السابق
          </button>
          <span>
            {data.page} · {data.total} وحدة
          </span>
          <button
            disabled={data.page * data.pageSize >= data.total}
            onClick={() => load(data.page + 1)}
            className="rounded-lg border bg-white px-4 py-2"
          >
            التالي
          </button>
        </div>
      </section>
      {editing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4">
          <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">
                تعديل الوحدة <span dir="auto">{editing.externalUnitId}</span>
              </h2>
              <button type="button" onClick={() => { setEditing(null); setEditingDetails(null); }}>×</button>
            </div>
            <form onSubmit={save}>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">السعر<input name="price" type="number" defaultValue={editing.price || ""} className="mt-1 h-11 w-full rounded-xl border px-3"/></label>
                <label className="text-sm">الحالة<select name="status" defaultValue={editing.status} className="mt-1 h-11 w-full rounded-xl border px-3">{["AVAILABLE","RESERVED","SOLD","UNAVAILABLE","CONTACT_SALES"].map((x) => <option key={x}>{x}</option>)}</select></label>
                <label className="text-sm">نوع الوحدة<input name="unitType" defaultValue={editing.unitType || ""} className="mt-1 h-11 w-full rounded-xl border px-3"/></label>
                <label className="text-sm">غرف النوم<input name="bedrooms" type="number" defaultValue={editing.bedrooms ?? ""} className="mt-1 h-11 w-full rounded-xl border px-3"/></label>
                <label className="text-sm">المساحة المبنية<input name="builtUpArea" type="number" defaultValue={editing.builtUpArea || ""} className="mt-1 h-11 w-full rounded-xl border px-3"/></label>
              </div>
              <button disabled={busy} className="mt-5 h-11 w-full rounded-xl bg-forest font-bold text-white">حفظ التعديل وسجل التدقيق</button>
            </form>

            <div className="mt-5 border-t pt-4">
              <h3 className="font-bold">صور الوحدة ومخططها</h3>
              <p className="mt-1 text-xs text-[#68756f]">هذه الصور تخص الوحدة نفسها، وليست صور المشروع العامة. استخدم FLOOR_PLAN للمخطط الداخلي و IMAGE لصورة الوحدة.</p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {(editingDetails?.media || []).map((media) => (
                  <div key={media.id} className="overflow-hidden rounded-xl border">
                    <img src={media.url} alt={media.altTextAr || media.altText || "صورة الوحدة"} className="h-24 w-full object-cover"/>
                    <div className="p-2 text-[11px]">{media.type}</div>
                  </div>
                ))}
              </div>
              <form onSubmit={uploadUnitMedia} className="mt-3 grid gap-2 sm:grid-cols-2">
                <input required name="file" type="file" accept="image/*" className="rounded-xl border p-2 text-sm"/>
                <select name="type" defaultValue="FLOOR_PLAN" className="h-11 rounded-xl border px-3">
                  <option value="FLOOR_PLAN">مخطط / تقسيم الوحدة</option>
                  <option value="IMAGE">صورة الوحدة</option>
                  <option value="MAP">خريطة مرتبطة بالوحدة</option>
                </select>
                <input name="altTextAr" placeholder="وصف الصورة — مثال: تقسيم شقة 3 غرف" className="h-11 rounded-xl border px-3 sm:col-span-2"/>
                <button disabled={busy} className="h-10 rounded-xl border border-forest font-bold text-forest sm:col-span-2">رفع صورة للوحدة</button>
              </form>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
