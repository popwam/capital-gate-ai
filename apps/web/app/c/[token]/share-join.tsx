"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getDeviceToken } from "@/lib/api";

export function ShareJoin({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    fetch("/api/nadim/share/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, deviceToken: getDeviceToken() }) })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.message || "Invalid conversation link"); return body; })
      .then((body) => { if (!cancelled) { localStorage.setItem("cgai-active-conversation", body.conversationId); router.replace("/"); } })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Invalid conversation link"); });
    return () => { cancelled = true; };
  }, [router, token]);
  return <main className="grid min-h-[100dvh] place-items-center bg-[var(--surface-base)] px-5" dir="auto"><section className="w-full max-w-md rounded-2xl border border-[var(--border-default)] bg-white p-7 text-center shadow-sm"><div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-[var(--surface-inset)] text-[var(--accent)]" aria-hidden="true">Cg</div><h1 className="mt-5 text-xl font-bold">{error ? "Conversation link unavailable" : "Opening your Nadim conversation"}</h1><p className="mt-2 text-sm leading-6 text-[var(--ink-secondary)]">{error || "Securely joining the shared conversation…"}</p>{error && <button onClick={() => router.replace("/")} className="mt-5 min-h-11 rounded-lg bg-[var(--accent)] px-4 text-sm font-bold text-white">Start a new conversation</button>}</section></main>;
}
