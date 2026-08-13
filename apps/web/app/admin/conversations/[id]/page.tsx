"use client";
import { useEffect, useState } from "react";
import { ArrowLeft, Bot, UserRound } from "lucide-react";
import { AdminSectionNav } from "@/components/admin-section-nav";
import { LogoMark } from "@/components/logo";
import { adminApi } from "@/lib/api";
export default function ConversationDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [item, setItem] = useState<any>();
  const [error, setError] = useState("");
  useEffect(() => {
    params.then(({ id }) =>
      adminApi
        .get(`/conversations/${id}`)
        .then(setItem)
        .catch((e) => setError(e.message)),
    );
  }, [params]);
  if (!item)
    return (
      <main className="grid min-h-screen place-items-center text-[10px]">
        {error || "Loading conversation…"}
      </main>
    );
  return (
    <main className="min-h-screen bg-[#f6f5f1]">
      <header className="flex h-16 items-center justify-between border-b bg-white px-5">
        <LogoMark />
        <a
          href="/admin/conversations"
          className="flex items-center gap-2 text-[9px] font-bold"
        >
          <ArrowLeft size={13} /> Conversations
        </a>
      </header>
      <AdminSectionNav active="المحادثات" />
      <div className="mx-auto max-w-4xl p-5 sm:p-8">
        <p className="text-[9px] font-bold uppercase tracking-[.15em] text-coral">
          Conversation context
        </p>
        <h1 className="mt-2 text-[25px] font-bold" dir="auto">
          {item.title || "Untitled conversation"}
        </h1>
        <p className="mt-1 text-[8px] text-[#7b8781]">
          {item.detectedLanguage || "Unknown language"} · Updated{" "}
          {new Date(item.updatedAt).toLocaleString()}
        </p>
        {item.leads.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {item.leads.map((l: any) => (
              <a
                key={l.id}
                href={`/admin/leads/${l.id}`}
                className="rounded-full border bg-white px-3 py-1.5 text-[8px] font-bold"
              >
                Lead: {l.name} · {l.status}
              </a>
            ))}
          </div>
        )}
        <section className="mt-5 rounded-[20px] border bg-white p-5">
          <h2 className="text-[10px] font-bold">Conversation summary</h2>
          <pre className="mt-3 whitespace-pre-wrap font-sans text-[9px] leading-5 text-[#5f6c66]">
            {item.state?.summary
              ? JSON.stringify(item.state.summary, null, 2)
              : "No summary available."}
          </pre>
        </section>
        <section className="mt-5 space-y-3">
          {item.messages.map((m: any) => (
            <div
              key={m.id}
              className={`flex gap-3 ${m.role === "USER" ? "" : "flex-row-reverse"}`}
            >
              <div
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ${m.role === "USER" ? "bg-[#e7ece9]" : "bg-forest text-white"}`}
              >
                {m.role === "USER" ? (
                  <UserRound size={13} />
                ) : (
                  <Bot size={13} />
                )}
              </div>
              <div
                dir="auto"
                className={`max-w-[82%] rounded-2xl px-4 py-3 text-[10px] leading-5 ${m.role === "USER" ? "rounded-tl-sm bg-white border" : "rounded-tr-sm bg-[#e4eee9]"}`}
              >
                <p>{m.content}</p>
                <p className="mt-2 text-[7px] text-[#85908b]">
                  {m.role === "USER" ? "Customer" : "AI"} ·{" "}
                  {new Date(m.createdAt).toLocaleString()}
                </p>
              </div>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
