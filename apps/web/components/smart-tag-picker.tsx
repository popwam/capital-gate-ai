"use client";

import { useMemo, useState } from "react";
import { Check, Plus, Search, X } from "lucide-react";

export type SmartOption = {
  id: string;
  label: string;
  secondary?: string;
  category?: string | null;
};

type Props = {
  label?: string;
  placeholder?: string;
  options: SmartOption[];
  value: string[];
  onChange: (value: string[]) => void;
  onCreate?: (value: { nameAr: string; nameEn?: string; category?: string }) => Promise<SmartOption>;
  createLabel?: string;
  emptyLabel?: string;
};

export function SmartTagPicker({
  label,
  placeholder = "اكتب للبحث…",
  options,
  value,
  onChange,
  onCreate,
  createLabel = "إضافة للنظام",
  emptyLabel = "لا توجد نتيجة مطابقة",
}: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState("");

  const selected = useMemo(
    () => value.map((id) => options.find((option) => option.id === id)).filter(Boolean) as SmartOption[],
    [options, value],
  );
  const normalized = query.trim().toLocaleLowerCase();
  const filtered = options
    .filter((option) => !value.includes(option.id))
    .filter((option) => !normalized || `${option.label} ${option.secondary ?? ""} ${option.category ?? ""}`.toLocaleLowerCase().includes(normalized))
    .slice(0, 10);

  const exactExists = options.some((option) => option.label.trim().toLocaleLowerCase() === normalized);

  function select(id: string) {
    onChange([...new Set([...value, id])]);
    setQuery("");
    setOpen(false);
  }

  async function create(form: FormData) {
    if (!onCreate) return;
    const nameAr = String(form.get("nameAr") ?? "").trim();
    if (!nameAr) return;
    try {
      setBusy(true);
      setCreateError("");
      const created = await onCreate({
        nameAr,
        nameEn: String(form.get("nameEn") ?? "").trim() || undefined,
        category: String(form.get("category") ?? "").trim() || undefined,
      });
      onChange([...new Set([...value, created.id])]);
      setCreating(false);
      setQuery("");
      setOpen(false);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "تعذر إضافة العنصر.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {label ? <label className="text-sm font-extrabold text-[#25332f]">{label}</label> : null}
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {selected.map((option) => (
            <span key={option.id} className="inline-flex items-center gap-2 rounded-full border border-[#dce3df] bg-[#f3f6f4] px-3 py-2 text-sm font-bold text-[#29463e]">
              {option.label}
              <button type="button" onClick={() => onChange(value.filter((id) => id !== option.id))} className="grid h-5 w-5 place-items-center rounded-full bg-white text-[#6d7873] hover:text-red-700" aria-label={`حذف ${option.label}`}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="relative">
        <div className="flex h-12 items-center gap-2 rounded-2xl border border-[#dce3df] bg-white px-3 focus-within:border-[#2c5a50] focus-within:ring-2 focus-within:ring-[#2c5a50]/10">
          <Search size={16} className="text-[#7b8782]" />
          <input
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            placeholder={placeholder}
            className="h-full min-w-0 flex-1 border-0 bg-transparent text-sm outline-none"
          />
        </div>

        {open ? (
          <div className="absolute z-30 mt-2 max-h-72 w-full overflow-auto rounded-2xl border border-[#dce3df] bg-white p-2 shadow-xl shadow-black/10">
            {filtered.map((option) => (
              <button key={option.id} type="button" onClick={() => select(option.id)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-right hover:bg-[#f4f5f0]">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-[#edf2ef] text-[#19473d]"><Check size={14} /></span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-sm">{option.label}</b>
                  {(option.secondary || option.category) ? <span className="mt-0.5 block truncate text-xs text-[#7b8782]">{option.secondary || option.category}</span> : null}
                </span>
              </button>
            ))}

            {!filtered.length ? <p className="px-3 py-4 text-sm text-[#7b8782]">{emptyLabel}</p> : null}
            {onCreate && query.trim() && !exactExists ? (
              <button type="button" onClick={() => { setCreating(true); setOpen(false); }} className="mt-1 flex w-full items-center gap-3 rounded-xl border border-dashed border-[#b8c7c1] px-3 py-3 text-right font-bold text-[#17483e] hover:bg-[#f5f8f6]">
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-[#173f3b] text-white"><Plus size={14} /></span>
                <span>{createLabel}: “{query.trim()}”</span>
              </button>
            ) : null}
            <button type="button" onClick={() => setOpen(false)} className="mt-1 w-full rounded-xl px-3 py-2 text-xs text-[#7b8782]">إغلاق</button>
          </div>
        ) : null}
      </div>

      {creating ? (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-[#0c1714]/40 p-4" onMouseDown={() => !busy && setCreating(false)}>
          <form
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void create(new FormData(event.currentTarget));
            }}
            className="w-full max-w-md rounded-[28px] border border-white/70 bg-white p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[.2em] text-[#b08c52]">System library</p>
                <h3 className="mt-1 text-xl font-black">إضافة عنصر جديد</h3>
                <p className="mt-1 text-sm leading-6 text-[#74817b]">هيتسجل مرة واحدة ويظهر بعد كده كاقتراح في باقي المشاريع.</p>
              </div>
              <button type="button" onClick={() => setCreating(false)} className="grid h-9 w-9 place-items-center rounded-full border"><X size={15} /></button>
            </div>
            <div className="mt-5 grid gap-3">
              <label className="text-sm font-bold">الاسم العربي<input autoFocus name="nameAr" defaultValue={query.trim()} required className="mt-1 h-12 w-full rounded-2xl border px-3 font-normal" /></label>
              <label className="text-sm font-bold">الاسم الإنجليزي<input name="nameEn" className="mt-1 h-12 w-full rounded-2xl border px-3 font-normal" /></label>
              <label className="text-sm font-bold">التصنيف<input name="category" placeholder="مثال: Wellness" className="mt-1 h-12 w-full rounded-2xl border px-3 font-normal" /></label>
            </div>
            {createError ? <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{createError}</p> : null}
            <div className="mt-5 flex gap-2">
              <button disabled={busy} className="h-12 flex-1 rounded-2xl bg-[#173f3b] font-black text-white disabled:opacity-50">{busy ? "جارٍ الإضافة…" : "إضافة للنظام"}</button>
              <button type="button" disabled={busy} onClick={() => setCreating(false)} className="h-12 rounded-2xl border px-5 font-bold">إلغاء</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export function MultiSelectPicker({
  label,
  options,
  value,
  onChange,
  placeholder = "اختر…",
}: {
  label?: string;
  options: Array<{ value: string; label: string }>;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative space-y-2">
      {label ? <label className="text-sm font-extrabold text-[#25332f]">{label}</label> : null}
      <button type="button" onClick={() => setOpen((current) => !current)} className="flex min-h-12 w-full items-center justify-between gap-2 rounded-2xl border border-[#dce3df] bg-white px-3 text-right text-sm">
        <span className="flex flex-wrap gap-1.5">
          {value.length ? value.map((entry) => <span key={entry} className="rounded-full bg-[#edf2ef] px-2.5 py-1 font-bold text-[#29463e]">{options.find((option) => option.value === entry)?.label ?? entry}</span>) : <span className="text-[#99a19d]">{placeholder}</span>}
        </span>
        <span className="text-xs text-[#7b8782]">{value.length}</span>
      </button>
      {open ? (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-2xl border bg-white p-2 shadow-xl">
          {options.map((option) => {
            const active = value.includes(option.value);
            return <button key={option.value} type="button" onClick={() => onChange(active ? value.filter((item) => item !== option.value) : [...value, option.value])} className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm ${active ? "bg-[#edf3f0] font-bold text-[#173f3b]" : "hover:bg-[#f6f6f2]"}`}><span>{option.label}</span>{active ? <Check size={14} /> : null}</button>;
          })}
          <button type="button" onClick={() => setOpen(false)} className="mt-2 h-9 w-full rounded-xl border text-xs font-bold">تم</button>
        </div>
      ) : null}
    </div>
  );
}
