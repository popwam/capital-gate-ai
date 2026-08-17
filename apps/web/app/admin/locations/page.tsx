"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { LocateFixed, MapPin, Plus, Route, Tags } from "lucide-react";
import { MapPointPicker } from "@/components/map-point-picker";
import { adminApi, adminErrorMessage } from "@/lib/api";

type Location = {
  id: string;
  name: string;
  nameAr?: string | null;
  nameEn?: string | null;
  slug: string;
  type: string;
  parentId?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  googlePlaceId?: string | null;
  formattedAddress?: string | null;
  aliases: { id: string; value: string }[];
  parent?: { name: string } | null;
};

type LocationForm = {
  name: string;
  nameAr: string;
  nameEn: string;
  type: string;
  parentId: string;
  latitude: string;
  longitude: string;
  googlePlaceId: string;
  formattedAddress: string;
};

type DistanceForm = {
  toLocationId: string;
  distanceKm: string;
  estimatedMinutes: string;
  notes: string;
  distanceType: "GOOGLE_ROUTES" | "ADMIN_VERIFIED";
};

const labels: Record<string, string> = { COUNTRY: "دولة", GOVERNORATE: "محافظة", CITY: "مدينة", AREA: "منطقة", SUBAREA: "منطقة فرعية" };
const rank: Record<string, number> = { COUNTRY: 0, GOVERNORATE: 1, CITY: 2, AREA: 3, SUBAREA: 4 };
const emptyForm: LocationForm = { name: "", nameAr: "", nameEn: "", type: "COUNTRY", parentId: "", latitude: "", longitude: "", googlePlaceId: "", formattedAddress: "" };
const emptyDistance: DistanceForm = { toLocationId: "", distanceKm: "", estimatedMinutes: "", notes: "", distanceType: "GOOGLE_ROUTES" };
const slug = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");

function pointFrom(form: LocationForm) {
  const lat = Number(form.latitude);
  const lng = Number(form.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && form.latitude && form.longitude ? { lat, lng } : null;
}

function routeAddress(location?: Location | null) {
  if (!location) return "";
  if (location.latitude && location.longitude) return `${location.latitude},${location.longitude}`;
  return location.formattedAddress || location.name;
}

export default function LocationsPage() {
  const [items, setItems] = useState<Location[]>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [alias, setAlias] = useState("");
  const [address, setAddress] = useState("");
  const [form, setForm] = useState<LocationForm>(emptyForm);
  const [distance, setDistance] = useState<DistanceForm>(emptyDistance);
  const [manualDistance, setManualDistance] = useState(false);
  const [mapsBusy, setMapsBusy] = useState(false);

  const load = () => adminApi.get<Location[]>("/locations").then(setItems).catch((reason) => setError(adminErrorMessage(reason)));
  useEffect(() => { void load(); }, []);

  const active = items.find((item) => item.id === selected);
  const destination = items.find((item) => item.id === distance.toLocationId);
  const ordered = useMemo(() => [...items].sort((a, b) => (rank[a.type] - rank[b.type]) || a.name.localeCompare(b.name)), [items]);
  const point = pointFrom(form);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      await adminApi.post("/locations", {
        ...form,
        canonicalName: form.name,
        slug: slug(form.name),
        parentId: form.parentId || undefined,
        latitude: point?.lat,
        longitude: point?.lng,
        source: form.googlePlaceId ? "GOOGLE" : "ADMIN_MAP",
      });
      setForm({ ...emptyForm, type: form.type, parentId: form.parentId });
      setAddress("");
      await load();
    } catch (reason) { setError(adminErrorMessage(reason)); }
  }

  async function geocode() {
    if (!address.trim()) return;
    setMapsBusy(true); setError("");
    try {
      const result: any = await adminApi.get(`/maps/geocode?address=${encodeURIComponent(address.trim())}`);
      const hit = result.results?.[0];
      if (!hit) throw new Error("لم يعثر Google Maps على نتيجة");
      setForm((current) => ({
        ...current,
        name: current.name || address.trim(),
        formattedAddress: hit.formatted_address || address.trim(),
        latitude: String(hit.geometry.location.lat),
        longitude: String(hit.geometry.location.lng),
        googlePlaceId: hit.place_id || "",
      }));
    } catch (reason) { setError(adminErrorMessage(reason)); }
    finally { setMapsBusy(false); }
  }

  async function calculateDistance() {
    if (!active || !destination) return;
    setMapsBusy(true); setError("");
    try {
      const origin = routeAddress(active);
      const target = routeAddress(destination);
      const result: any = await adminApi.get(`/maps/route?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(target)}`);
      const route = result.routes?.[0];
      if (!route?.distanceMeters) throw new Error("Google Routes لم يرجع مسارًا صالحًا");
      const seconds = typeof route.duration === "string" ? Number.parseFloat(route.duration) : NaN;
      setDistance((current) => ({
        ...current,
        distanceKm: (Number(route.distanceMeters) / 1000).toFixed(2),
        estimatedMinutes: Number.isFinite(seconds) ? String(Math.max(1, Math.round(seconds / 60))) : "",
        distanceType: "GOOGLE_ROUTES",
        notes: current.notes || "Google Routes · accepted by admin",
      }));
      setManualDistance(false);
    } catch (reason) { setError(adminErrorMessage(reason)); }
    finally { setMapsBusy(false); }
  }

  async function addAlias() {
    if (!selected || !alias.trim()) return;
    try { await adminApi.post(`/locations/${selected}/aliases`, { value: alias.trim() }); setAlias(""); await load(); }
    catch (reason) { setError(adminErrorMessage(reason)); }
  }

  async function addDistance() {
    if (!selected || !distance.toLocationId || !distance.distanceKm) return;
    try {
      await adminApi.post("/locations/distances", {
        fromLocationId: selected,
        toLocationId: distance.toLocationId,
        distanceKm: Number(distance.distanceKm),
        estimatedMinutes: distance.estimatedMinutes ? Number(distance.estimatedMinutes) : undefined,
        notes: distance.notes,
        isBidirectional: true,
        distanceType: manualDistance ? "ADMIN_VERIFIED" : distance.distanceType,
      });
      setDistance(emptyDistance); setManualDistance(false);
    } catch (reason) { setError(adminErrorMessage(reason)); }
  }

  async function remove() {
    if (!active || prompt(`اكتب DELETE لحذف ${active.name}`) !== "DELETE") return;
    try { await adminApi.delete(`/locations/${active.id}`); setSelected(""); await load(); }
    catch (reason) { setError(adminErrorMessage(reason)); }
  }

  return <main className="mx-auto min-h-screen max-w-7xl p-4 sm:p-8" dir="rtl">
    <div><h1 className="text-2xl font-bold">المناطق والمسافات</h1><p className="mt-2 text-sm text-[#68756f]">ابحث، اختر النقطة على الخريطة، وخلي Google يحسب المسافة بدل كتابة الإحداثيات يدويًا.</p></div>
    {error && <div className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</div>}

    <div className="mt-6 grid gap-5 xl:grid-cols-[1fr_430px]">
      <section className="rounded-2xl border bg-white p-4 sm:p-5">
        <div className="flex items-center justify-between"><h2 className="font-bold">التسلسل الجغرافي</h2>{active && <button onClick={remove} className="rounded-lg border px-3 py-1.5 text-xs text-red-700">حذف آمن</button>}</div>
        <div className="mt-4 divide-y">{ordered.map((item) => <button key={item.id} onClick={() => setSelected(item.id)} className={`flex w-full items-center gap-3 py-3 text-right ${selected === item.id ? "text-[#8c6b35]" : ""}`} style={{ paddingInlineStart: `${rank[item.type] * 16}px` }}><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#eef2ef]"><MapPin size={15}/></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold" dir="auto">{item.nameAr || item.name}</span><span className="text-xs text-[#7a857f]">{labels[item.type]}{item.parent ? ` · ${item.parent.name}` : ""}</span></span><span className="text-xs text-[#7a857f]">{item.aliases.length} اسم بديل</span></button>)}</div>
      </section>

      <aside className="space-y-4">
        <form onSubmit={create} className="rounded-2xl border bg-white p-4 sm:p-5">
          <h2 className="flex items-center gap-2 font-bold"><Plus size={16}/>إضافة موقع</h2>
          <div className="mt-4 space-y-3">
            <div className="flex gap-2"><input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="ابحث بعنوان عبر Google" className="h-11 min-w-0 flex-1 rounded-xl border px-3"/><button disabled={mapsBusy || !address.trim()} type="button" onClick={geocode} className="rounded-xl border px-3 text-sm font-bold disabled:opacity-40">بحث</button></div>
            <MapPointPicker value={point} onChange={(next) => setForm((current) => ({ ...current, latitude: String(next.lat), longitude: String(next.lng), googlePlaceId: "" }))}/>
            {point && <div className="flex items-center gap-2 rounded-xl bg-[#f4f5f1] px-3 py-2 text-xs text-[#68756f]"><LocateFixed size={14}/><span>تم اختيار النقطة على الخريطة</span></div>}
            <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="الاسم المعتمد" className="h-11 w-full rounded-xl border px-3"/>
            <div className="grid grid-cols-2 gap-2"><input value={form.nameAr} onChange={(event) => setForm({ ...form, nameAr: event.target.value })} placeholder="الاسم بالعربية" className="h-11 rounded-xl border px-3"/><input value={form.nameEn} onChange={(event) => setForm({ ...form, nameEn: event.target.value })} placeholder="الاسم بالإنجليزية" className="h-11 rounded-xl border px-3"/></div>
            <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value, parentId: event.target.value === "COUNTRY" ? "" : form.parentId })} className="h-11 w-full rounded-xl border px-3">{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            {form.type !== "COUNTRY" && <select required value={form.parentId} onChange={(event) => setForm({ ...form, parentId: event.target.value })} className="h-11 w-full rounded-xl border px-3"><option value="">اختر الموقع الأعلى</option>{items.filter((item) => rank[item.type] < rank[form.type]).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
            <button className="h-11 w-full rounded-xl bg-forest font-bold text-white">حفظ الموقع</button>
          </div>
        </form>

        <div className="rounded-2xl border bg-white p-4 sm:p-5">
          <h2 className="flex items-center gap-2 font-bold"><Tags size={16}/>الأسماء البديلة المعتمدة</h2>
          {active && <div className="mt-3 flex flex-wrap gap-2">{active.aliases.map((item) => <span key={item.id} className="rounded-full bg-[#eef2ef] px-3 py-1 text-xs" dir="auto">{item.value}</span>)}</div>}
          <input disabled={!selected} value={alias} onChange={(event) => setAlias(event.target.value)} placeholder="مثال: التجمع، New Cairo، tagamo3" className="mt-3 h-11 w-full rounded-xl border px-3"/>
          <button disabled={!selected || !alias.trim()} onClick={addAlias} className="mt-2 h-10 w-full rounded-xl border font-bold disabled:opacity-40">حفظ الاسم البديل</button>
        </div>

        <div className="rounded-2xl border bg-white p-4 sm:p-5">
          <h2 className="flex items-center gap-2 font-bold"><Route size={16}/>مسافة موثقة</h2>
          <select disabled={!selected} value={distance.toLocationId} onChange={(event) => setDistance({ ...distance, toLocationId: event.target.value, distanceKm: "", estimatedMinutes: "" })} className="mt-3 h-11 w-full rounded-xl border px-3"><option value="">اختر الوجهة</option>{items.filter((item) => item.id !== selected).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <button disabled={!active || !destination || mapsBusy} onClick={calculateDistance} className="mt-2 h-11 w-full rounded-xl bg-[#edf2ef] font-bold text-[#315f50] disabled:opacity-40">احسب تلقائيًا من Google Routes</button>
          <div className="mt-2 grid grid-cols-2 gap-2"><input readOnly={!manualDistance} value={distance.distanceKm} onChange={(event) => setDistance({ ...distance, distanceKm: event.target.value })} placeholder="كم" className="h-11 rounded-xl border bg-[#fafaf7] px-3 read-only:text-[#596761]"/><input readOnly={!manualDistance} value={distance.estimatedMinutes} onChange={(event) => setDistance({ ...distance, estimatedMinutes: event.target.value })} placeholder="دقيقة" className="h-11 rounded-xl border bg-[#fafaf7] px-3 read-only:text-[#596761]"/></div>
          <button type="button" onClick={() => { setManualDistance((value) => !value); if (!manualDistance) setDistance((current) => ({ ...current, distanceType: "ADMIN_VERIFIED" })); }} className="mt-2 text-xs font-bold text-[#765b31]">{manualDistance ? "إلغاء الإدخال اليدوي" : "أحتاج إدخالًا يدويًا"}</button>
          <input value={distance.notes} onChange={(event) => setDistance({ ...distance, notes: event.target.value })} placeholder="ملاحظات المصدر (اختياري)" className="mt-2 h-11 w-full rounded-xl border px-3"/>
          <button disabled={!selected || !distance.toLocationId || !distance.distanceKm} onClick={addDistance} className="mt-2 h-10 w-full rounded-xl border font-bold disabled:opacity-40">حفظ في الاتجاهين</button>
        </div>
      </aside>
    </div>
  </main>;
}
