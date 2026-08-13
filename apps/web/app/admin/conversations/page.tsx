"use client";
import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, MessageSquareText, Search } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { adminApi } from "@/lib/api";
type Item = {
  id: string;
  title?: string;
  detectedLanguage?: string;
  updatedAt: string;
  _count: { messages: number; leads: number };
  leads: { id: string; name: string; status: string; intentScore: number }[];
};
type Data = {
  items: Item[];
  page: number;
  total: number;
  totalPages: number;
  limit: number;
};
export default function Conversations() {
  const [data, setData] = useState<Data>({
    items: [],
    page: 1,
    total: 0,
    totalPages: 1,
    limit: 20,
  });
  const [search, setSearch] = useState("");
  const load = (page = 1) =>
    adminApi
      .get<Data>(
        `/conversations?page=${page}&limit=20&search=${encodeURIComponent(search)}`,
      )
      .then(setData);
  useEffect(() => {
    void load();
  }, []);
  function submit(e: FormEvent) {
    e.preventDefault();
    void load(1);
  }
  return (
    <main className="min-h-screen bg-[#f6f5f1]">
      <header className="flex h-16 items-center justify-between border-b bg-white px-5">
        <LogoMark />
        <a
          href="/admin"
          className="flex items-center gap-2 text-[9px] font-bold"
        >
          <ArrowLeft size={13} /> Admin overview
        </a>
      </header>
      <div className="mx-auto max-w-5xl p-5 sm:p-8">
        <p className="text-[9px] font-bold uppercase tracking-[.15em] text-coral">
          Read-only context
        </p>
        <h1 className="mt-2 text-[27px] font-bold tracking-[-.04em]">
          Conversations
        </h1>
        <form onSubmit={submit} className="relative mt-5">
          <Search size={14} className="absolute left-3 top-3 text-[#89938e]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, lead name or phone"
            className="h-10 w-full rounded-xl border bg-white pl-9 pr-3 text-[9px]"
          />
        </form>
        <div className="mt-4 overflow-hidden rounded-[20px] border bg-white">
          {data.items.map((x) => (
            <a
              href={`/admin/conversations/${x.id}`}
              key={x.id}
              className="flex items-center gap-4 border-b p-4 last:border-0 hover:bg-[#fbfaf7]"
            >
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e4efe9] text-forest">
                <MessageSquareText size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[10px] font-bold" dir="auto">
                  {x.title || "Untitled conversation"}
                </p>
                <p className="mt-1 text-[8px] text-[#7c8782]">
                  {x._count.messages} messages ·{" "}
                  {x.detectedLanguage || "Language unknown"} ·{" "}
                  {new Date(x.updatedAt).toLocaleString()}
                </p>
              </div>
              {x.leads[0] && (
                <div className="hidden text-right sm:block">
                  <p className="text-[8px] font-bold" dir="auto">{x.leads[0].name}</p>
                  <p className="text-[7px] text-[#7c8782]">
                    {x.leads[0].status} · {x.leads[0].intentScore}/100
                  </p>
                </div>
              )}
            </a>
          ))}
        </div>
        <div className="mt-4 flex justify-between text-[8px]">
          <button
            disabled={data.page <= 1}
            onClick={() => load(data.page - 1)}
            className="rounded-xl border bg-white px-4 py-2 disabled:opacity-40"
          >
            Previous
          </button>
          <span>
            Page {data.page} of {data.totalPages}
          </span>
          <button
            disabled={data.page >= data.totalPages}
            onClick={() => load(data.page + 1)}
            className="rounded-xl border bg-white px-4 py-2 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </main>
  );
}
