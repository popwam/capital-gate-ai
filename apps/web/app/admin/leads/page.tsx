"use client";
import { FormEvent, useEffect, useState } from "react";
import { ArrowRight, Filter, Search, Users } from "lucide-react";
import { adminApi } from "@/lib/api";

type Lead = {
  id: string;
  name: string;
  phone: string;
  status: string;
  intent: string;
  intentScore: number;
  budget?: { min?: number; max?: number; currency?: string } | null;
  preferredAreas: string[];
  interestedProject?: { id: string; name: string } | null;
  interestedUnit?: { id: string; externalUnitId: string } | null;
  createdAt: string;
  lastActivityAt: string;
  assignedTo?: { id: string; name: string } | null;
  followUpAt?: string | null;
};
type Page = {
  items: Lead[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};
type Option = { id: string; name: string };
const statuses = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "FOLLOW_UP",
  "VIEWING_REQUESTED",
  "NEGOTIATING",
  "WON",
  "LOST",
];
const fmt = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";
const money = (budget?: Lead["budget"]) =>
  budget
    ? (budget.min && budget.max
        ? `${Number(budget.min).toLocaleString()}–${Number(budget.max).toLocaleString()}`
        : Number(budget.max || budget.min).toLocaleString()) +
      ` ${budget.currency || ""}`
    : "—";

export default function LeadsPage() {
  const [data, setData] = useState<Page>({
    items: [],
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  });
  const [admins, setAdmins] = useState<Option[]>([]);
  const [projects, setProjects] = useState<Option[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    search: "",
    status: "",
    intentLevel: "",
    projectId: "",
    assignedTo: "",
    followUp: "",
    createdFrom: "",
    createdTo: "",
    sort: "newest",
  });
  async function load(page = 1) {
    setLoading(true);
    setError("");
    try {
      const q = new URLSearchParams({ page: String(page), limit: "20" });
      Object.entries(filters).forEach(([k, v]) => v && q.set(k, v));
      setData(await adminApi.get<Page>(`/leads?${q}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load leads");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void Promise.all([
      adminApi.get<Option[]>("/leads/options/admins").then(setAdmins),
      adminApi.get<Option[]>("/leads/options/projects").then(setProjects),
    ]);
    void load();
  }, []);
  function submit(e: FormEvent) {
    e.preventDefault();
    void load(1);
  }
  return (
    <main className="mx-auto max-w-[1480px] p-4 sm:p-6 lg:p-8" dir="rtl">
      <section className="rounded-[24px] border border-[#dfe4e0] bg-white p-5 sm:p-6">
        <div className="flex items-end justify-between gap-4"><div><div className="flex items-center gap-2 text-[12px] font-bold text-[#4f7568]"><Users size={16}/> إدارة فرص البيع</div><h2 className="mt-2 text-[24px] font-bold">العملاء المحتملون</h2><p className="mt-1 text-[13px] text-[#74817b]">{data.total} فرصة ناتجة من محادثات العملاء، مع المتابعة والتعيين وسياق الاهتمام.</p></div></div>
      </section>
        <form onSubmit={submit} className="mt-5 rounded-[22px] border border-[#dfe4e0] bg-white p-4">
          <div className="flex items-center gap-2 text-[9px] font-bold">
            <Filter size={13} /> البحث والفلاتر
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            <label className="relative sm:col-span-2">
              <Search
                size={13}
                className="absolute left-3 top-3 text-[#8a958f]"
              />
              <input
                value={filters.search}
                onChange={(e) =>
                  setFilters({ ...filters, search: e.target.value })
                }
                placeholder="الاسم، الهاتف، المشروع أو الوحدة"
                className="h-10 w-full rounded-xl border pl-9 pr-3 text-[9px]"
              />
            </label>
            <Select
              value={filters.status}
              change={(v) => setFilters({ ...filters, status: v })}
              options={statuses}
              label="All statuses"
            />
            <Select
              value={filters.intentLevel}
              change={(v) => setFilters({ ...filters, intentLevel: v })}
              options={["high", "medium", "low"]}
              label="All intent levels"
            />
            <Select
              value={filters.projectId}
              change={(v) => setFilters({ ...filters, projectId: v })}
              entries={projects}
              label="All projects"
            />
            <Select
              value={filters.assignedTo}
              change={(v) => setFilters({ ...filters, assignedTo: v })}
              entries={[{ id: "unassigned", name: "Unassigned" }, ...admins]}
              label="Any assignment"
            />
            <Select
              value={filters.followUp}
              change={(v) => setFilters({ ...filters, followUp: v })}
              options={["due", "upcoming", "none"]}
              label="Any follow-up"
            />
            <label className="text-[7px] font-bold text-[#7d8883]">
              Created from
              <input
                type="date"
                value={filters.createdFrom}
                onChange={(e) =>
                  setFilters({ ...filters, createdFrom: e.target.value })
                }
                className="mt-1 h-10 w-full rounded-xl border px-3 text-[8px] font-normal"
              />
            </label>
            <label className="text-[7px] font-bold text-[#7d8883]">
              Created to
              <input
                type="date"
                value={filters.createdTo}
                onChange={(e) =>
                  setFilters({ ...filters, createdTo: e.target.value })
                }
                className="mt-1 h-10 w-full rounded-xl border px-3 text-[8px] font-normal"
              />
            </label>
            <Select
              value={filters.sort}
              change={(v) => setFilters({ ...filters, sort: v })}
              options={[
                "newest",
                "oldest",
                "highest_intent",
                "lowest_intent",
                "last_activity",
                "follow_up",
              ]}
              label="Sort"
            />
            <button className="h-10 rounded-xl bg-forest px-4 text-[9px] font-bold text-white">
              Apply
            </button>
          </div>
        </form>
        {error && (
          <div className="mt-4 rounded-xl bg-[#fbe9e5] p-3 text-[9px] text-[#934333]">
            {error}
          </div>
        )}
        <div className="mt-4 overflow-hidden rounded-[20px] border bg-white">
          <div className="hidden grid-cols-[1.2fr_1fr_.8fr_.8fr_.9fr_1fr_1fr_.9fr_1fr_26px] gap-3 border-b bg-[#fbfaf7] px-4 py-3 text-[7px] font-bold uppercase tracking-wide text-[#7c8782] xl:grid">
            {[
              "Customer",
              "Status",
              "Intent",
              "Budget",
              "Area",
              "Project / Unit",
              "Created",
              "Last activity",
              "Assigned",
              "",
            ].map((x) => (
              <span key={x}>{x}</span>
            ))}
          </div>
          {loading ? (
            <div className="p-12 text-center text-[10px] text-[#7c8782]">
              Loading leads…
            </div>
          ) : (
            data.items.map((lead) => (
              <a
                href={`/admin/leads/${lead.id}`}
                key={lead.id}
                className="grid gap-3 border-b px-4 py-4 transition last:border-0 hover:bg-[#fbfaf7] sm:grid-cols-2 xl:grid-cols-[1.2fr_1fr_.8fr_.8fr_.9fr_1fr_1fr_.9fr_1fr_26px] xl:items-center"
              >
                <Cell label="Customer">
                  <b className="block text-[10px]">{lead.name}</b>
                  <span className="text-[8px] text-[#74817b]">
                    {lead.phone}
                  </span>
                </Cell>
                <Cell label="Status">
                  <Status value={lead.status} />
                </Cell>
                <Cell label="Intent">
                  <b className="text-[10px]">{lead.intentScore} / 100</b>
                  <span className="block text-[7px] text-[#78837e]">
                    {lead.intent}
                  </span>
                </Cell>
                <Cell label="Budget">{money(lead.budget)}</Cell>
                <Cell label="Preferred area">
                  {lead.preferredAreas?.[0] || "—"}
                </Cell>
                <Cell label="Project / Unit">
                  <b className="block">{lead.interestedProject?.name || "—"}</b>
                  <span className="text-[#7b8781]">
                    {lead.interestedUnit?.externalUnitId || ""}
                  </span>
                </Cell>
                <Cell label="Created">{fmt(lead.createdAt)}</Cell>
                <Cell label="Last activity">{fmt(lead.lastActivityAt)}</Cell>
                <Cell label="Assigned">
                  {lead.assignedTo?.name || "Unassigned"}
                </Cell>
                <ArrowRight size={13} className="hidden xl:block" />
              </a>
            ))
          )}
          {!loading && !data.items.length && (
            <div className="p-12 text-center text-[10px] text-[#78837e]">
              No leads match these filters.
            </div>
          )}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <p className="text-[8px] text-[#7c8782]">
            Page {data.page} of {data.totalPages}
          </p>
          <div className="flex gap-2">
            <button
              disabled={data.page <= 1}
              onClick={() => load(data.page - 1)}
              className="rounded-xl border bg-white px-4 py-2 text-[8px] font-bold disabled:opacity-40"
            >
              Previous
            </button>
            <button
              disabled={data.page >= data.totalPages}
              onClick={() => load(data.page + 1)}
              className="rounded-xl border bg-white px-4 py-2 text-[8px] font-bold disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
function Select({
  value,
  change,
  options,
  entries,
  label,
}: {
  value: string;
  change: (v: string) => void;
  options?: string[];
  entries?: Option[];
  label: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => change(e.target.value)}
      className="h-10 min-w-0 rounded-xl border px-3 text-[8px]"
    >
      <option value="">{label}</option>
      {options?.map((x) => (
        <option key={x} value={x}>
          {x.replaceAll("_", " ")}
        </option>
      ))}
      {entries?.map((x) => (
        <option key={x.id} value={x.id}>
          {x.name}
        </option>
      ))}
    </select>
  );
}
function Cell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 text-[8px]" dir="auto">
      <span className="mb-1 block text-[7px] font-bold uppercase text-[#929b97] xl:hidden">
        {label}
      </span>
      {children}
    </div>
  );
}
function Status({ value }: { value: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-[7px] font-bold ${value === "NEW" ? "bg-[#fbe6dc] text-[#9a4a35]" : value === "WON" ? "bg-[#dff0e6] text-[#2d7357]" : value === "LOST" ? "bg-[#ececea] text-[#707873]" : "bg-[#e7edf5] text-[#45627d]"}`}
    >
      {value.replaceAll("_", " ")}
    </span>
  );
}
