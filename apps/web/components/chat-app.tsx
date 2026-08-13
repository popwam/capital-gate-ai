"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp, Building2, Check, ChevronDown, Clock3, FileText,
  Heart, Image as ImageIcon, MapPin, Menu, MessageSquareText,
  MoreHorizontal, Plus, Search, ShieldCheck, Sparkles, Trash2, X
} from "lucide-react";
import { LogoMark } from "./logo";
import { ApiMessage, conversationsApi } from "@/lib/api";
import { textDirection } from "@/lib/text-direction";

type MessageKind = "text" | "properties" | "media" | "documents" | "map" | "lead_prompt" | "lead_created";
type Message = { id: string; role: "user" | "assistant"; text: string; kind?: MessageKind; payload?: any };
type Conversation = { id: string; title: string; updatedAt: string; messages: Message[] };

const starters = [
  { icon: Building2, label: "ابحث عن بيت", prompt: "عاوز شقة في القاهرة الجديدة" },
  { icon: Sparkles, label: "فرص استثمار", prompt: "وريني اختيارات استثمارية في حدود 15 مليون" },
  { icon: MapPin, label: "ابحث بالمنطقة", prompt: "إيه المتاح قريب من العاصمة الإدارية؟" }
];

const uid = () => Math.random().toString(36).slice(2, 10);
const normalizeMessage = (message: ApiMessage): Message => ({ id: message.id, role: message.role === "USER" ? "user" : "assistant", text: message.content, kind: (message.toolPayload?.type as MessageKind) || "text", payload: message.toolPayload });

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
    if (localStorage.getItem("maqar-cache-version") !== "2") { localStorage.removeItem("maqar-conversations"); localStorage.setItem("maqar-cache-version", "2"); }
    const saved = localStorage.getItem("maqar-conversations");
    if (saved) try { setConversations(JSON.parse(saved)); } catch { /* cache is optional */ }
    conversationsApi.list().then(items => { setConversations(items.map(c => ({ id: c.id, title: c.title || "New conversation", updatedAt: new Date(c.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }), messages: [] }))); setConnectionError(""); }).catch(error => setConnectionError(error.message)).finally(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem("maqar-conversations", JSON.stringify(conversations));
  }, [conversations, hydrated]);

  const active = useMemo(() => conversations.find(c => c.id === activeId), [conversations, activeId]);
  const messages = active?.messages ?? [];
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, generating, streamingText]);

  useEffect(() => { if (activeId === "fresh") return; conversationsApi.messages(activeId).then(items => setConversations(prev => prev.map(c => c.id === activeId ? { ...c, messages: items.map(normalizeMessage) } : c))).catch(error => setConnectionError(error.message)); }, [activeId]);

  function newChat() { setActiveId("fresh"); setDrawer(false); setInput(""); }

  function append(id: string, message: Message) {
    setConversations(prev => prev.map(c => c.id === id ? { ...c, updatedAt: "Now", messages: [...c.messages, message] } : c));
  }

  async function send(value = input) {
    const clean = value.trim();
    if (!clean || generating) return;
    let id = activeId;
    try {
      if (id === "fresh") { const title = clean.length > 50 ? clean.slice(0, 50) + "…" : clean; const created = await conversationsApi.create(title); id = created.id; setConversations(prev => [{ id, title: created.title || title, updatedAt: "الآن", messages: [] }, ...prev]); setActiveId(id); }
      append(id, { id: uid(), role: "user", text: clean }); setInput(""); setGenerating(true); setStreamingText(""); setConnectionError("");
      let completed: any;
      await conversationsApi.stream(id, clean, { token: text => setStreamingText(current => current + text), complete: data => { completed = data; } });
      if (completed?.message) append(id, normalizeMessage(completed.message));
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
    <main className="flex h-[100dvh] overflow-hidden bg-[#f7f5f0]">
      <aside className="hidden w-[292px] shrink-0 flex-col border-r border-[#dedfd9] bg-[#efede6] lg:flex">
        <Sidebar conversations={conversations} activeId={activeId} onSelect={setActiveId} onNew={newChat} onDelete={removeConversation} onRename={renameConversation} />
      </aside>

      {drawer && <div className="fixed inset-0 z-50 lg:hidden"><button className="absolute inset-0 bg-black/25 backdrop-blur-[2px]" onClick={() => setDrawer(false)} aria-label="Close navigation"/><aside className="relative flex h-full w-[86%] max-w-[330px] flex-col bg-[#efede6] shadow-2xl"><button onClick={() => setDrawer(false)} className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full hover:bg-black/5"><X size={19}/></button><Sidebar conversations={conversations} activeId={activeId} onSelect={id => {setActiveId(id);setDrawer(false)}} onNew={newChat} onDelete={removeConversation} onRename={renameConversation}/></aside></div>}

      <section className="relative flex min-w-0 flex-1 flex-col bg-[#fbfaf7]">
        <header className="z-20 flex h-[68px] shrink-0 items-center justify-between border-b border-[#e5e4df] bg-[#fbfaf7]/90 px-4 backdrop-blur-xl sm:px-6">
          <div className="flex items-center gap-3">
            <button onClick={() => setDrawer(true)} className="grid h-10 w-10 place-items-center rounded-full border border-[#dedfd9] lg:hidden" aria-label="Open conversations"><Menu size={19}/></button>
            <div className="lg:hidden"><LogoMark compact/></div>
            <div className="hidden sm:block"><p className="text-[14px] font-semibold" dir="auto">{active?.title ?? (isArabic ? "محادثة جديدة" : "New conversation")}</p><p className="mt-0.5 flex items-center gap-1.5 text-[13px] font-medium text-[#79867f]"><span className="h-1.5 w-1.5 rounded-full bg-[#45a67a]"/> مخزون موثق من قاعدة البيانات</p></div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setLang(lang === "EN" ? "AR" : "EN")} className="h-9 rounded-full border border-[#dedfd9] px-3 text-[13px] font-bold tracking-wide hover:bg-white">{lang === "EN" ? "العربية" : "EN"}</button>
            <button onClick={newChat} className="grid h-9 w-9 place-items-center rounded-full bg-forest text-white shadow-sm hover:bg-[#0e332b]" aria-label="New conversation"><Plus size={17}/></button>
          </div>
        </header>

        <div ref={scrollRef} className="scrollbar-none flex-1 overflow-y-auto">
          {messages.length === 0 ? <Welcome isArabic={isArabic} onSelect={send}/> : (
            <div className="mx-auto w-full max-w-[790px] px-4 pb-40 pt-7 sm:px-7 sm:pt-10">
              {messages.map((m, i) => <MessageView key={m.id} message={m} liked={liked} setLiked={setLiked} onAction={send} isLast={i === messages.length - 1}/>) }
              {generating && <div className="message-rise mb-7 flex gap-3"><AssistantAvatar/>{streamingText ? <div className="max-w-[84%] pt-1 text-[16px] leading-[1.8] text-[#27322e] sm:text-[17px]" dir={textDirection(streamingText)}>{streamingText}<span className="ms-1 inline-block h-4 w-0.5 animate-pulse bg-forest"/></div> : <div className="mt-1 flex h-9 items-center gap-1 rounded-2xl rounded-tl-sm bg-[#efede6] px-4"><i className="typing-dot h-1.5 w-1.5 rounded-full bg-[#61706a]"/><i className="typing-dot h-1.5 w-1.5 rounded-full bg-[#61706a]"/><i className="typing-dot h-1.5 w-1.5 rounded-full bg-[#61706a]"/></div>}</div>}
            </div>
          )}
        </div>
        {connectionError && <div className="absolute bottom-[132px] left-1/2 z-30 -translate-x-1/2 rounded-full bg-[#742f25] px-4 py-2 text-[9px] font-semibold text-white shadow-lg">{connectionError}</div>}
        <Composer input={input} setInput={setInput} send={() => send()} disabled={generating} isArabic={isArabic}/>
      </section>
    </main>
  );
}

function Sidebar({ conversations, activeId, onSelect, onNew, onDelete, onRename }: { conversations: Conversation[]; activeId: string; onSelect: (id:string)=>void; onNew:()=>void; onDelete:(id:string)=>void; onRename:(id:string,title:string)=>void }) {
  return <>
    <div className="px-5 pb-5 pt-6"><LogoMark/><button onClick={onNew} className="mt-7 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-forest text-[12px] font-bold text-white shadow-sm transition hover:-translate-y-px hover:bg-[#0e332b]"><Plus size={16}/> New conversation</button></div>
    <div className="px-4"><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8b958f]" size={14}/><input className="h-10 w-full rounded-xl border border-[#dcdcd6] bg-[#f8f6f1] pl-9 pr-3 text-[11px] outline-none focus:border-[#a4b9b0]" placeholder="Search conversations"/></div></div>
    <div className="scrollbar-none mt-6 flex-1 overflow-y-auto px-3"><p className="px-2 text-[9px] font-bold uppercase tracking-[.16em] text-[#89938e]">Recent</p><div className="mt-2 space-y-1">{conversations.map(c => <button key={c.id} onClick={() => onSelect(c.id)} onDoubleClick={()=>onRename(c.id,c.title)} title="Double-click to rename" className={`group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-start transition ${activeId === c.id ? "bg-white shadow-sm" : "hover:bg-white/60"}`}><MessageSquareText size={15} className={activeId === c.id ? "text-coral" : "text-[#81908a]"}/><span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-semibold" dir="auto">{c.title}</span><span className="mt-0.5 block text-[9px] text-[#8a948f]">{c.updatedAt}</span></span><span onClick={e => {e.stopPropagation();onDelete(c.id)}} className="hidden h-7 w-7 place-items-center rounded-lg text-[#85908b] hover:bg-[#f6e3df] hover:text-[#bd553e] group-hover:grid"><Trash2 size={13}/></span></button>)}</div></div>
  </>;
}

function Welcome({ onSelect, isArabic }: { onSelect:(v:string)=>void; isArabic:boolean }) {
  return <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col items-center justify-center px-5 pb-36 pt-14 text-center" dir={isArabic ? "rtl" : "ltr"}>
    <div className="relative mb-7"><div className="absolute -inset-4 rounded-full bg-[#d9e9e0] blur-xl"/><div className="relative grid h-16 w-16 place-items-center rounded-[22px] bg-forest text-white shadow-soft"><svg viewBox="0 0 36 36" className="h-8 w-8" fill="none"><path d="M8 29V15l10-7 10 7v14" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"/><path d="M13 29v-8h10v8M11 13l7 6 7-6" stroke="#f3b79f" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"/></svg></div></div>
    <p className="mb-2 text-[10px] font-bold uppercase tracking-[.2em] text-coral">{isArabic ? "مستشارك العقاري الذكي" : "Your AI property advisor"}</p>
    <h1 className="max-w-[620px] text-[32px] font-semibold leading-[1.12] tracking-[-.045em] sm:text-[46px]">{isArabic ? "إيه مواصفات البيت اللي بتدور عليه؟" : "What kind of place are you looking for?"}</h1>
    <p className="mt-4 max-w-[530px] text-[16px] leading-[1.8] text-[#6d7974] sm:text-[17px]">{isArabic ? "احكيلي بطريقتك — المنطقة، الميزانية، أو حتى مجرد فكرة. هدوّر لك في الوحدات المتاحة فعلاً." : "Tell me in your own words — an area, a budget, or just an idea. I’ll search verified, currently available properties for you."}</p>
    <div className="mt-9 grid w-full gap-2.5 sm:grid-cols-3" dir="ltr">{starters.map(({icon:Icon,label,prompt}) => <button key={label} onClick={() => onSelect(prompt)} className="group flex min-h-[96px] flex-col items-start justify-between rounded-2xl border border-[#dedfd9] bg-white p-4 text-left shadow-[0_4px_15px_rgba(20,40,32,.03)] transition hover:-translate-y-1 hover:border-[#b8c9c1] hover:shadow-soft"><Icon size={18} className="text-coral"/><span className="flex w-full items-end justify-between text-[11px] font-bold">{label}<ArrowUp className="rotate-45 text-[#8a958f] transition group-hover:text-forest" size={15}/></span></button>)}</div>
    <div className="mt-7 flex items-center gap-2 text-[9px] font-semibold text-[#8b958f]"><ShieldCheck size={13}/> Verified inventory · Private by design · No account needed</div>
  </div>;
}

function AssistantAvatar() { return <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-forest text-white"><Sparkles size={14}/></div>; }

function MessageView({ message, liked, setLiked, onAction, isLast }: { message:Message;liked:boolean;setLiked:(v:boolean)=>void;onAction:(v:string)=>void;isLast:boolean }) {
  const assistant = message.role === "assistant";
  const actions = Array.isArray(message.payload?.uiActions) ? message.payload.uiActions : [];
  const cards = actions.find((action:any) => action.type === "PROPERTY_CARDS")?.payload?.properties ?? [];
  const photos = actions.find((action:any) => action.type === "PROJECT_PHOTOS")?.payload?.media ?? [];
  const brochures = actions.find((action:any) => action.type === "PROJECT_BROCHURE")?.payload?.documents ?? [];
  const location = actions.find((action:any) => action.type === "PROJECT_LOCATION")?.payload?.map;
  const distance = actions.find((action:any) => action.type === "DISTANCE_RESULT")?.payload;
  const contact = actions.some((action:any) => action.type === "CONTACT_REQUEST");
  return <div className={`message-rise mb-7 flex gap-3 ${assistant ? "justify-start" : "justify-end"}`}>
    {assistant && <AssistantAvatar/>}
    <div className={assistant ? "max-w-[92%] sm:max-w-[84%]" : "max-w-[84%]"}>
      <div dir={textDirection(message.text)} className={assistant ? "pt-1 text-start text-[16px] leading-[1.8] text-[#27322e] sm:text-[17px]" : "rounded-2xl rounded-tr-sm bg-[#e8e5de] px-4 py-3 text-start text-[16px] leading-[1.75] text-[#26312d] sm:text-[17px]"}>{message.text}</div>
      {!!cards.length && <PropertyResults properties={cards} liked={liked} setLiked={setLiked} onAction={onAction}/>}
      {!!photos.length && <MediaGallery media={photos}/>}
      {!!brochures.length && <Documents documents={brochures}/>}
      {!!location && <MapResult map={location}/>}
      {!!distance && <DistanceResult result={distance}/>}
      {(contact || message.kind === "lead_created") && <LeadHint created={message.kind === "lead_created"}/>}
      {assistant && isLast && <div className="mt-2 flex gap-1"><button className="rounded-lg p-1.5 text-[#8b958f] hover:bg-[#efede7]"><Check size={13}/></button><button className="rounded-lg p-1.5 text-[#8b958f] hover:bg-[#efede7]"><MoreHorizontal size={14}/></button></div>}
    </div>
  </div>;
}

function PropertyResults({ properties, liked, setLiked, onAction }: {properties:any[];liked:boolean;setLiked:(v:boolean)=>void;onAction:(v:string)=>void}) {
  if (!properties.length) return null;
  const money = (value:any, currency="EGP") => value == null ? "Contact sales" : `${currency} ${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value))}`;
  return <div className="mt-4 space-y-3" dir="ltr">{properties.slice(0,3).map((property,index)=><div key={property.id} className="overflow-hidden rounded-[20px] border border-[#dcddd7] bg-white shadow-[0_10px_35px_rgba(29,48,41,.07)]"><div className="p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><div className="mb-2 flex items-center gap-2"><span className="rounded-full bg-[#e2f0e9] px-2.5 py-1 text-[8px] font-extrabold uppercase tracking-[.12em] text-[#287458]">Verified availability</span><span className="text-[9px] text-[#8b958f]">Updated {property.availabilityUpdatedAt ? new Date(property.availabilityUpdatedAt).toLocaleDateString() : "—"}</span></div><h3 className="text-[16px] font-bold tracking-[-.02em]" dir="auto">{property.project?.name ?? "Verified project"}</h3><p className="mt-1 flex items-center gap-1 text-[10px] text-[#76817c]" dir="auto"><MapPin size={11}/> {property.project?.location?.name ?? "Location available on request"}</p></div>{index===0&&<button onClick={() => setLiked(!liked)} className={`grid h-9 w-9 place-items-center rounded-full border ${liked ? "border-[#f0c4ba] bg-[#fbe9e5] text-coral" : "border-[#dedfd9] text-[#7c8983]"}`}><Heart size={15} fill={liked ? "currentColor" : "none"}/></button>}</div><div className="my-4 grid grid-cols-3 divide-x divide-[#e4e4df] rounded-xl bg-[#f7f5f0] py-3"><div className="px-3"><p className="text-[8px] uppercase tracking-wide text-[#89938f]">Price</p><p className="mt-1 text-[11px] font-bold">{money(property.price,property.currency)}</p></div><div className="px-3"><p className="text-[8px] uppercase tracking-wide text-[#89938f]">Layout</p><p className="mt-1 text-[11px] font-bold">{property.bedrooms ?? "—"} bed · {property.builtUpArea ?? "—"}m²</p></div><div className="px-3"><p className="text-[8px] uppercase tracking-wide text-[#89938f]">Delivery</p><p className="mt-1 text-[11px] font-bold">{property.deliveryDate ? new Date(property.deliveryDate).toLocaleDateString(undefined,{year:"numeric",month:"short"}) : "Not provided"}</p></div></div><div className="mt-4 flex flex-wrap gap-2"><button onClick={() => onAction(`Show me photos of ${property.project?.name}`)} className="flex h-9 items-center gap-1.5 rounded-full border border-[#d9dcd6] px-3.5 text-[9px] font-bold hover:bg-[#f7f5f0]"><ImageIcon size={12}/> Photos</button><button onClick={() => onAction(`Show me the location of ${property.project?.name}`)} className="flex h-9 items-center gap-1.5 rounded-full border border-[#d9dcd6] px-3.5 text-[9px] font-bold hover:bg-[#f7f5f0]"><MapPin size={12}/> Location</button><button onClick={() => onAction(`I want to book a viewing for unit ${property.externalUnitId}`)} className="h-9 rounded-full bg-forest px-4 text-[9px] font-bold text-white">Request viewing</button></div></div></div>)}</div>;
}

function MediaGallery({media}:{media:any[]}) { if(!media.length) return <EmptyAttachment label="No approved project images are available yet."/>; return <div className="mt-4 grid grid-cols-2 gap-2 rounded-[20px] border border-[#dcddd7] bg-white p-2" dir="ltr">{media.slice(0,6).map((item,index)=><a key={item.id} href={item.url} target="_blank" rel="noreferrer" className={`${index===0?"col-span-2 aspect-[16/9]":"aspect-square"} relative overflow-hidden rounded-[14px]`}><img src={item.url} alt={item.altText || "Project image"} className="h-full w-full object-cover"/></a>)}</div>; }
function Documents({documents}:{documents:any[]}) { if(!documents.length) return <EmptyAttachment label="No approved brochure is available yet."/>; return <div className="mt-3 space-y-2">{documents.map(item=><a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="flex w-full items-center gap-3 rounded-2xl border border-[#dcddd7] bg-white p-4 text-start shadow-sm" dir="ltr"><div className="grid h-11 w-11 place-items-center rounded-xl bg-[#f7ded7] text-coral"><FileText size={19}/></div><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-bold" dir="auto">{item.name}</p><p className="mt-1 text-[9px] text-[#89938f]">{item.mimeType} · Verified project document</p></div><ArrowUp className="rotate-45 text-[#73817a]" size={16}/></a>)}</div>; }
function MapResult({map}:{map:any}) { if(!map) return <EmptyAttachment label="Verified map coordinates are not available yet."/>; return <a href={map.url} target="_blank" rel="noreferrer" className="mt-3 flex items-center gap-3 rounded-2xl border border-[#dcddd7] bg-white p-4"><div className="grid h-10 w-10 place-items-center rounded-xl bg-[#e2f0e9] text-forest"><MapPin size={18}/></div><div className="flex-1"><p className="text-[10px] font-bold">Open verified project location</p><p className="mt-1 text-[8px] text-[#89938f]">{String(map.latitude)}, {String(map.longitude)}</p></div><ArrowUp className="rotate-45" size={15}/></a>; }
function DistanceResult({result}:{result:any}) { const route=result?.route; if(!route||route.source==="UNAVAILABLE") return null; const km=route.distanceKm ?? (route.routes?.[0]?.distanceMeters != null ? Number(route.routes[0].distanceMeters)/1000 : null); const minutes=route.estimatedMinutes ?? (route.routes?.[0]?.duration ? Math.round(Number.parseFloat(route.routes[0].duration)/60) : null); return <div className="mt-3 flex items-center gap-3 rounded-2xl border border-[#dcddd7] bg-white p-4"><div className="grid h-10 w-10 place-items-center rounded-xl bg-[#e2f0e9] text-forest"><Clock3 size={18}/></div><div><p className="text-[10px] font-bold">{km!=null?`${km.toFixed(1)} km`:"Verified route"}{minutes!=null?` · ${minutes} min`:""}</p><p className="mt-1 text-[8px] text-[#89938f]">{route.source==="ADMIN_VERIFIED"?"Admin-verified distance":"Google Routes"}</p></div></div>; }
function EmptyAttachment({label}:{label:string}) { return <div className="mt-3 rounded-xl border border-dashed border-[#cfd3ce] px-4 py-3 text-[9px] text-[#738079]">{label}</div>; }
function LeadHint({created}:{created:boolean}) { return <div className="mt-3 flex items-center gap-2 rounded-xl bg-[#edf5f1] px-3 py-2 text-[9px] font-semibold text-[#39705b]"><ShieldCheck size={13}/>{created ? "Your request was saved securely. A property advisor can follow up from the lead record." : "Your details are only requested when you ask to proceed and are stored securely."}</div>; }

function Composer({ input, setInput, send, disabled, isArabic }: {input:string;setInput:(v:string)=>void;send:()=>void;disabled:boolean;isArabic:boolean}) {
  return <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-[#fbfaf7] via-[#fbfaf7] to-transparent px-3 pb-[max(14px,env(safe-area-inset-bottom))] pt-9 sm:px-6">
    <div className="pointer-events-auto mx-auto max-w-[790px]"><div className="rounded-[22px] border border-[#d9dcd6] bg-white p-2 shadow-[0_14px_50px_rgba(28,45,39,.12)] transition focus-within:border-[#9bb3a9]"><textarea dir={input ? textDirection(input) : (isArabic ? "rtl" : "ltr")} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}} rows={1} placeholder={isArabic ? "اسألني عن أي عقار..." : "Ask about any property..."} className="scrollbar-none block max-h-28 min-h-[50px] w-full resize-none bg-transparent px-3 py-3 text-start text-[16px] leading-[1.75] outline-none placeholder:text-[#9ba39f]"/><div className="flex items-center justify-between px-1 pb-1"><span className="hidden text-[13px] font-medium text-[#8c9691] sm:inline">Shift + Enter لسطر جديد</span><button disabled={disabled || !input.trim()} onClick={send} className="grid h-10 w-10 place-items-center rounded-full bg-forest text-white transition enabled:hover:scale-105 disabled:bg-[#d5dad7]" aria-label="إرسال"><ArrowUp size={18}/></button></div></div><p className="mt-2 text-center text-[13px] text-[#7e8984]">مقار يعرض بيانات المخزون الموثقة فقط، مع تاريخ آخر تحديث للإتاحة.</p></div>
  </div>;
}

