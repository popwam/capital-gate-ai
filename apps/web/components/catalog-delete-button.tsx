"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";
import { adminApi, adminErrorMessage } from "@/lib/api";

type CatalogDeleteButtonProps = {
  id: string;
  name: string;
  resource: "developers" | "projects";
  entityLabel: "المطور" | "المشروع";
  onDeleted: () => void | Promise<void>;
};

export function CatalogDeleteButton({ id, name, resource, entityLabel, onDeleted }: CatalogDeleteButtonProps) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const confirmed = confirmation.trim() === name.trim();

  function close() {
    if (busy) return;
    setOpen(false);
    setConfirmation("");
    setError("");
  }

  async function remove() {
    if (!confirmed || busy) return;
    try {
      setBusy(true);
      setError("");
      await adminApi.delete(`/catalog/${resource}/${id}`, { confirmation: name });
      setOpen(false);
      setConfirmation("");
      await onDeleted();
    } catch (reason) {
      setError(adminErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-3 text-xs font-bold text-red-700 transition hover:border-red-300 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
        aria-label={`حذف ${entityLabel} ${name}`}
      >
        <Trash2 size={15} /> حذف
      </button>

      {open ? (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-[#0b1512]/55 p-4" role="presentation" onMouseDown={close}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={`delete-${resource}-${id}`}
            className="w-full max-w-md rounded-3xl border border-red-100 bg-white p-5 shadow-2xl sm:p-6"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-red-50 text-red-700"><AlertTriangle size={20} /></span>
                <div className="min-w-0">
                  <h2 id={`delete-${resource}-${id}`} className="text-lg font-black">حذف {entityLabel}</h2>
                  <p className="mt-1 text-sm leading-6 text-[#68756f]">الحذف نهائي، ولن يتم إذا كان السجل مرتبطًا بوحدات أو ملفات استيراد أو وسائط محفوظة.</p>
                </div>
              </div>
              <button type="button" onClick={close} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl hover:bg-[#f3f5f2]" aria-label="إغلاق"><X size={18} /></button>
            </div>

            <label className="mt-5 block text-sm font-bold text-[#2b3834]">
              اكتب الاسم للتأكيد
              <span className="mt-1 block truncate rounded-lg bg-[#f4f5f2] px-3 py-2 font-mono text-xs font-normal" dir="auto">{name}</span>
              <input
                autoFocus
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                className="mt-2 h-12 w-full rounded-xl border px-3 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100"
                dir="auto"
              />
            </label>

            {error ? <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm leading-6 text-red-800" role="alert">{error}</p> : null}

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                disabled={!confirmed || busy}
                onClick={() => void remove()}
                className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-red-700 px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                {busy ? "جارٍ الحذف…" : `حذف ${entityLabel}`}
              </button>
              <button type="button" disabled={busy} onClick={close} className="h-11 rounded-xl border px-5 text-sm font-bold disabled:opacity-40">إلغاء</button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
