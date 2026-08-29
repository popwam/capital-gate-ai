"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp, Check, ChevronDown, Clock3, FileText,
  MapPin, Menu, MessageSquareText,
  MoreHorizontal, Plus, Search, Share2, ShieldCheck, Smartphone, Trash2, X
} from "lucide-react";
import { ApiMessage, conversationsApi, nadimWebApi } from "@/lib/api";
import { appendUniqueMessage, mergeConversationIndex, shouldLoadConversationHistory } from "@/lib/chat-state";
import { textDirection } from "@/lib/text-direction";

type MessageKind = "text" | "properties" | "media" | "documents" | "map" | "lead_prompt" | "lead_created" | "conversation_closed";
type Message = { id: string; role: "user" | "assistant"; text: string; kind?: MessageKind; payload?: any };
type Conversation = { id: string; title: string; updatedAt: string; messages: Message[]; nadimConversationId?: string; mode?: "AI" | "HUMAN" | "PAUSED"; closed?: boolean };
type ActionSend = (value: string, displayValue?: string) => void;

const starters = [
  { labelAr: "وحدة في حدود 5 مليون", promptAr: "عاوز وحدة في حدود 5 مليون", labelEn: "A unit around EGP 5M", promptEn: "I want a unit around EGP 5 million" },
  { labelAr: "استثمار", promptAr: "وريني فرص استثمارية موثقة", labelEn: "Investment", promptEn: "Show me verified investment options" },
  { labelAr: "أقرب مشروع", promptAr: "إيه أقرب مشروع متاح؟", labelEn: "Nearest project", promptEn: "What is the nearest available project?" }
];

const uid = () => Math.random().toString(36).slice(2, 10);
const normalizeMessage = (message: ApiMessage): Message => { const assistant = message.role === "ASSISTANT"; const raw = String(message.content ?? ""); const text = raw.trim() ? raw : (assistant ? "الرد ده ما اكتملش وقتها. ابعتلي نفس السؤال تاني وأنا أكمله معاك." : ""); return { id: message.id, role: assistant ? "assistant" : "user", text, kind: (message.toolPayload?.type as MessageKind) || "text", payload: message.toolPayload }; };

export default function ChatApp() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState("fresh");
  const [input, setInput] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [lang, setLang] = useState<"EN" | "AR">("AR");
  const [hydrated, setHydrated] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [actionMenu, setActionMenu] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [freshMessages, setFreshMessages] = useState<Message[]>([]);
  const [freshTitle, setFreshTitle] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const skipHistoryOnceRef = useRef(new Set<string>());
  const locallyCreatedIdsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!localStorage.getItem("cgai-conversations") && localStorage.getItem("maqar-conversations")) {
      localStorage.setItem("cgai-conversations", localStorage.getItem("maqar-conversations") || "[]");
    }
    if (localStorage.getItem("cgai-cache-version") !== "3") localStorage.setItem("cgai-cache-version", "3");
    const saved = localStorage.getItem("cgai-conversations");
    if (saved) try { setConversations(JSON.parse(saved)); } catch { /* cache is optional */ }
    conversationsApi.list().then(items => {
      const incoming = items.map(c => ({ id: c.id, title: c.title || "New conversation", updatedAt: new Date(c.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }), messages: [] as Message[], nadimConversationId: c.nadimConversationId ?? undefined, mode: c.mode ?? "AI", closed: Boolean(c.closed) }));
      setConversations(current => mergeConversationIndex(current, incoming, locallyCreatedIdsRef.current));
      const savedActiveId = localStorage.getItem("cgai-active-conversation");
      if (savedActiveId && incoming.some(conversation => conversation.id === savedActiveId)) setActiveId(savedActiveId);
      setConnectionError("");
    }).catch(error => setConnectionError(error.message)).finally(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (hydrated) {
      // Limit cache to last 50 conversations to prevent unbounded growth
      const recentConversations = conversations.slice(0, 50);
      localStorage.setItem("cgai-conversations", JSON.stringify(recentConversations));
    }
  }, [conversations, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    if (activeId === "fresh") localStorage.removeItem("cgai-active-conversation");
    else localStorage.setItem("cgai-active-conversation", activeId);
  }, [activeId, hydrated]);

  useEffect(() => {
    document.documentElement.dir = lang === "AR" ? "rtl" : "ltr";
    document.documentElement.lang = lang === "AR" ? "ar" : "en";
  }, [lang]);

  const active = useMemo(() => conversations.find(c => c.id === activeId), [conversations, activeId]);
  const messages = active?.messages ?? (activeId === "fresh" ? freshMessages : []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, generating]);

  useEffect(() => {
    if (!shouldLoadConversationHistory(activeId, skipHistoryOnceRef.current)) return;
    let cancelled = false;
    conversationsApi.messages(activeId).then(items => {
      if (!cancelled) setConversations(prev => prev.map(c => c.id === activeId ? { ...c, messages: items.map(normalizeMessage) } : c));
    }).catch(error => { if (!cancelled) setConnectionError(error.message); });
    return () => { cancelled = true; };
  }, [activeId]);

  function newChat() { setActiveId("fresh"); setDrawer(false); setInput(""); setFreshMessages([]); setFreshTitle(""); }

  function append(id: string, message: Message) {
    setConversations(prev => appendUniqueMessage(prev.map(c => c.id === id ? { ...c, updatedAt: "Now" } : c), id, message));
  }

  async function send(value = input, displayValue?: string, controlCommand?: "REQUEST_HUMAN_HANDOFF" | "RETURN_TO_AI") {
    const clean = value.trim();
    const visible = (displayValue ?? value).trim();
    if (!clean || generating || active?.closed) return;
    let id = activeId;
    const eventId = crypto.randomUUID();
    const userMessage = { id: eventId, role: "user" as const, text: visible };
    const firstMessage = id === "fresh";
    const title = clean.length > 50 ? clean.slice(0, 50) + "…" : clean;
    if (firstMessage) { setFreshMessages([userMessage]); setFreshTitle(title); }
    else append(id, userMessage);
    setInput(""); setGenerating(true); setConnectionError("");
    try {
      if (firstMessage) {
        const created = await conversationsApi.create(title);
        id = created.id;
        locallyCreatedIdsRef.current.add(id);
        skipHistoryOnceRef.current.add(id);
        setConversations(prev => [{ id, title: created.title || title, updatedAt: "الآن", messages: [userMessage], mode: "AI", closed: false }, ...prev.filter(c => c.id !== id)]);
        setActiveId(id);
        setFreshMessages([]);
        setFreshTitle("");
      }
      const currentNadimConversationId = firstMessage ? undefined : active?.nadimConversationId;
      const completed = await nadimWebApi.turn({
        legacyConversationId: id,
        conversationId: currentNadimConversationId,
        message: clean,
        ...(visible !== clean ? { displayMessage: visible } : {}),
        locale: lang === "AR" ? "ar" : "en-US",
        eventId,
        ...(controlCommand ? { controlCommand } : {}),
      });
      if (completed.deleted) {
        setConversations(prev => prev.filter(c => c.id !== id));
        setActiveId("fresh");
        setFreshMessages([]);
        return;
      }
      if (completed.message) append(id, normalizeMessage(completed.message));
      setConversations(prev => prev.map(c => c.id === id ? { ...c, nadimConversationId: completed.conversationId, mode: completed.mode } : c));
      const responseStyle = String(completed.state?.languageStyle?.preferredResponseStyle ?? "");
      if (responseStyle === "EN_US" || responseStyle === "FRANCO_ARABIC") setLang("EN");
      else if (responseStyle.startsWith("AR_")) setLang("AR");
    } catch (error) {
      const failure = { id: uid(), role: "assistant" as const, text: isArabic ? "تعذر الاتصال بالمستشار حالياً. حاول مرة أخرى بعد قليل." : "I couldn’t reach the property service. Please try again shortly." };
      setConnectionError(error instanceof Error ? error.message : "Connection failed");
      if (id === "fresh") setFreshMessages(current => [...current, failure]); else append(id, failure);
    }
    finally { setGenerating(false); }
  }

  async function removeConversation(id: string) {
    if (!window.confirm(isArabic ? "حذف المحادثة وذاكرتها نهائيًا؟" : "Delete this conversation and its memory permanently?")) return;
    try { await conversationsApi.remove(id); setConversations(prev => prev.filter(c => c.id !== id)); if (activeId === id) setActiveId("fresh"); } catch (error) { setConnectionError(error instanceof Error ? error.message : "Delete failed"); }
  }
  function requestHuman() {
    void send(isArabic ? "عايز أكمل مع حد من الفريق" : "I want to continue with a team member", undefined, "REQUEST_HUMAN_HANDOFF");
  }
  function returnToNadim() {
    void send(isArabic ? "رجّع نديم للمحادثة" : "Return Nadim to the conversation", undefined, "RETURN_TO_AI");
  }
  async function renameConversation(id: string, current: string) { const title = window.prompt("Rename conversation", current)?.trim(); if (!title) return; try { await conversationsApi.rename(id, title); setConversations(prev => prev.map(c => c.id === id ? {...c,title} : c)); } catch (error) { setConnectionError(error instanceof Error ? error.message : "Rename failed"); } }
  async function shareConversation() {
    if (!active || actionBusy) return;
    setActionBusy(true); setConnectionError("");
    try {
      const result = await nadimWebApi.conversationAction(active.id, "SHARE");
      if (navigator.share) await navigator.share({ title: active.title, url: result.url });
      else { await navigator.clipboard.writeText(result.url); setConnectionError(isArabic ? "تم نسخ رابط المحادثة" : "Conversation link copied"); }
      setActionMenu(false);
    } catch (error) { setConnectionError(error instanceof Error ? error.message : "Share failed"); }
    finally { setActionBusy(false); }
  }
  async function openWhatsApp() {
    if (!active || actionBusy) return;
    setActionBusy(true); setConnectionError("");
    try { const result = await nadimWebApi.conversationAction(active.id, "WHATSAPP"); window.location.assign(result.url); setActionMenu(false); }
    catch (error) { setConnectionError(error instanceof Error ? error.message : "WhatsApp link failed"); setActionBusy(false); }
  }

  const isArabic = lang === "AR";

  return (
    <main className="cg-chat flex h-[100dvh] overflow-hidden" style={{ background: 'var(--surface-base)' }}>
      <aside className="hidden w-[232px] shrink-0 flex-col border-e bg-white lg:flex" style={{ borderColor: 'var(--border-subtle)' }}>
        <Sidebar conversations={conversations} activeId={activeId} onSelect={setActiveId} onNew={newChat} onDelete={removeConversation} onRename={renameConversation} isArabic={isArabic} />
      </aside>

      {drawer && <div className="fixed inset-0 z-50 lg:hidden"><button className="absolute inset-0 bg-black/20" onClick={() => setDrawer(false)} aria-label="Close navigation"/><aside className="relative flex h-full w-[82%] max-w-[288px] flex-col border-e bg-white shadow-xl" style={{ borderColor: 'var(--border-subtle)' }}><button onClick={() => setDrawer(false)} className="absolute end-2 top-2 grid h-11 w-11 place-items-center rounded-lg hover:bg-[var(--surface-inset)]" aria-label={isArabic ? "إغلاق قائمة المحادثات" : "Close conversations"}><X size={18}/></button><Sidebar conversations={conversations} activeId={activeId} onSelect={id => {setActiveId(id);setDrawer(false)}} onNew={newChat} onDelete={removeConversation} onRename={renameConversation} isArabic={isArabic}/></aside></div>}

      <section className="cg-surface relative flex min-w-0 flex-1 flex-col">
        <header className="z-20 flex h-[52px] shrink-0 items-center justify-between bg-[var(--surface-base)] px-2 sm:px-5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="flex min-w-0 items-center gap-1 sm:gap-3">
            <button onClick={() => setDrawer(true)} className="grid h-11 w-11 place-items-center rounded-lg hover:bg-[var(--surface-inset)] lg:hidden" aria-label="Open conversations"><Menu size={18}/></button>
            <span className="text-[14px] font-extrabold lg:hidden">Cg</span>
            <div className="hidden min-w-0 sm:block"><p className="max-w-[48vw] truncate text-[13px] font-semibold" dir="auto">{(active?.title ?? freshTitle) || (isArabic ? "محادثة جديدة" : "New conversation")}</p></div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 text-[11px] font-medium sm:flex" style={{ color: 'var(--ink-tertiary)' }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--success)' }}/>{isArabic ? "مخزون موثق" : "Verified inventory"}</span>
            <button onClick={() => setLang(lang === "EN" ? "AR" : "EN")} className="btn-ghost grid h-11 min-w-11 place-items-center rounded-lg px-2 text-[11px] font-bold" aria-label={lang === "EN" ? "التبديل إلى العربية" : "Switch to English"}>{lang === "EN" ? "AR" : "EN"}</button>
            {active && active.mode !== "HUMAN" && <button onClick={requestHuman} disabled={generating} className="btn-ghost hidden h-9 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-bold disabled:opacity-50 sm:flex" aria-label={isArabic ? "التحدث مع أحد أعضاء الفريق" : "Talk to a team member"}><MessageSquareText size={14}/>{isArabic ? "تحدث مع الفريق" : "Talk to human"}</button>}
            {active && active.mode !== "HUMAN" && <button onClick={requestHuman} disabled={generating} className="btn-ghost grid h-11 w-11 place-items-center rounded-lg disabled:opacity-50 sm:hidden" aria-label={isArabic ? "التحدث مع أحد أعضاء الفريق" : "Talk to a team member"}><MessageSquareText size={17}/></button>}
            {active && <div className="relative"><button onClick={() => setActionMenu(value => !value)} className="btn-ghost grid h-11 w-11 place-items-center rounded-lg" aria-haspopup="menu" aria-expanded={actionMenu} aria-label={isArabic ? "خيارات المحادثة" : "Conversation actions"}><MoreHorizontal size={18}/></button>{actionMenu && <><button className="fixed inset-0 z-30 cursor-default" onClick={() => setActionMenu(false)} aria-label={isArabic ? "إغلاق القائمة" : "Close menu"}/><div role="menu" className="absolute end-0 top-12 z-40 w-56 overflow-hidden rounded-xl border border-[var(--border-default)] bg-white p-1.5 shadow-lg"><button role="menuitem" disabled={actionBusy} onClick={shareConversation} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-start text-[13px] font-semibold hover:bg-[var(--surface-inset)] disabled:opacity-50"><Share2 size={16}/>{isArabic ? "مشاركة المحادثة" : "Share conversation"}</button><button role="menuitem" disabled={actionBusy} onClick={openWhatsApp} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-start text-[13px] font-semibold hover:bg-[var(--surface-inset)] disabled:opacity-50"><Smartphone size={16}/>{isArabic ? "المتابعة على واتساب" : "Continue on WhatsApp"}</button><button role="menuitem" disabled={actionBusy} onClick={() => { setActionMenu(false); void removeConversation(active.id); }} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-start text-[13px] font-semibold text-[var(--error-text)] hover:bg-[var(--surface-inset)] disabled:opacity-50"><Trash2 size={16}/>{isArabic ? "حذف المحادثة" : "Delete conversation"}</button></div></>}</div>}
            <button onClick={newChat} className="grid h-11 w-11 place-items-center rounded-lg hover:bg-[var(--surface-inset)] lg:hidden" aria-label={isArabic ? "محادثة جديدة" : "New conversation"}><Plus size={17}/></button>
          </div>
        </header>

        <div ref={scrollRef} className="scrollbar-none flex-1 overflow-y-auto">
          {messages.length === 0 ? <Welcome isArabic={isArabic} onSelect={setInput}/> : (
            <div className="mx-auto w-full max-w-[820px] px-4 pb-32 pt-6 sm:px-7 sm:pt-9" role="log" aria-live="polite" aria-atomic="false" aria-label={isArabic ? "سجل المحادثة" : "Conversation log"}>
              {messages.map((m, i) => <MessageView key={m.id} message={m} onAction={send} isLast={i === messages.length - 1} isArabic={isArabic}/>) }
              {generating && <div className="message-rise mb-6 flex gap-2.5"><AssistantAvatar isArabic={isArabic}/><div className="mt-1 flex h-8 items-center gap-2 px-1" role="status" aria-live="polite" aria-atomic="true"><div className="flex gap-1"><span className="typing-dot h-1 w-1 rounded-full"/><span className="typing-dot h-1 w-1 rounded-full"/><span className="typing-dot h-1 w-1 rounded-full"/></div><span className="text-[11px] font-medium" style={{ color: 'var(--ink-tertiary)' }}>{isArabic ? 'نديم بيفكر' : 'Nadim is thinking'}</span></div></div>}
            </div>
          )}
        </div>
        {connectionError && <div className="absolute bottom-[132px] left-1/2 z-30 -translate-x-1/2 rounded-full px-4 py-2 text-[11px] font-semibold text-white" style={{ background: 'var(--error-text)', boxShadow: 'var(--shadow-lg)' }}>{connectionError}</div>}
        {active?.closed ? <ClosedComposer isArabic={isArabic} onNew={newChat}/> : active?.mode === "HUMAN" ? <HumanHandoffComposer isArabic={isArabic} onReturn={returnToNadim} disabled={generating}/> : <Composer input={input} setInput={setInput} send={() => send()} disabled={generating} isArabic={isArabic}/>}
      </section>
    </main>
  );
}

function Sidebar({ conversations, activeId, onSelect, onNew, onDelete, onRename, isArabic }: { conversations: Conversation[]; activeId: string; onSelect: (id:string)=>void; onNew:()=>void; onDelete:(id:string)=>void; onRename:(id:string,title:string)=>void; isArabic:boolean }) {
  const [query,setQuery]=useState("");
  const visible=conversations.filter(c=>!query.trim()||c.title.toLowerCase().includes(query.trim().toLowerCase()));
  return <>
    <div className="px-3 pb-3 pt-3"><div className="flex h-11 items-center justify-between pe-11"><span className="text-[16px] font-black tracking-[-.03em]">Cg</span></div><button onClick={onNew} className="mt-2 flex h-9 w-fit items-center gap-2 rounded-lg px-3 text-[12px] font-bold text-white transition" style={{ background: 'var(--accent)' }} aria-label={isArabic ? "محادثة جديدة" : "New conversation"}><Plus size={14}/> {isArabic ? "محادثة جديدة" : "New conversation"}</button></div>
    <div className="px-3"><div className="relative"><label htmlFor="conversation-search" className="sr-only">{isArabic ? "ابحث في المحادثات" : "Search conversations"}</label><Search className="absolute start-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink-tertiary)' }} size={13} aria-hidden="true"/><input id="conversation-search" value={query} onChange={e=>setQuery(e.target.value)} className="h-9 w-full rounded-lg border border-transparent bg-[var(--surface-inset)] pe-3 ps-9 text-[12px] outline-none focus:border-[var(--border-focus)]" placeholder={isArabic ? "ابحث" : "Search"} aria-label={isArabic ? "ابحث في المحادثات" : "Search conversations"}/></div></div>
    <nav aria-label={isArabic ? "المحادثات" : "Conversations"} className="scrollbar-none mt-3 flex-1 overflow-y-auto px-2"><div className="space-y-0.5" role={visible.length ? "list" : undefined}>{visible.map(c => <button key={c.id} onClick={() => onSelect(c.id)} onDoubleClick={()=>onRename(c.id,c.title)} title="Double-click to rename" className={`${activeId === c.id ? 'conversation-active' : ''} group flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-start transition hover:bg-[var(--surface-inset)]`} style={{ background: activeId === c.id ? 'var(--surface-overlay)' : 'transparent' }} role="listitem" aria-current={activeId === c.id ? 'page' : undefined}><MessageSquareText size={13} style={{ color: activeId === c.id ? 'var(--accent)' : 'var(--ink-tertiary)' }} aria-hidden="true"/><span className="min-w-0 flex-1 truncate text-[12px] font-semibold" dir="auto">{c.title}</span><span onClick={e => {e.stopPropagation();onDelete(c.id)}} className="hidden h-9 w-9 place-items-center rounded-lg group-hover:grid" style={{ color: 'var(--ink-tertiary)' }} role="button" tabIndex={0} aria-label={isArabic ? "حذف المحادثة" : "Delete conversation"}><Trash2 size={13}/></span></button>)}{!visible.length&&<p className="px-3 py-5 text-center text-[12px]" style={{ color: 'var(--ink-tertiary)' }}>{isArabic ? "مفيش محادثات" : "No conversations"}</p>}</div></nav>
  </>;
}

function Welcome({ onSelect, isArabic }: { onSelect:(v:string)=>void; isArabic:boolean }) {
  return <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col px-4 pb-28 pt-[16vh] sm:px-7 sm:pb-32 sm:pt-[20vh]" dir={isArabic ? "rtl" : "ltr"}>
    <h1 className="text-[23px] font-extrabold leading-[1.5] sm:text-[27px]" style={{ color: 'var(--ink-primary)' }}>{isArabic ? "عاوز تدور على إيه؟" : "What are you looking for?"}</h1>
    <div className="mt-4 flex w-full max-w-[600px] flex-wrap gap-2" dir={isArabic?"rtl":"ltr"}>{starters.map(({labelAr,promptAr,labelEn,promptEn}) => { const label = isArabic ? labelAr : labelEn; const prompt = isArabic ? promptAr : promptEn; return <button key={label} type="button" onClick={() => onSelect(prompt)} className="min-h-10 rounded-lg border border-[var(--border-default)] bg-white px-3 text-start text-[12px] font-semibold transition hover:border-[var(--border-focus)] hover:text-[var(--accent)]"><span>{label}</span></button>})}</div>
  </div>;
}

function AssistantAvatar({ isArabic }: { isArabic: boolean }) { return <div className="avatar-assistant grid h-7 min-w-7 shrink-0 place-items-center rounded-lg px-2" aria-label={isArabic ? "نديم" : "Nadim"}><span className="text-[10px] font-black">{isArabic ? "نديم" : "Nadim"}</span></div>; }

function MessageView({ message, onAction, isLast, isArabic }: { message:Message;onAction:ActionSend;isLast:boolean;isArabic:boolean }) {
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
    {assistant && <AssistantAvatar isArabic={isArabic}/>}
    <div className={assistant ? "max-w-[94%] sm:max-w-[86%]" : "max-w-[88%] sm:max-w-[78%]"}>
      <div dir={textDirection(message.text)} className={assistant ? "chat-copy message-assistant pt-0.5 text-start text-[15px] leading-[1.85] sm:text-[16px]" : "chat-copy message-user rounded-[10px] px-3.5 py-2.5 text-start text-[14px] leading-[1.75] sm:text-[15px]"}><RichChatText text={message.text}/></div>
      {!!cards.length && <PropertyResults properties={cards} onAction={onAction} isArabic={isArabic}/>}
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

function PropertyResults({ properties, onAction, isArabic }: {properties:any[];onAction:ActionSend;isArabic:boolean}) {
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

  return <div className="scrollbar-none mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 pe-2">{properties.slice(0,5).map((property)=>{
    const plan = paymentLabel(property);
    return <div key={property.id} className="w-[min(340px,86vw)] shrink-0 snap-start rounded-xl border border-[var(--border-default)] bg-white p-4" dir={isArabic ? "rtl" : "ltr"}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><h3 className="truncate text-[15px] font-bold" dir="auto">{property.project?.name ?? (isArabic ? "مشروع موثق" : "Verified project")}</h3><p className="mt-1 flex items-center gap-1 text-[12px] text-[#6d7873]" dir="auto"><MapPin size={12}/> {property.project?.location?.name ?? (isArabic ? "الموقع غير متاح" : "Location unavailable")}</p></div>
        <span className="shrink-0 rounded-md bg-[#e9f3ee] px-2 py-1 text-[10px] font-bold text-[#2c6a55]">{isArabic ? "موثقة" : "Verified"}</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-y border-[var(--border-subtle)] py-3 text-[12px]">
        <div><span className="block text-[10px] text-[var(--ink-tertiary)]">{isArabic ? "النوع" : "Type"}</span><b className="mt-0.5 block">{property.unitType ?? "—"}</b></div>
        <div><span className="block text-[10px] text-[var(--ink-tertiary)]">{isArabic ? "السعر" : "Price"}</span><b className="mt-0.5 block">{money(property.price,property.currency)}</b></div>
        <div><span className="block text-[10px] text-[var(--ink-tertiary)]">{isArabic ? "المساحة" : "Area"}</span><b className="mt-0.5 block">{property.builtUpArea != null ? `${property.builtUpArea} م²` : "—"}</b></div>
        <div><span className="block text-[10px] text-[var(--ink-tertiary)]">{isArabic ? "السداد" : "Payment"}</span><b className="mt-0.5 block line-clamp-2">{plan ?? "—"}</b></div>
      </div>
      <button onClick={() => { const label = humanPropertyLabel(property, isArabic); onAction(isArabic ? `عاوز تفاصيل الوحدة ${property.externalUnitId}` : `Show details for unit ${property.externalUnitId}`, isArabic ? `تفاصيل ${label}` : `Details for ${label}`); }} className="mt-3 min-h-10 rounded-lg px-2 text-[12px] font-bold text-[var(--accent)] hover:bg-[var(--surface-inset)]">{isArabic ? "تفاصيل الوحدة" : "Unit details"}</button>
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
  return <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-8 sm:px-6" style={{ background: 'linear-gradient(to top, var(--surface-base), var(--surface-base) 64%, transparent)' }}><div className="pointer-events-auto mx-auto flex max-w-[820px] items-center justify-between gap-3 rounded-xl border border-[var(--warning-border)] bg-white p-3"><p className="text-[13px]" style={{ color: 'var(--ink-secondary)' }}>{isArabic?"المحادثة دي انتهت.":"This conversation has ended."}</p><button onClick={onNew} className="btn-primary min-h-10 shrink-0 rounded-lg px-3 text-[12px] font-bold text-white" style={{ background: 'var(--forest)' }}>{isArabic?"محادثة جديدة":"New conversation"}</button></div></div>;
}

function HumanHandoffComposer({isArabic,onReturn,disabled}:{isArabic:boolean;onReturn:()=>void;disabled:boolean}) {
  return <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-8 sm:px-6" style={{ background: 'linear-gradient(to top, var(--surface-base), var(--surface-base) 64%, transparent)' }}><div className="pointer-events-auto mx-auto flex max-w-[820px] items-center justify-between gap-3 rounded-xl border border-[var(--border-default)] bg-white p-3"><div><p className="text-[13px] font-bold" style={{ color: 'var(--ink-primary)' }}>{isArabic?"المحادثة مع الفريق البشري":"A team member owns this conversation"}</p><p className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-tertiary)' }}>{isArabic?"نديم مش هيرد لحد ما ترجّعه للمحادثة.":"Nadim will stay silent until you return control."}</p></div><button disabled={disabled} onClick={onReturn} className="btn-primary min-h-10 shrink-0 rounded-lg px-3 text-[12px] font-bold text-white disabled:opacity-50" style={{ background: 'var(--forest)' }}>{isArabic?"رجّع نديم":"Return Nadim"}</button></div></div>;
}

function Composer({ input, setInput, send, disabled, isArabic }: {input:string;setInput:(v:string)=>void;send:()=>void;disabled:boolean;isArabic:boolean}) {
  return <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-8 sm:px-6" style={{ background: 'linear-gradient(to top, var(--surface-base), var(--surface-base) 68%, transparent)' }}>
    <div className="pointer-events-auto mx-auto max-w-[820px]">
      <div className="input-focus-glow flex items-end gap-1 rounded-xl border border-[var(--border-default)] bg-white px-1.5 py-1 transition shadow-[0_3px_12px_rgba(30,45,40,.05)]">
        <label htmlFor="message-input" className="sr-only">{isArabic ? "اكتب رسالتك" : "Type your message"}</label>
        <textarea id="message-input" dir={input ? textDirection(input) : (isArabic ? "rtl" : "ltr")} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)){e.preventDefault();send();}}} rows={1} placeholder={isArabic ? "اسأل عن وحدة، منطقة، أو ميزانية..." : "Ask about a unit, location, or budget..."} className="scrollbar-none block max-h-32 min-h-11 flex-1 resize-none bg-transparent px-2.5 py-2.5 text-start text-[15px] leading-6 text-[var(--ink-primary)] caret-[var(--accent)] outline-none" aria-label={isArabic ? "اكتب رسالتك" : "Type your message"}/>
        <button disabled={disabled || !input.trim()} onClick={send} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg transition" aria-label={isArabic?"إرسال":"Send"}><span className="grid h-8 w-8 place-items-center rounded-lg text-white" style={{ background: disabled || !input.trim() ? 'var(--border-default)' : 'var(--accent)' }}><ArrowUp size={15}/></span></button>
      </div>
    </div>
  </div>;
}
