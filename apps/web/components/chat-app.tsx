"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  ArrowUp, Check, ChevronDown, Clock3, FileText,
  Heart, Image as ImageIcon, MapPin, Menu, MessageSquareText,
  MoreHorizontal, Plus, Search, ShieldCheck, Trash2, X
} from "lucide-react";
import { LogoMark } from "./logo";
import { ApiMessage, conversationsApi } from "@/lib/api";
import { textDirection } from "@/lib/text-direction";

type MessageKind = "text" | "properties" | "media" | "documents" | "map" | "lead_prompt" | "lead_created" | "conversation_closed";
type Message = { id: string; role: "user" | "assistant"; text: string; kind?: MessageKind; payload?: any };
type Conversation = { id: string; title: string; updatedAt: string; messages: Message[]; closed?: boolean };
type ActionSend = (value: string, displayValue?: string) => void;

const starters = [
  { labelAr: "بدور على بيت في القاهرة الجديدة", promptAr: "عاوز شقة في القاهرة الجديدة", labelEn: "Find a home in New Cairo", promptEn: "I want an apartment in New Cairo" },
  { labelAr: "عايز فرصة استثمارية في حدود 15 مليون", promptAr: "وريني اختيارات استثمارية في حدود 15 مليون", labelEn: "Explore an investment around EGP 15M", promptEn: "Show me investment options around EGP 15 million" },
  { labelAr: "وريني المتاح قريب من العاصمة", promptAr: "إيه المتاح قريب من العاصمة الإدارية؟", labelEn: "Search near the New Capital", promptEn: "What is available near the New Administrative Capital?" }
];

const uid = () => Math.random().toString(36).slice(2, 10);
const normalizeMessage = (message: ApiMessage): Message => { const assistant = message.role === "ASSISTANT"; const text = String(message.content ?? "").trim() || (assistant ? "الرد ده ما اكتملش وقتها. ابعتلي نفس السؤال تاني وأنا أكمله معاك." : ""); return { id: message.id, role: assistant ? "assistant" : "user", text, kind: (message.toolPayload?.type as MessageKind) || "text", payload: message.toolPayload }; };

export default function ChatApp() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState("fresh");
  const [input, setInput] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [lang, setLang] = useState<"EN" | "AR">("AR");
  const [liked, setLiked] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!localStorage.getItem("cgai-conversations") && localStorage.getItem("maqar-conversations")) {
      localStorage.setItem("cgai-conversations", localStorage.getItem("maqar-conversations") || "[]");
    }
    if (localStorage.getItem("cgai-cache-version") !== "3") localStorage.setItem("cgai-cache-version", "3");
    const saved = localStorage.getItem("cgai-conversations");
    if (saved) try { setConversations(JSON.parse(saved)); } catch { /* cache is optional */ }
    conversationsApi.list().then(items => { setConversations(items.map(c => ({ id: c.id, title: c.title || "New conversation", updatedAt: new Date(c.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }), messages: [], closed: Boolean(c.closed) }))); setConnectionError(""); }).catch(error => setConnectionError(error.message)).finally(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (hydrated) {
      // Limit cache to last 50 conversations to prevent unbounded growth
      const recentConversations = conversations.slice(-50);
      localStorage.setItem("cgai-conversations", JSON.stringify(recentConversations));
    }
  }, [conversations, hydrated]);

  useEffect(() => {
    document.documentElement.dir = lang === "AR" ? "rtl" : "ltr";
    document.documentElement.lang = lang === "AR" ? "ar" : "en";
  }, [lang]);

  const active = useMemo(() => conversations.find(c => c.id === activeId), [conversations, activeId]);
  const messages = active?.messages ?? [];
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, generating, streamingText]);

  useEffect(() => { if (activeId === "fresh") return; conversationsApi.messages(activeId).then(items => setConversations(prev => prev.map(c => c.id === activeId ? { ...c, messages: items.map(normalizeMessage) } : c))).catch(error => setConnectionError(error.message)); }, [activeId]);

  function newChat() { setActiveId("fresh"); setDrawer(false); setInput(""); }

  function append(id: string, message: Message) {
    setConversations(prev => prev.map(c => c.id === id ? { ...c, updatedAt: "Now", messages: [...c.messages, message] } : c));
  }

  async function send(value = input, displayValue?: string) {
    const clean = value.trim();
    const visible = (displayValue ?? value).trim();
    if (!clean || generating || active?.closed) return;
    let id = activeId;
    try {
      if (id === "fresh") { const title = clean.length > 50 ? clean.slice(0, 50) + "…" : clean; const created = await conversationsApi.create(title); id = created.id; setConversations(prev => [{ id, title: created.title || title, updatedAt: "الآن", messages: [], closed: false }, ...prev]); setActiveId(id); }
      append(id, { id: uid(), role: "user", text: visible }); setInput(""); setGenerating(true); setStreamingText(""); setConnectionError("");
      let completed: any;
      await conversationsApi.stream(id, clean, { token: text => setStreamingText(current => current + text), complete: data => { completed = data; } }, visible !== clean ? visible : undefined);
      if (completed?.message) append(id, normalizeMessage(completed.message));
      if (String(completed?.state?.language ?? "").startsWith("en")) setLang("EN");
      else if (String(completed?.state?.language ?? "").startsWith("ar")) setLang("AR");
      const closed = Boolean(completed?.state?.presentation?.conversationClosed) || completed?.message?.toolPayload?.type === "conversation_closed";
      if (closed) setConversations(prev => prev.map(c => c.id === id ? { ...c, closed: true } : c));
      setStreamingText("");
    } catch (error) { setConnectionError(error instanceof Error ? error.message : "Connection failed"); append(id, { id: uid(), role: "assistant", text: isArabic ? "تعذر الاتصال بالمستشار حالياً. حاول مرة أخرى بعد قليل." : "I couldn’t reach the property service. Please try again shortly." }); }
    finally { setGenerating(false); }
  }

  async function removeConversation(id: string) {
    try { await conversationsApi.remove(id); setConversations(prev => prev.filter(c => c.id !== id)); if (activeId === id) setActiveId("fresh"); } catch (error) { setConnectionError(error instanceof Error ? error.message : "Delete failed"); }
  }
  async function renameConversation(id: string, current: string) { const title = window.prompt("Rename conversation", current)?.trim(); if (!title) return; try { await conversationsApi.rename(id, title); setConversations(prev => prev.map(c => c.id === id ? {...c,title} : c)); } catch (error) { setConnectionError(error instanceof Error ? error.message : "Rename failed"); } }

  const isArabic = lang === "AR";

  return (
    <main className="cg-chat flex h-[100dvh] overflow-hidden" style={{ background: 'var(--surface-base)' }}>
      <aside className="hidden w-[264px] shrink-0 flex-col border-e bg-[var(--surface-overlay)] lg:flex" style={{ borderColor: 'var(--border-subtle)' }}>
        <Sidebar conversations={conversations} activeId={activeId} onSelect={setActiveId} onNew={newChat} onDelete={removeConversation} onRename={renameConversation} isArabic={isArabic} />
      </aside>

      {drawer && <div className="fixed inset-0 z-50 lg:hidden"><button className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={() => setDrawer(false)} aria-label="Close navigation"/><aside className="relative flex h-full w-[82%] max-w-[304px] flex-col shadow-2xl" style={{ background: 'var(--surface-overlay)', boxShadow: 'var(--shadow-2xl)' }}><button onClick={() => setDrawer(false)} className="absolute end-2 top-2 grid h-11 w-11 place-items-center rounded-full hover:bg-white/5" aria-label={isArabic ? "إغلاق قائمة المحادثات" : "Close conversations"}><X size={18}/></button><Sidebar conversations={conversations} activeId={activeId} onSelect={id => {setActiveId(id);setDrawer(false)}} onNew={newChat} onDelete={removeConversation} onRename={renameConversation} isArabic={isArabic}/></aside></div>}

      <section className="cg-surface relative flex min-w-0 flex-1 flex-col">
        <header className="cg-glass-strong z-20 flex h-14 shrink-0 items-center justify-between px-2 sm:px-5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="flex min-w-0 items-center gap-1 sm:gap-3">
            <button onClick={() => setDrawer(true)} className="grid h-11 w-11 place-items-center rounded-full lg:hidden" aria-label="Open conversations"><Menu size={18}/></button>
            <span className="text-[14px] font-extrabold lg:hidden">Cg</span>
            <div className="hidden min-w-0 sm:block"><p className="max-w-[48vw] truncate text-[13px] font-semibold" dir="auto">{active?.title ?? (isArabic ? "محادثة جديدة" : "New conversation")}</p></div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 text-[11px] font-medium sm:flex" style={{ color: 'var(--ink-tertiary)' }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--success)' }}/>{isArabic ? "مخزون موثق" : "Verified inventory"}</span>
            <button onClick={() => setLang(lang === "EN" ? "AR" : "EN")} className="btn-ghost grid h-11 min-w-11 place-items-center rounded-full px-2 text-[12px] font-bold" aria-label={lang === "EN" ? "التبديل إلى العربية" : "Switch to English"}>{lang === "EN" ? "ع" : "EN"}</button>
            <button onClick={newChat} className="grid h-11 w-11 place-items-center rounded-full lg:hidden" aria-label={isArabic ? "محادثة جديدة" : "New conversation"}><Plus size={17}/></button>
          </div>
        </header>

        <div ref={scrollRef} className="scrollbar-none flex-1 overflow-y-auto">
          {messages.length === 0 ? <Welcome isArabic={isArabic} onSelect={setInput}/> : (
            <div className="mx-auto w-full max-w-[820px] px-4 pb-32 pt-6 sm:px-7 sm:pt-9" role="log" aria-live="polite" aria-atomic="false" aria-label={isArabic ? "سجل المحادثة" : "Conversation log"}>
              {messages.map((m, i) => <MessageView key={m.id} message={m} liked={liked} setLiked={setLiked} onAction={send} isLast={i === messages.length - 1} isArabic={isArabic}/>) }
              {generating && <div className="message-rise mb-6 flex gap-2.5"><AssistantAvatar/>{streamingText ? <div className="message-assistant chat-copy max-w-[92%] pt-0.5 sm:max-w-[88%]" dir={textDirection(streamingText)}><><RichChatText text={streamingText}/><span className="ms-1 inline-block h-4 w-0.5 animate-pulse" style={{ background: 'var(--accent)' }}/></></div> : <div className="mt-1 flex h-8 items-center gap-2 px-1" role="status" aria-live="polite" aria-atomic="true"><div className="flex gap-1"><span className="typing-dot h-1 w-1 rounded-full"/><span className="typing-dot h-1 w-1 rounded-full"/><span className="typing-dot h-1 w-1 rounded-full"/></div><span className="text-[11px] font-medium" style={{ color: 'var(--ink-tertiary)' }}>Cg {isArabic ? 'بيفكر' : 'thinking'}</span></div>}</div>}
            </div>
          )}
        </div>
        {connectionError && <div className="absolute bottom-[132px] left-1/2 z-30 -translate-x-1/2 rounded-full px-4 py-2 text-[11px] font-semibold text-white" style={{ background: 'var(--error-text)', boxShadow: 'var(--shadow-lg)' }}>{connectionError}</div>}
        {active?.closed ? <ClosedComposer isArabic={isArabic} onNew={newChat}/> : <Composer input={input} setInput={setInput} send={() => send()} disabled={generating} isArabic={isArabic}/>}
      </section>
    </main>
  );
}

function Sidebar({ conversations, activeId, onSelect, onNew, onDelete, onRename, isArabic }: { conversations: Conversation[]; activeId: string; onSelect: (id:string)=>void; onNew:()=>void; onDelete:(id:string)=>void; onRename:(id:string,title:string)=>void; isArabic:boolean }) {
  const [query,setQuery]=useState("");
  const visible=conversations.filter(c=>!query.trim()||c.title.toLowerCase().includes(query.trim().toLowerCase()));
  return <>
    <div className="px-4 pb-4 pt-5"><div className="logo-entrance"><LogoMark inverse/></div><button onClick={onNew} className="btn-primary mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-lg text-[12px] font-bold text-white transition" style={{ background: 'var(--accent)', boxShadow: 'var(--shadow-sm)' }} aria-label={isArabic ? "محادثة جديدة" : "New conversation"}><Plus size={15}/> {isArabic ? "محادثة جديدة" : "New conversation"}</button></div>
    <div className="px-3"><div className="relative"><label htmlFor="conversation-search" className="sr-only">{isArabic ? "ابحث في المحادثات" : "Search conversations"}</label><Search className="absolute start-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink-tertiary)' }} size={13} aria-hidden="true"/><input id="conversation-search" value={query} onChange={e=>setQuery(e.target.value)} className="h-10 w-full rounded-lg bg-[var(--surface-inset)] pe-3 ps-9 text-[12px] outline-none" placeholder={isArabic ? "ابحث في المحادثات" : "Search conversations"} aria-label={isArabic ? "ابحث في المحادثات" : "Search conversations"}/></div></div>
    <nav aria-label={isArabic ? "المحادثات" : "Conversations"} className="scrollbar-none mt-5 flex-1 overflow-y-auto px-2"><p className="px-2 text-[10px] font-bold uppercase tracking-[.12em]" style={{ color: 'var(--ink-tertiary)' }}>{isArabic ? "الأخيرة" : "Recent"}</p><div className="mt-1.5 space-y-0.5" role={visible.length ? "list" : undefined}>{visible.map(c => <button key={c.id} onClick={() => onSelect(c.id)} onDoubleClick={()=>onRename(c.id,c.title)} title="Double-click to rename" className={`${activeId === c.id ? 'conversation-active' : ''} group flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start transition`} style={{ background: activeId === c.id ? 'var(--surface-raised)' : 'transparent' }} role="listitem" aria-current={activeId === c.id ? 'page' : undefined}><MessageSquareText size={14} style={{ color: activeId === c.id ? 'var(--accent-warm)' : 'var(--ink-tertiary)' }} aria-hidden="true"/><span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-semibold" dir="auto">{c.title}</span><span className="block text-[10px]" style={{ color: 'var(--ink-tertiary)' }}>{c.updatedAt}</span></span><span onClick={e => {e.stopPropagation();onDelete(c.id)}} className="hidden h-10 w-10 place-items-center rounded-lg group-hover:grid" style={{ color: 'var(--ink-tertiary)' }} role="button" tabIndex={0} aria-label={isArabic ? "حذف المحادثة" : "Delete conversation"}><Trash2 size={13}/></span></button>)}{!visible.length&&<p className="px-3 py-5 text-center text-[12px]" style={{ color: 'var(--ink-tertiary)' }}>{isArabic ? "مفيش محادثات مطابقة" : "No matching conversations"}</p>}</div></nav>
  </>;
}

function Welcome({ onSelect, isArabic }: { onSelect:(v:string)=>void; isArabic:boolean }) {
  return <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col justify-center px-4 pb-28 pt-5 sm:px-7 sm:pb-32" dir={isArabic ? "rtl" : "ltr"}>
    <div className="w-full max-w-[620px]">
      <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold" style={{ color: 'var(--ink-secondary)' }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--success)' }}/>{isArabic?"إجابات من المخزون الموثق":"Answers from verified inventory"}</div>
      <h1 className="text-balance text-[28px] font-extrabold leading-[1.4] sm:text-[38px]" style={{ color: 'var(--ink-primary)' }}>{isArabic ? "احكيلي إيه اللي بتدور عليه." : "Tell me what you’re looking for."}</h1>
      <p className="mt-2 max-w-[560px] text-[14px] leading-7 sm:text-[15px]" style={{ color: 'var(--ink-secondary)' }}>{isArabic ? "ميزانية، منطقة، أو هدف استثماري — اتكلم بطريقتك وأنا أرتب البحث." : "Share a budget, location, or investment goal. Ask naturally and I’ll shape the search."}</p>
    </div>
    <div className="mt-6 w-full max-w-[620px] divide-y divide-[var(--border-subtle)]" dir={isArabic?"rtl":"ltr"}>{starters.map(({labelAr,promptAr,labelEn,promptEn}) => { const label = isArabic ? labelAr : labelEn; const prompt = isArabic ? promptAr : promptEn; return <button key={label} type="button" onClick={() => onSelect(prompt)} className="group flex min-h-11 w-full items-center justify-between gap-3 py-2.5 text-start text-[13px] font-semibold transition hover:text-[var(--accent-warm)]"><span>{label}</span><ArrowUp className="shrink-0 rotate-[-45deg] opacity-50 transition group-hover:opacity-100" size={14}/></button>})}</div>
  </div>;
}

function AssistantAvatar() { return <div className="avatar-assistant grid h-7 w-7 shrink-0 place-items-center rounded-lg" aria-hidden="true"><span className="text-[10px] font-black">Cg</span></div>; }

function MessageView({ message, liked, setLiked, onAction, isLast, isArabic }: { message:Message;liked:boolean;setLiked:(v:boolean)=>void;onAction:ActionSend;isLast:boolean;isArabic:boolean }) {
  const assistant = message.role === "assistant";
  const actions = Array.isArray(message.payload?.uiActions) ? message.payload.uiActions : [];
  const cards = actions.find((action:any) => action.type === "PROPERTY_CARDS")?.payload?.properties ?? [];
  const photos = actions.find((action:any) => action.type === "PROJECT_PHOTOS")?.payload?.media ?? [];
  const brochures = actions.find((action:any) => action.type === "PROJECT_BROCHURE")?.payload?.documents ?? [];
  const location = actions.find((action:any) => action.type === "PROJECT_LOCATION")?.payload?.map;
  const distance = actions.find((action:any) => action.type === "DISTANCE_RESULT")?.payload;
  const contactAction = actions.find((action:any) => action.type === "CONTACT_REQUEST");
  const paymentAction = actions.find((action:any) => action.type === "PAYMENT_CHOICES");
  const closedAction = actions.find((action:any) => action.type === "CONVERSATION_CLOSED");
  const contact = Boolean(contactAction);
  return <div className={`message-rise mb-6 flex gap-2.5 ${assistant ? "justify-start" : "justify-end"}`}>
    {assistant && <AssistantAvatar/>}
    <div className={assistant ? "max-w-[94%] sm:max-w-[86%]" : "max-w-[88%] sm:max-w-[78%]"}>
      <div dir={textDirection(message.text)} className={assistant ? "chat-copy message-assistant pt-0.5 text-start text-[16px] leading-[1.9] sm:text-[17px]" : "chat-copy message-user rounded-[18px] rounded-tr-md px-3.5 py-2.5 text-start text-[15px] leading-[1.8] sm:text-[16px]"}><RichChatText text={message.text}/></div>
      {!!cards.length && <PropertyResults properties={cards} liked={liked} setLiked={setLiked} onAction={onAction} isArabic={isArabic}/>}
      {!!photos.length && <MediaGallery media={photos}/>}
      {!!brochures.length && <Documents documents={brochures}/>}
      {!!location && <MapResult map={location}/>}
      {!!distance && <DistanceResult result={distance}/>}
      {!!paymentAction && <PaymentChoices action={paymentAction.payload} onAction={onAction} isArabic={isArabic}/>}
      {!!closedAction && <ConversationClosedNotice isArabic={isArabic}/>}
      {(contact || message.kind === "lead_created") && <LeadHint created={message.kind === "lead_created"} action={contactAction?.payload} onAction={onAction} isArabic={isArabic}/>}
      {assistant && isLast && <div className="mt-2 flex gap-1"><button className="rounded-lg p-1.5 hover:bg-[#efede7]" style={{ color: 'var(--ink-tertiary)' }} aria-label={isArabic ? "مفيد" : "Helpful"}><Check size={13}/></button><button className="rounded-lg p-1.5 hover:bg-[#efede7]" style={{ color: 'var(--ink-tertiary)' }} aria-label={isArabic ? "خيارات إضافية" : "More options"}><MoreHorizontal size={14}/></button></div>}
    </div>
  </div>;
}

function PropertyResults({ properties, liked, setLiked, onAction, isArabic }: {properties:any[];liked:boolean;setLiked:(v:boolean)=>void;onAction:ActionSend;isArabic:boolean}) {
  if (!properties.length) return null;
  const money = (value:any, currency="EGP") => value == null ? (isArabic ? "السعر غير متاح" : "Price unavailable") : `${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(Number(value))} ${currency}`;
  const paymentLabel = (property:any) => {
    const quoted = property.bestPaymentPlan;
    if (quoted) {
      const duration = quoted.durationMonths ? (isArabic ? `${quoted.durationMonths} شهر` : `${quoted.durationMonths} mo`) : null;
      const dp = quoted.downPaymentAmount != null ? money(quoted.downPaymentAmount, quoted.currency || property.currency) : quoted.downPaymentPercent != null ? `${quoted.downPaymentPercent}%` : null;
      const installment = quoted.monthlyEquivalent != null ? money(quoted.monthlyEquivalent, quoted.currency || property.currency) : null;
      return [duration, dp ? (isArabic ? `مقدم ${dp}` : `DP ${dp}`) : null, installment ? (isArabic ? `≈ ${installment} شهريًا` : `≈ ${installment}/mo`) : null].filter(Boolean).join(" · ");
    }
    const plans = Array.isArray(property.paymentPlans) ? property.paymentPlans : [];
    if (!plans.length) return null;
    const plan = [...plans].sort((a,b)=>Number(b.durationMonths ?? 0)-Number(a.durationMonths ?? 0))[0];
    const duration = plan.durationMonths ? (isArabic ? `${plan.durationMonths} شهر` : `${plan.durationMonths} mo`) : null;
    const dp = plan.downPaymentAmount != null ? money(plan.downPaymentAmount, plan.currency || property.currency) : plan.downPaymentPercent != null ? `${plan.downPaymentPercent}%` : null;
    return [duration, dp ? (isArabic ? `مقدم ${dp}` : `DP ${dp}`) : null].filter(Boolean).join(" · ");
  };

  return <div className="scrollbar-none mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 pe-2">{properties.slice(0,5).map((property,index)=>{
    const image = property.media?.[0]?.url;
    const plan = paymentLabel(property);
    return <div key={property.id} className="w-[min(360px,86vw)] shrink-0 snap-start overflow-hidden rounded-[22px] border border-[#dcddd7] bg-white shadow-[0_10px_35px_rgba(29,48,41,.07)]" dir={isArabic ? "rtl" : "ltr"}>
      {image && <div className="aspect-[16/8] w-full overflow-hidden bg-[#f1efe9]"><Image src={image} alt={property.media?.[0]?.altText || property.project?.name || "Unit"} fill className="object-cover" sizes="(max-width: 640px) 86vw, 360px" /></div>}
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[#e2f0e9] px-2.5 py-1 text-[11px] font-bold text-[#287458]">{isArabic ? "متاحة ومتحقق منها" : "Verified available"}</span>
              {property.externalUnitId && <span className="rounded-full bg-[#f4f1ea] px-2.5 py-1 text-[11px] font-semibold text-[#6d7872]">{isArabic ? "وحدة" : "Unit"} {property.externalUnitId}</span>}
            </div>
            <h3 className="truncate text-[17px] font-bold" dir="auto">{property.project?.name ?? (isArabic ? "مشروع موثق" : "Verified project")}</h3>
            <p className="mt-1 text-[13px] text-[#66736d]" dir="auto">{property.developer?.name ?? (isArabic ? "المطور غير مذكور" : "Developer not provided")}</p>
            <p className="mt-1 flex items-center gap-1 text-[13px] text-[#76817c]" dir="auto"><MapPin size={13}/> {property.project?.location?.name ?? (isArabic ? "الموقع عند الطلب" : "Location on request")}</p>
          </div>
          {index===0&&<button onClick={() => setLiked(!liked)} aria-label={isArabic ? "حفظ الوحدة" : "Save unit"} className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border ${liked ? "border-[#f0c4ba] bg-[#fbe9e5] text-coral" : "border-[#dedfd9] text-[#7c8983]"}`}><Heart size={15} fill={liked ? "currentColor" : "none"}/></button>}
        </div>

        <div className="my-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl bg-[#f7f5f0] p-3"><p className="text-[11px] text-[#89938f]">{isArabic ? "السعر" : "Price"}</p><p className="mt-1 text-[14px] font-bold">{money(property.price,property.currency)}</p></div>
          <div className="rounded-xl bg-[#f7f5f0] p-3"><p className="text-[11px] text-[#89938f]">{isArabic ? "التقسيم" : "Layout"}</p><p className="mt-1 text-[14px] font-bold">{property.bedrooms ?? "—"} {isArabic ? "غرف" : "bed"} · {property.bathrooms ?? "—"} {isArabic ? "حمام" : "bath"}</p></div>
          <div className="rounded-xl bg-[#f7f5f0] p-3"><p className="text-[11px] text-[#89938f]">{isArabic ? "المساحة" : "Area"}</p><p className="mt-1 text-[14px] font-bold">{property.builtUpArea ?? "—"} م²</p></div>
          <div className="rounded-xl bg-[#f7f5f0] p-3"><p className="text-[11px] text-[#89938f]">{isArabic ? "التسليم" : "Delivery"}</p><p className="mt-1 text-[14px] font-bold">{property.deliveryDate ? new Date(property.deliveryDate).toLocaleDateString(isArabic ? "ar-EG" : undefined,{year:"numeric",month:"short"}) : (isArabic ? "غير محدد" : "Not provided")}</p></div>
        </div>

        {(property.floor || property.projectZone?.name || property.projectBuilding?.name || property.closestGate?.name) && <div className="mb-3 flex flex-wrap gap-2 text-[12px] text-[#596861]">
          {property.floor && <span className="rounded-full bg-[#f4f1ea] px-3 py-1.5">{isArabic ? `الدور ${property.floor}` : `Floor ${property.floor}`}</span>}
          {property.projectZone?.name && <span className="rounded-full bg-[#f4f1ea] px-3 py-1.5" dir="auto">{property.projectZone.name}</span>}
          {property.projectBuilding?.name && <span className="rounded-full bg-[#f4f1ea] px-3 py-1.5" dir="auto">{isArabic ? `مبنى ${property.projectBuilding.name}` : `Building ${property.projectBuilding.name}`}</span>}
          {property.closestGate?.name && <span className="rounded-full bg-[#e9f3ee] px-3 py-1.5" dir="auto">{property.closestGate.name}{property.closestGate.distanceMeters!=null ? ` · ${property.closestGate.distanceMeters}m` : ""}</span>}
        </div>}
        {plan && <div className="mb-4 rounded-xl border border-[#e1e5df] bg-[#fbfcfa] px-3 py-2 text-[13px] font-semibold text-[#4d5d55]">{isArabic ? "أفضل خطة سداد موثقة: " : "Verified payment plan: "}{plan}</div>}

        <div className="flex flex-wrap gap-2">
          <button onClick={() => onAction(isArabic ? `وريني صور الوحدة ${property.externalUnitId}` : `Show me photos of unit ${property.externalUnitId}`)} className="flex h-11 items-center gap-1.5 rounded-full border border-[#d9dcd6] px-4 text-[12px] font-bold hover:bg-[#f7f5f0]"><ImageIcon size={14}/> {isArabic ? "صور الوحدة" : "Unit photos"}</button>
          <button onClick={() => onAction(isArabic ? `نظام السداد للوحدة ${property.externalUnitId}` : `Payment plan for unit ${property.externalUnitId}`)} className="flex h-11 items-center gap-1.5 rounded-full border border-[#d9dcd6] px-4 text-[12px] font-bold hover:bg-[#f7f5f0]"><FileText size={14}/> {isArabic ? "نظام السداد" : "Payment plan"}</button>
          <button onClick={() => onAction(isArabic ? `وريني موقع مشروع ${property.project?.name}` : `Show me the location of ${property.project?.name}`)} className="flex h-11 items-center gap-1.5 rounded-full border border-[#d9dcd6] px-4 text-[12px] font-bold hover:bg-[#f7f5f0]"><MapPin size={14}/> {isArabic ? "الموقع" : "Location"}</button>
          <button onClick={() => { const label = humanPropertyLabel(property, isArabic); onAction(isArabic ? `عاوز أعاين الوحدة ${property.externalUnitId}` : `I want to book a viewing for unit ${property.externalUnitId}`, isArabic ? `عاوز أعاين ${label}` : `I want to view ${label}`); }} className="h-11 rounded-full bg-forest px-4 text-[12px] font-bold text-white">{isArabic ? "طلب معاينة" : "Request viewing"}</button>
        </div>
      </div>
    </div>;
  })}</div>;
}

function humanPropertyLabel(property:any,isArabic:boolean) {
  const area=property?.builtUpArea!=null?`${Number(property.builtUpArea)} ${isArabic?"م²":"m²"}`:null;
  const rooms=property?.bedrooms!=null?`${property.bedrooms} ${isArabic?"غرف":property.bedrooms===1?"bedroom":"bedrooms"}`:null;
  const type=property?.unitType && !rooms ? String(property.unitType) : null;
  const project=property?.project?.name ? (isArabic?`مشروع ${property.project.name}`:`in ${property.project.name}`) : null;
  return [isArabic?"وحدة":"Unit",area,rooms,type,project].filter(Boolean).join(" · ");
}

function RichChatText({text}:{text:string}) {
  const inline=(line:string,key:string)=>line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part,index)=>part.startsWith("**")&&part.endsWith("**")?<strong key={`${key}-${index}`} className="font-bold" style={{color:'var(--ink-primary)'}}>{part.slice(2,-2)}</strong>:<span key={`${key}-${index}`}>{part}</span>);
  return <>{String(text??"").split("\n").map((line,index)=><span key={index}>{inline(line,String(index))}{index<String(text??"").split("\n").length-1&&<br/>}</span>)}</>;
}

function PaymentChoices({action,onAction,isArabic}:{action?:any;onAction:ActionSend;isArabic:boolean}) {
  const choices=action?.choices ?? {};
  if (!choices?.hasCash && !choices?.hasInstallment) return null;
  return <div className="mt-3 rounded-2xl border border-[#dce3dd] bg-white p-3">
    <p className="text-[12px] font-bold text-[#31443d]">{isArabic?"اختار طريقة الدفع":"Choose payment route"}</p>
    <div className="mt-2 flex flex-wrap gap-2">
      {choices.hasCash&&<button onClick={()=>onAction(isArabic?"كاش":"Cash")} className="rounded-full bg-forest px-4 py-2.5 text-[12px] font-bold text-white">{isArabic?"كاش":"Cash"}</button>}
      {choices.hasInstallment&&<button onClick={()=>onAction(isArabic?"تقسيط":"Installments")} className="rounded-full border border-[#b8c8c0] bg-[#f8faf8] px-4 py-2.5 text-[12px] font-bold text-[#315f55]">{isArabic?"تقسيط":"Installments"}</button>}
    </div>
  </div>;
}

function ConversationClosedNotice({isArabic}:{isArabic:boolean}) { return <div className="mt-3 rounded-2xl border border-[#e3d8c8] bg-[#f7f2e9] p-3 text-[12px] text-[#715d3e]">{isArabic?"تم إنهاء المحادثة دي. ابدأ محادثة جديدة لو حابب ترجع للاستشارات العقارية.":"This conversation is closed. Start a new conversation if you want to return to property advice."}</div>; }

function MediaGallery({media}:{media:any[]}) { if(!media.length) return <EmptyAttachment label="No approved project images are available yet."/>; return <div className="mt-4 grid grid-cols-2 gap-2 rounded-[20px] border border-[#dcddd7] bg-white p-2" dir="ltr">{media.slice(0,6).map((item,index)=><a key={item.id} href={item.url} target="_blank" rel="noreferrer" className={`${index===0?"col-span-2 aspect-[16/9]":"aspect-square"} relative overflow-hidden rounded-[14px]`}><img src={item.url} alt={item.altText || "Project image"} className="h-full w-full object-cover"/></a>)}</div>; }
function Documents({documents}:{documents:any[]}) { if(!documents.length) return <EmptyAttachment label="No approved brochure is available yet."/>; return <div className="mt-3 space-y-2">{documents.map(item=><a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="flex w-full items-center gap-3 rounded-2xl border border-[#dcddd7] bg-white p-4 text-start shadow-sm" dir="ltr"><div className="grid h-11 w-11 place-items-center rounded-xl bg-[#f7ded7] text-coral"><FileText size={19}/></div><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-bold" dir="auto">{item.name}</p><p className="mt-1 text-[11px] text-[#89938f]">{item.mimeType} · Verified project document</p></div><ArrowUp className="rotate-45 text-[#73817a]" size={16}/></a>)}</div>; }
function MapResult({map}:{map:any}) { if(!map) return <EmptyAttachment label="Verified map coordinates are not available yet."/>; return <a href={map.url} target="_blank" rel="noreferrer" className="mt-3 flex items-center gap-3 rounded-2xl border border-[#dcddd7] bg-white p-4"><div className="grid h-10 w-10 place-items-center rounded-xl bg-[#e2f0e9] text-forest"><MapPin size={18}/></div><div className="flex-1"><p className="text-[12px] font-bold">Open verified project location</p><p className="mt-1 text-[11px] text-[#89938f]">{String(map.latitude)}, {String(map.longitude)}</p></div><ArrowUp className="rotate-45" size={15}/></a>; }
function DistanceResult({result}:{result:any}) {
  const route=result?.route; if(!route||route.source==="UNAVAILABLE") return null;
  const km=route.distanceKm ?? (route.routes?.[0]?.distanceMeters != null ? Number(route.routes[0].distanceMeters)/1000 : null);
  const minutes=route.estimatedMinutes ?? (route.routes?.[0]?.duration ? Math.round(Number.parseFloat(route.routes[0].duration)/60) : null);
  const origin=result?.origin ?? route.from; const destination=result?.destination ?? route.to;
  const href=origin&&destination?`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`:null;
  return <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-[#dcddd7] bg-white p-4"><div className="grid h-10 w-10 place-items-center rounded-xl bg-[#e2f0e9] text-forest"><Clock3 size={18}/></div><div className="min-w-[150px] flex-1"><p className="text-[14px] font-bold">{km!=null?`${km.toFixed(1)} km`:"Route"}{minutes!=null?` · ${minutes} min`:""}</p><p className="mt-1 text-[12px] text-[#89938f]">{route.source==="ADMIN_VERIFIED"?"مسافة موثقة":"Google Routes"}</p></div>{href&&<a href={href} target="_blank" rel="noreferrer" className="rounded-full bg-forest px-4 py-2 text-[12px] font-bold text-white">الاتجاهات</a>}</div>;
}
function EmptyAttachment({label}:{label:string}) { return <div className="mt-3 rounded-xl border border-dashed border-[#cfd3ce] px-4 py-3 text-[11px] text-[#738079]">{label}</div>; }
function LeadHint({created,action,onAction,isArabic}:{created:boolean;action?:any;onAction:ActionSend;isArabic:boolean}) {
  const stage=String(action?.stage ?? "");
  if (stage === "COMPLETE") return <div className="mt-3 rounded-2xl border border-[#dce8e1] bg-[#edf5f1] p-3 text-[12px] text-[#39705b]"><div className="flex items-center gap-2 font-semibold"><ShieldCheck size={14}/><span>{isArabic?"الطلب كامل وجاهز للتنسيق مع المبيعات":"The request is complete and ready for sales coordination"}</span></div></div>;
  return <div className="mt-3 rounded-2xl border border-[#dce8e1] bg-[#edf5f1] p-3 text-[12px] text-[#39705b]">
    <div className="flex items-center gap-2 font-semibold"><ShieldCheck size={14}/><span>{stage==="VERIFY_CONTACT"?(isArabic?"راجع الاسم ورقم الموبايل ونكمل":"Check the name and mobile number and we can continue") : stage==="CONFIRMATION"?(isArabic?"اختار طريقة تأكيد الموعد":"Choose how the appointment should be confirmed") : created?(isArabic?"الطلب محفوظ ونكمل آخر خطوة":"The request is saved; one last step"):(isArabic?"الاسم ورقم الموبايل كفاية للخطوة دي":"Name and mobile number are enough for this step")}</span></div>
    {stage==="CONFIRMATION"&&<div className="mt-3 flex flex-wrap gap-2">
      <button onClick={()=>onAction(isArabic?"التأكيد المفضل مكالمة":"Preferred confirmation is a phone call")} className="rounded-full border border-[#b9d0c6] bg-white px-3 py-2 text-[11px] font-bold">{isArabic?"مكالمة":"Call"}</button>
      <button onClick={()=>onAction(isArabic?"التأكيد المفضل واتساب":"Preferred confirmation is WhatsApp")} className="rounded-full border border-[#b9d0c6] bg-white px-3 py-2 text-[11px] font-bold">WhatsApp</button>
    </div>}
  </div>;
}

function ClosedComposer({isArabic,onNew}:{isArabic:boolean;onNew:()=>void}) {
  return <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 pb-[max(14px,env(safe-area-inset-bottom))] pt-10 sm:px-6" style={{ background: 'linear-gradient(to top, var(--surface-base), var(--surface-base) 60%, transparent)' }}><div className="pointer-events-auto mx-auto flex max-w-[860px] items-center justify-between gap-3 rounded-[22px] p-3 shadow-lg" style={{ border: '1px solid var(--warning-border)', background: 'rgba(255, 255, 255, 0.96)', boxShadow: 'var(--shadow-xl)' }}><p className="text-[13px]" style={{ color: 'var(--ink-secondary)' }}>{isArabic?"المحادثة دي انتهت.":"This conversation has ended."}</p><button onClick={onNew} className="btn-primary shrink-0 rounded-full px-4 py-2.5 text-[12px] font-bold text-white" style={{ background: 'var(--forest)' }}>{isArabic?"محادثة جديدة":"New conversation"}</button></div></div>;
}

function Composer({ input, setInput, send, disabled, isArabic }: {input:string;setInput:(v:string)=>void;send:()=>void;disabled:boolean;isArabic:boolean}) {
  return <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-8 sm:px-6" style={{ background: 'linear-gradient(to top, var(--surface-base), var(--surface-base) 64%, transparent)' }}>
    <div className="pointer-events-auto mx-auto max-w-[820px]">
      <div className="input-focus-glow cg-glass flex items-end gap-2 rounded-[18px] px-2 py-1.5 transition" style={{ border: '1px solid var(--border-default)', boxShadow: 'var(--shadow-lg)' }}>
        <label htmlFor="message-input" className="sr-only">{isArabic ? "اكتب رسالتك" : "Type your message"}</label>
        <textarea id="message-input" dir={input ? textDirection(input) : (isArabic ? "rtl" : "ltr")} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)){e.preventDefault();send();}}} rows={1} placeholder={isArabic ? "اسأل عن وحدة، منطقة، أو ميزانية..." : "Ask about a unit, location, or budget..."} className="scrollbar-none block max-h-32 min-h-11 flex-1 resize-none bg-transparent px-2.5 py-2.5 text-start text-[15px] leading-6 text-[var(--ink-primary)] caret-[var(--accent)] outline-none" aria-label={isArabic ? "اكتب رسالتك" : "Type your message"}/>
        <button disabled={disabled || !input.trim()} onClick={send} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white transition" style={{ background: disabled || !input.trim() ? 'var(--surface-raised)' : 'var(--accent)' }} aria-label={isArabic?"إرسال":"Send"}><ArrowUp size={17}/></button>
      </div>
    </div>
  </div>;
}
