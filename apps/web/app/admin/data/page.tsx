"use client";
import { useEffect, useRef, useState } from "react";
import {
  Download,
  Eye,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { AdminSectionNav } from "@/components/admin-section-nav";
import { adminApi, adminErrorMessage } from "@/lib/api";

type Batch = {
  id: string;
  name?: string | null;
  fileName: string;
  fileUrl?: string | null;
  uploadedAt: string;
  status: string;
  rowsDetected: number;
  rowsCreated: number;
  rowsUpdated: number;
  rowsRejected: number;
  rowsSkipped: number;
  rowsFailed: number;
  developer?: { name: string } | null;
  project?: { name: string } | null;
  uploadedBy?: { name: string } | null;
  _count: { issues: number; unitChanges: number };
};
type Page = { items: Batch[]; page: number; pageSize: number; total: number };

export default function DataPage() {
  const [page, setPage] = useState<Page>({
    items: [],
    page: 1,
    pageSize: 50,
    total: 0,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [target, setTarget] = useState<Batch | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const load = () =>
    adminApi
      .get<Page>("/imports?page=1&pageSize=100")
      .then(setPage)
      .catch((e) => setError(adminErrorMessage(e)));
  useEffect(() => {
    void load();
  }, []);
  async function update(file?: File) {
    if (!file || !target) return;
    setBusy(target.id);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("parentImportId", target.id);
      form.append("batchName", `${target.name || target.fileName} — update`);
      const created = await adminApi.upload<{ id: string }>(
        "/imports/upload",
        form,
      );
      location.href = `/admin?import=${created.id}`;
    } catch (e) {
      setError(adminErrorMessage(e));
    } finally {
      setBusy("");
      setTarget(null);
    }
  }
  async function remove(
    batch: Batch,
    mode: "DELETE_SOURCE_RECORD" | "DELETE_EXCLUSIVE_RECORDS" | "ROLLBACK_SAFE",
  ) {
    const warning =
      mode === "ROLLBACK_SAFE"
        ? "سيتم التراجع فقط عن السجلات التي لم تُعدّل لاحقًا. اكتب ROLLBACK للتأكيد."
        : "سيتم حذف السجلات المنشأة حصريًا بهذه الدفعة فقط. اكتب DELETE للتأكيد.";
    const expected = mode === "ROLLBACK_SAFE" ? "ROLLBACK" : "DELETE";
    if (prompt(warning) !== expected) return;
    setBusy(batch.id);
    try {
      const result = await adminApi.delete<{
        affected: number;
        conflicts: number;
      }>(`/imports/${batch.id}`, { mode });
      alert(
        `تمت معالجة ${result.affected} سجل. تعارضات آمنة: ${result.conflicts}.`,
      );
      load();
    } catch (e) {
      setError(adminErrorMessage(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <main className="min-h-screen bg-[#f6f5f1]" dir="rtl">
      <header className="border-b bg-white px-5 py-5">
        <div className="mx-auto max-w-7xl">
          <h1 className="text-2xl font-bold">إدارة البيانات والاستيراد</h1>
          <p className="mt-2 text-sm text-[#68756f]">
            تاريخ كامل لكل دفعة، ومراجعة التحديثات، والتراجع الآمن مع الحفاظ على
            المصدر.
          </p>
        </div>
      </header>
      <AdminSectionNav active="البيانات والاستيراد" />
      <section className="mx-auto max-w-7xl p-4 sm:p-7">
        {error && (
          <div className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">
            {error}
          </div>
        )}
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-bold">{page.total} دفعة</p>
          <a
            href="/admin"
            className="flex h-10 items-center gap-2 rounded-xl bg-forest px-4 text-sm font-bold text-white"
          >
            <Upload size={16} />
            استيراد ملف جديد
          </a>
        </div>
        <input
          ref={input}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => update(e.target.files?.[0])}
        />
        <div className="overflow-x-auto rounded-2xl border bg-white">
          <table className="w-full min-w-[1050px] text-right text-sm">
            <thead className="bg-[#f0f2ef] text-xs text-[#66736d]">
              <tr>
                {[
                  "الدفعة",
                  "المطور / المشروع",
                  "رفعها",
                  "التاريخ",
                  "الصفوف",
                  "أُنشئت",
                  "حُدثت",
                "متخطاة",
                "فاشلة",
                  "الحالة",
                  "الإجراءات",
                ].map((x) => (
                  <th key={x} className="px-4 py-3">
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {page.items.map((batch) => (
                <tr key={batch.id}>
                  <td className="px-4 py-4">
                    <p className="font-bold" dir="auto">
                      {batch.name || batch.fileName}
                    </p>
                    <p className="mt-1 text-xs text-[#84908a]" dir="auto">
                      {batch.fileName}
                    </p>
                  </td>
                  <td className="px-4 py-4">
                    <span dir="auto">{batch.developer?.name || "—"}</span>
                    <br />
                    <span className="text-xs text-[#84908a]" dir="auto">
                      {batch.project?.name || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-4">{batch.uploadedBy?.name || "—"}</td>
                  <td className="px-4 py-4" dir="ltr">
                    {new Date(batch.uploadedAt).toLocaleString("ar-EG")}
                  </td>
                  <td className="px-4 py-4">{batch.rowsDetected}</td>
                  <td className="px-4 py-4 text-green-700">
                    {batch.rowsCreated}
                  </td>
                  <td className="px-4 py-4 text-amber-700">
                    {batch.rowsUpdated}
                  </td>
                  <td className="px-4 py-4 text-amber-700">{batch.rowsSkipped}</td>
                  <td className="px-4 py-4 text-red-700">{batch.rowsFailed}</td>
                  <td className="px-4 py-4">
                    <span className="rounded-full bg-[#e8efe9] px-2 py-1 text-xs font-bold">
                      {batch.status}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex gap-1">
                      <a
                        href={`/admin?import=${batch.id}`}
                        title="عرض"
                        className="rounded-lg border p-2"
                      >
                        <Eye size={14} />
                      </a>
                      {batch.fileUrl && (
                        <a
                          href={batch.fileUrl}
                          target="_blank"
                          rel="noreferrer"
                          title="تنزيل المصدر"
                          className="rounded-lg border p-2"
                        >
                          <Download size={14} />
                        </a>
                      )}{" "}
                      {batch.status === "COMPLETED" && (
                        <>
                          <button
                            title="رفع تحديث"
                            onClick={() => {
                              setTarget(batch);
                              input.current?.click();
                            }}
                            className="rounded-lg border p-2"
                          >
                            <RefreshCw size={14} />
                          </button>
                          <button
                            title="تراجع آمن"
                            disabled={busy === batch.id}
                            onClick={() => remove(batch, "ROLLBACK_SAFE")}
                            className="rounded-lg border p-2 text-amber-700"
                          >
                            <RotateCcw size={14} />
                          </button>
                          <button
                            title="حذف السجلات الحصرية"
                            disabled={busy === batch.id}
                            onClick={() =>
                              remove(batch, "DELETE_EXCLUSIVE_RECORDS")
                            }
                            className="rounded-lg border p-2 text-red-700"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!page.items.length && (
            <p className="p-12 text-center text-sm text-[#78847e]">
              لا توجد دفعات استيراد بعد.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
