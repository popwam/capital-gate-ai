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
  { icon: Building2, label: "بدور على بيت", prompt: "عاوز شقة في القاهرة الجديدة" },
  { icon: Sparkles, label: "بفكر في استثمار", prompt: "وريني اختيارات استثمارية في حدود 15 مليون" },
  { icon: MapPin, label: "المكان أهم حاجة", prompt: "إيه المتاح قريب من العاصمة الإدارية؟" }
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
    conversationsApi.list().then(items => { setConversations(items.map(c => ({ id: c.id, title: c.title || "New conversation", updatedAt: new Date(c.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }), messages: [] }))); setConnectionError(""); }).catch(error => setConnectionError(error.message)).finally(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem("cgai-conversations", JSON.stringify(conversations));
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
    <main className="flex h-[100dvh] overflow-hidden bg-[#f0eee8]">
      <aside className="hidden w-[292px] shrink-0 flex-col border-r border-[#dde1dc] bg-[#efeee8] lg:flex">
        <Sidebar conversations={conversations} activeId={activeId} onSelect={setActiveId} onNew={newChat} onDelete={removeConversation} onRename={renameConversation} />
      </aside>

      {drawer && <div className="fixed inset-0 z-50 lg:hidden"><button className="absolute inset-0 bg-black/25 backdrop-blur-[2px]" onClick={() => setDrawer(false)} aria-label="Close navigation"/><aside className="relative flex h-full w-[86%] max-w-[330px] flex-col bg-[#efede6] shadow-2xl"><button onClick={() => setDrawer(false)} className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full hover:bg-black/5"><X size={19}/></button><Sidebar conversations={conversations} activeId={activeId} onSelect={id => {setActiveId(id);setDrawer(false)}} onNew={newChat} onDelete={removeConversation} onRename={renameConversation}/></aside></div>}

      <section className="cg-surface relative flex min-w-0 flex-1 flex-col">
        <header className="z-20 flex h-[68px] shrink-0 items-center justify-between border-b border-[#e3e5e0] bg-[#faf9f5]/82 px-4 backdrop-blur-xl sm:px-6">
          <div className="flex items-center gap-3">
            <button onClick={() => setDrawer(true)} className="grid h-10 w-10 place-items-center rounded-full border border-[#dedfd9] lg:hidden" aria-label="Open conversations"><Menu size={19}/></button>
            <div className="lg:hidden"><LogoMark compact/></div>
            <div className="hidden sm:block"><p className="text-[14px] font-semibold" dir="auto">{active?.title ?? (isArabic ? "محادثة جديدة" : "New conversation")}</p><p className="mt-0.5 flex items-center gap-1.5 text-[13px] font-medium text-[#79867f]"><span className="h-1.5 w-1.5 rounded-full bg-[#45a67a]"/> Cg verified inventory</p></div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setLang(lang === "EN" ? "AR" : "EN")} className="h-9 rounded-full border border-[#dedfd9] px-3 text-[13px] font-bold tracking-wide hover:bg-white">{lang === "EN" ? "العربية" : "EN"}</button>
            <button onClick={newChat} className="grid h-9 w-9 place-items-center rounded-full bg-forest text-white shadow-sm hover:bg-[#102f2c]" aria-label="New conversation"><Plus size={17}/></button>
          </div>
        </header>

        <div ref={scrollRef} className="scrollbar-none flex-1 overflow-y-auto">
          {messages.length === 0 ? <Welcome isArabic={isArabic} onSelect={setInput}/> : (
            <div className="mx-auto w-full max-w-[860px] px-4 pb-44 pt-7 sm:px-8 sm:pt-10">
              {messages.map((m, i) => <MessageView key={m.id} message={m} liked={liked} setLiked={setLiked} onAction={send} isLast={i === messages.length - 1} isArabic={isArabic}/>) }
              {generating && <div className="message-rise mb-7 flex gap-3"><AssistantAvatar/>{streamingText ? <div className="chat-copy max-w-[92%] pt-0.5 text-[17px] leading-[1.9] tracking-[.005em] text-[#27322e] sm:max-w-[86%] sm:text-[18px]" dir={textDirection(streamingText)}>{streamingText}<span className="ms-1 inline-block h-4 w-0.5 animate-pulse bg-forest"/></div> : <div className="mt-1 flex h-9 items-center gap-1 rounded-2xl rounded-tl-sm bg-[#efede6] px-4"><i className="typing-dot h-1.5 w-1.5 rounded-full bg-[#61706a]"/><i className="typing-dot h-1.5 w-1.5 rounded-full bg-[#61706a]"/><i className="typing-dot h-1.5 w-1.5 rounded-full bg-[#61706a]"/></div>}</div>}
            </div>
          )}
        </div>
        {connectionError && <div className="absolute bottom-[132px] left-1/2 z-30 -translate-x-1/2 rounded-full bg-[#742f25] px-4 py-2 text-[11px] font-semibold text-white shadow-lg">{connectionError}</div>}
        <Composer input={input} setInput={setInput} send={() => send()} disabled={generating} isArabic={isArabic}/>
      </section>
    </main>
  );
}

function Sidebar({ conversations, activeId, onSelect, onNew, onDelete, onRename }: { conversations: Conversation[]; activeId: string; onSelect: (id:string)=>void; onNew:()=>void; onDelete:(id:string)=>void; onRename:(id:string,title:string)=>void }) {
  const [query,setQuery]=useState("");
  const visible=conversations.filter(c=>!query.trim()||c.title.toLowerCase().includes(query.trim().toLowerCase()));
  return <>
    <div className="px-5 pb-5 pt-6"><LogoMark/><button onClick={onNew} className="mt-7 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-forest text-[13px] font-bold text-white shadow-sm transition hover:-translate-y-px hover:bg-[#102f2c]"><Plus size={16}/> محادثة جديدة</button></div>
    <div className="px-4"><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8b958f]" size={14}/><input value={query} onChange={e=>setQuery(e.target.value)} className="h-11 w-full rounded-xl border border-[#dcdcd6] bg-[#f8f6f1] pl-9 pr-3 text-[13px] outline-none focus:border-[#8fa9a0]" placeholder="ابحث في المحادثات"/></div></div>
    <div className="scrollbar-none mt-6 flex-1 overflow-y-auto px-3"><p className="px-2 text-[12px] font-bold uppercase tracking-[.16em] text-[#89938e]">الأخيرة</p><div className="mt-2 space-y-1">{visible.map(c => <button key={c.id} onClick={() => onSelect(c.id)} onDoubleClick={()=>onRename(c.id,c.title)} title="Double-click to rename" className={`group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-start transition ${activeId === c.id ? "bg-white shadow-sm" : "hover:bg-white/60"}`}><MessageSquareText size={15} className={activeId === c.id ? "text-coral" : "text-[#81908a]"}/><span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold" dir="auto">{c.title}</span><span className="mt-0.5 block text-[11px] text-[#8a948f]">{c.updatedAt}</span></span><span onClick={e => {e.stopPropagation();onDelete(c.id)}} className="hidden h-8 w-8 place-items-center rounded-lg text-[#85908b] hover:bg-[#f4ece1] hover:text-[#8f632c] group-hover:grid"><Trash2 size={13}/></span></button>)}{!visible.length&&<p className="px-3 py-5 text-center text-[12px] text-[#8a948f]">مفيش محادثات مطابقة</p>}</div></div>
  </>;
}

function Welcome({ onSelect, isArabic }: { onSelect:(v:string)=>void; isArabic:boolean }) {
  return <div className="mx-auto flex min-h-full w-full max-w-[820px] flex-col justify-center px-4 pb-40 pt-8 sm:px-7 sm:pb-44" dir={isArabic ? "rtl" : "ltr"}>
    <div className="mx-auto w-full max-w-[680px] text-center">
      <div className="mx-auto mb-7 w-fit"><LogoMark/></div>
      <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#dce2dd] bg-white/75 px-3 py-1.5 text-[11px] font-bold text-[#60726b] shadow-sm"><span className="h-1.5 w-1.5 rounded-full bg-[#4f9376]"/>{isArabic?"بيفهم سؤالك قبل ما يدور":"Understands first, searches second"}</div>
      <h1 className="text-balance text-[32px] font-black leading-[1.28] tracking-[-.045em] text-[#142927] sm:text-[48px]">{isArabic ? "مش شات عقارات تقليدي." : "Not another property chatbot."}</h1>
      <p className="mx-auto mt-4 max-w-[590px] text-[16px] leading-8 text-[#66736d] sm:text-[17px]">{isArabic ? "اكتب اللي في دماغك بطريقتك. Cg Ai يربط كلامك بالمخزون الموثق، ويشرحلك الفرق بدل ما يرمي قدامك ليستة وحدات." : "Ask naturally. Cg Ai connects your intent to verified inventory and explains the trade-offs instead of dumping listings."}</p>
    </div>
    <div className="mx-auto mt-8 grid w-full max-w-[700px] gap-2.5 sm:grid-cols-3" dir={isArabic?"rtl":"ltr"}>{starters.map(({icon:Icon,label,prompt}) => <button key={label} type="button" onClick={() => onSelect(prompt)} className="group flex min-h-[106px] min-w-0 flex-col items-start justify-between rounded-[20px] border border-[#dfe3de] bg-white/82 p-4 text-start shadow-[0_10px_30px_rgba(20,41,39,.045)] transition active:scale-[.99] sm:hover:-translate-y-1 sm:hover:border-[#aebeb7] sm:hover:shadow-soft"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#edf2ef] text-[#315f55]"><Icon size={17}/></span><span className="flex w-full min-w-0 items-end justify-between gap-2 text-[13px] font-bold"><span className="truncate">{label}</span><span className="text-[12px] font-semibold text-[#9a855d]">{isArabic?"اكتبها":"Draft"}</span></span></button>)}</div>
    <p className="mx-auto mt-4 max-w-[680px] text-center text-[12px] leading-6 text-[#84908a]">{isArabic?"الاقتراحات بتتكتب في خانة السؤال فقط — راجعها وكملها وبعدين اضغط إرسال.":"Suggestions only fill the composer. Edit or continue them before you send."}</p>
  </div>;
}

function AssistantAvatar() { return <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[11px] bg-[#142927] text-[#e2c58e] shadow-sm"><span className="text-[11px] font-black tracking-[-.08em]">Cg</span></div>; }

function MessageView({ message, liked, setLiked, onAction, isLast, isArabic }: { message:Message;liked:boolean;setLiked:(v:boolean)=>void;onAction:(v:string)=>void;isLast:boolean;isArabic:boolean }) {
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
    <div className={assistant ? "max-w-[94%] sm:max-w-[86%]" : "max-w-[88%] sm:max-w-[78%]"}>
      <div dir={textDirection(message.text)} className={assistant ? "chat-copy pt-0.5 text-start text-[17px] leading-[1.9] tracking-[.005em] text-[#27322e] sm:text-[18px]" : "chat-copy rounded-[20px] rounded-tr-md bg-[#ebe8e1] px-4 py-3 text-start text-[17px] leading-[1.85] text-[#26312d] sm:text-[18px]"}>{message.text}</div>
      {!!cards.length && <PropertyResults properties={cards} liked={liked} setLiked={setLiked} onAction={onAction} isArabic={isArabic}/>}
      {!!photos.length && <MediaGallery media={photos}/>}
      {!!brochures.length && <Documents documents={brochures}/>}
      {!!location && <MapResult map={location}/>}
      {!!distance && <DistanceResult result={distance}/>}
      {(contact || message.kind === "lead_created") && <LeadHint created={message.kind === "lead_created"}/>}
      {assistant && isLast && <div className="mt-2 flex gap-1"><button className="rounded-lg p-1.5 text-[#8b958f] hover:bg-[#efede7]"><Check size={13}/></button><button className="rounded-lg p-1.5 text-[#8b958f] hover:bg-[#efede7]"><MoreHorizontal size={14}/></button></div>}
    </div>
  </div>;
}

function PropertyResults({ properties, liked, setLiked, onAction, isArabic }: {properties:any[];liked:boolean;setLiked:(v:boolean)=>void;onAction:(v:string)=>void;isArabic:boolean}) {
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

  return <div className="mt-4 space-y-3">{properties.slice(0,5).map((property,index)=>{
    const image = property.media?.[0]?.url;
    const plan = paymentLabel(property);
    return <div key={property.id} className="overflow-hidden rounded-[22px] border border-[#dcddd7] bg-white shadow-[0_10px_35px_rgba(29,48,41,.07)]" dir={isArabic ? "rtl" : "ltr"}>
      {image && <div className="aspect-[16/8] w-full overflow-hidden bg-[#f1efe9]"><img src={image} alt={property.media?.[0]?.altText || property.project?.name || "Unit"} className="h-full w-full object-cover"/></div>}
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
          <button onClick={() => onAction(isArabic ? `وريني صور الوحدة ${property.externalUnitId}` : `Show me photos of unit ${property.externalUnitId}`)} className="flex h-10 items-center gap-1.5 rounded-full border border-[#d9dcd6] px-4 text-[12px] font-bold hover:bg-[#f7f5f0]"><ImageIcon size={14}/> {isArabic ? "صور الوحدة" : "Unit photos"}</button>
          <button onClick={() => onAction(isArabic ? `نظام السداد للوحدة ${property.externalUnitId}` : `Payment plan for unit ${property.externalUnitId}`)} className="flex h-10 items-center gap-1.5 rounded-full border border-[#d9dcd6] px-4 text-[12px] font-bold hover:bg-[#f7f5f0]"><FileText size={14}/> {isArabic ? "نظام السداد" : "Payment plan"}</button>
          <button onClick={() => onAction(isArabic ? `وريني موقع مشروع ${property.project?.name}` : `Show me the location of ${property.project?.name}`)} className="flex h-10 items-center gap-1.5 rounded-full border border-[#d9dcd6] px-4 text-[12px] font-bold hover:bg-[#f7f5f0]"><MapPin size={14}/> {isArabic ? "الموقع" : "Location"}</button>
          <button onClick={() => onAction(isArabic ? `عاوز أعاين الوحدة ${property.externalUnitId}` : `I want to book a viewing for unit ${property.externalUnitId}`)} className="h-10 rounded-full bg-forest px-4 text-[12px] font-bold text-white">{isArabic ? "طلب معاينة" : "Request viewing"}</button>
        </div>
      </div>
    </div>;
  })}</div>;
}

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
function LeadHint({created}:{created:boolean}) { return <div className="mt-3 flex items-center gap-2 rounded-xl bg-[#edf5f1] px-3 py-2 text-[11px] font-semibold text-[#39705b]"><ShieldCheck size={13}/>{created ? "Your request was saved securely. A property advisor can follow up from the lead record." : "Your details are only requested when you ask to proceed and are stored securely."}</div>; }

function Composer({ input, setInput, send, disabled, isArabic }: {input:string;setInput:(v:string)=>void;send:()=>void;disabled:boolean;isArabic:boolean}) {
  return <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-[#faf9f5] via-[#faf9f5]/96 to-transparent px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-10 sm:px-6">
    <div className="pointer-events-auto mx-auto max-w-[860px]">
      <div className="rounded-[24px] border border-[#d8ddd8] bg-white/96 p-2 shadow-[0_18px_60px_rgba(20,41,39,.13)] transition focus-within:border-[#8ea9a0] focus-within:shadow-[0_22px_70px_rgba(20,41,39,.16)]">
        <textarea autoFocus dir={input ? textDirection(input) : (isArabic ? "rtl" : "ltr")} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)){e.preventDefault();send();}}} rows={1} placeholder={isArabic ? "اكتب سؤالك وكمله براحتك..." : "Write your question — take your time..."} className="scrollbar-none block max-h-32 min-h-[54px] w-full resize-none bg-transparent px-3 py-3 text-start text-[16px] leading-[1.75] outline-none placeholder:text-[#9ba39f]"/>
        <div className="flex items-center justify-between gap-3 px-1 pb-1"><span className="min-w-0 truncate ps-2 text-[11px] font-medium text-[#89948f]">{isArabic?"Enter لسطر جديد · Ctrl/⌘ + Enter للإرسال":"Enter for a new line · Ctrl/⌘ + Enter to send"}</span><button disabled={disabled || !input.trim()} onClick={send} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#173f3b] text-white transition enabled:hover:scale-105 disabled:bg-[#d5dad7]" aria-label={isArabic?"إرسال":"Send"}><ArrowUp size={18}/></button></div>
      </div>
      <p className="mt-2 text-center text-[11px] text-[#7e8984]">{isArabic ? "Cg Ai يجاوب من البيانات الموثقة المتاحة في المنصة." : "Cg Ai answers from verified platform data."}</p>
    </div>
  </div>;
}

