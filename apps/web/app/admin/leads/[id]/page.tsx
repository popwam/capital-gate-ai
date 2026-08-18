"use client";
import { FormEvent, useEffect, useState } from "react";
import {
  ArrowLeft,
  CalendarClock,
  MessageSquareText,
  NotebookPen,
  Phone,
  UserRound,
  AlertTriangle,
  ShieldCheck,
} from "lucide-react";
import { adminApi } from "@/lib/api";
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
type Lead = any;
type Admin = { id: string; name: string; email: string };
const fmt = (v?: string | null) =>
  v
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(v))
    : "—";
export default function LeadDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [id, setId] = useState("");
  const [lead, setLead] = useState<Lead>();
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    params.then((x) => setId(x.id));
    adminApi.get<Admin[]>("/leads/options/admins").then(setAdmins);
  }, [params]);
  const load = () =>
    id &&
    adminApi
      .get<Lead>(`/leads/${id}`)
      .then(setLead)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, [id]);
  async function update(body: any) {
    try {
      await adminApi.patch(`/leads/${id}`, body);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }
  async function reviewTrust(disposition: "ADMIN_CONFIRMED_REAL" | "ADMIN_CONFIRMED_FAKE" | "RESOLVED") {
    const alert = lead?.trustAlerts?.find((item:any)=>item.status==="OPEN");
    if (!alert) return;
    try {
      await adminApi.patch(`/leads/trust-alerts/${alert.id}`, { disposition });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Trust review failed");
    }
  }
  async function addNote(e: FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    await adminApi.post(`/leads/${id}/notes`, { content: note });
    setNote("");
    await load();
  }
  if (!lead)
    return (
      <main className="grid min-h-screen place-items-center bg-[#f6f5f1] text-[10px]">
        {error || "Loading lead…"}
      </main>
    );
  const s = lead.summary || {};
  return (
    <main className="mx-auto max-w-[1480px] p-4 sm:p-6 lg:p-8" dir="rtl">
      <div className="mx-auto max-w-6xl p-4 sm:p-7">
        {error && (
          <div className="mb-4 rounded-xl bg-[#fbe9e5] p-3 text-[9px]">
            {error}
          </div>
        )}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[.15em] text-coral">
              Lead details
            </p>
            <h1 className="mt-2 text-[27px] font-bold tracking-[-.04em]" dir="auto">
              {lead.name}
            </h1>
            <p className="mt-1 flex items-center gap-2 text-[10px] text-[#6e7a75]">
              <Phone size={12} />
              {lead.phone} · {lead.intentScore} / 100 · {trustLabel(lead.trustStatus)}
            </p>
          </div>
          <a
            href={`/admin/conversations/${lead.conversation.id}`}
            className="flex h-10 items-center gap-2 rounded-xl bg-forest px-4 text-[9px] font-bold text-white"
          >
            <MessageSquareText size={14} /> View conversation
          </a>
        </div>
        <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_340px]">
          <div className="space-y-5">
            <Section title="Customer" icon={<UserRound size={15} />}>
              <Grid
                values={[
                  ["Name", lead.name],
                  ["Phone", lead.phone],
                  ["Created", fmt(lead.createdAt)],
                  ["Last activity", fmt(lead.updatedAt)],
                ]}
              />
            </Section>
            <Section title="التواصل والثقة" icon={<ShieldCheck size={15} />}>
              <Grid values={[
                ["حالة البيانات", trustLabel(lead.trustStatus)],
                ["درجة الثقة", `${lead.trustScore ?? 0} / 100`],
                ["التواصل المفضل", channelLabel(lead.preferredContactChannel)],
                ["تأكيد الموعد", channelLabel(lead.preferredConfirmationChannel)],
                ["وقت المعاينة", visitLabel(lead.preferredVisitDayPart, lead.preferredVisitTiming)],
                ["تم فحص صيغة التواصل", lead.contactValidatedAt ? fmt(lead.contactValidatedAt) : "—"],
              ]}/>
              {lead.trustReasons?.length>0&&<div className="mt-3 flex flex-wrap gap-2">{lead.trustReasons.map((reason:string)=><span key={reason} className="rounded-full bg-[#fff3df] px-2.5 py-1 text-[10px] font-bold text-[#8a642d]">{reasonLabel(reason)}</span>)}</div>}
              {lead.trustAlerts?.some((item:any)=>item.status==="OPEN")&&<div className="mt-4 rounded-2xl border border-[#ead8b9] bg-[#fffaf0] p-4"><div className="flex items-center gap-2 text-[#8b6225]"><AlertTriangle size={15}/><b>مراجعة بشرية مطلوبة</b></div><p className="mt-2 text-[11px] leading-6 text-[#766b59]">Cg رصد إشارات تستحق التحقق فقط؛ ما تمش تصنيف العميل Fake تلقائيًا.</p><div className="mt-3 flex flex-wrap gap-2"><button onClick={()=>reviewTrust("ADMIN_CONFIRMED_REAL")} className="rounded-xl bg-[#e5f3eb] px-3 py-2 text-[11px] font-bold text-[#2f6d52]">عميل حقيقي</button><button onClick={()=>reviewTrust("RESOLVED")} className="rounded-xl border bg-white px-3 py-2 text-[11px] font-bold">تمت المراجعة</button><button onClick={()=>reviewTrust("ADMIN_CONFIRMED_FAKE")} className="rounded-xl bg-red-50 px-3 py-2 text-[11px] font-bold text-red-700">Fake / Spam مؤكد</button></div></div>}
            </Section>
            <Section title="Interest">
              <Grid
                values={[
                  ["Intent", lead.intent],
                  ["Intent score", `${lead.intentScore} / 100`],
                  ["Budget", budget(s.budget)],
                  ["Preferred locations", s.preferredAreas?.join(", ") || "—"],
                  ["Property type", s.propertyTypes?.join(", ") || "—"],
                  ["Bedrooms", s.bedrooms ?? "—"],
                  [
                    "Delivery preference",
                    s.deliveryMaxYears
                      ? `Within ${s.deliveryMaxYears} years`
                      : "—",
                  ],
                  [
                    "Payment preference",
                    s.maxDownPayment
                      ? `Maximum down payment ${Number(s.maxDownPayment).toLocaleString()}`
                      : "—",
                  ],
                  ["Purpose", s.purpose || "—"],
                ]}
              />
            </Section>
            <Section title="Interested inventory">
              <div className="space-y-2">
                {lead.interestedInventory.units.map((u: any) => (
                  <div key={u.id} className="rounded-xl border p-3 text-[9px]">
                    <div className="flex justify-between gap-3" dir="auto">
                      <div>
                        <b>{u.externalUnitId}</b>
                        <p className="mt-1 text-[8px] leading-4 text-[#75817c]">
                          {u.project.nameAr || u.project.nameEn || u.project.name}
                          {u.project.developer ? ` · ${u.project.developer.nameAr || u.project.developer.nameEn || u.project.developer.brandName || u.project.developer.name}` : ""}
                          {u.unitType ? ` · ${u.unitType}` : ""}
                          {u.bedrooms != null ? ` · ${u.bedrooms} bedrooms` : ""}
                          {u.bathrooms != null ? ` / ${u.bathrooms} baths` : ""}
                          {u.builtUpArea != null ? ` · ${Number(u.builtUpArea)} m²` : ""}
                        </p>
                        {(u.phaseRef || u.project.location || u.project.formattedAddress) && <p className="mt-1 text-[8px] text-[#8a948f]">
                          {u.phaseRef ? `Phase: ${u.phaseRef.nameAr || u.phaseRef.nameEn || u.phaseRef.name}` : ""}
                          {u.phaseRef && (u.project.location || u.project.formattedAddress) ? " · " : ""}
                          {u.project.location?.nameAr || u.project.location?.nameEn || u.project.location?.name || u.project.formattedAddress || ""}
                        </p>}
                      </div>
                      <div className="text-right">
                        <b>
                          {u.price
                            ? `${Number(u.price).toLocaleString()} ${u.currency || ""}`
                            : "Price unavailable"}
                        </b>
                        <p className="mt-1 text-[7px]">{u.status}</p>
                      </div>
                    </div>
                  </div>
                ))}
                {lead.interestedInventory.projects
                  .filter(
                    (p: any) =>
                      !lead.interestedInventory.units.some(
                        (u: any) => u.project.id === p.id,
                      ),
                  )
                  .map((p: any) => (
                    <a
                      key={p.id}
                      href={`/admin/projects/${p.id}/knowledge`}
                      className="block rounded-xl border p-3 text-[9px] font-bold"
                    >
                      {p.name}
                      <span className="ml-2 font-normal text-[#75817c]">
                        {p.developer.name}
                      </span>
                    </a>
                  ))}
                {!lead.interestedInventory.units.length &&
                  !lead.interestedInventory.projects.length && (
                    <p className="text-[9px] text-[#78837e]">
                      No specific inventory was associated.
                    </p>
                  )}
              </div>
            </Section>
            <Section title="Conversation summary">
              <pre className="whitespace-pre-wrap font-sans text-[9px] leading-5 text-[#596761]">
                {summaryText(s.conversationSummary)}
              </pre>
            </Section>
          </div>
          <aside className="space-y-4">
            <Section title="Manage lead" icon={<CalendarClock size={15} />}>
              <label className="text-[8px] font-bold">
                Status
                <select
                  value={lead.status}
                  onChange={(e) => update({ status: e.target.value })}
                  className="mt-1 h-10 w-full rounded-xl border px-3 text-[9px] font-normal"
                >
                  {statuses.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label className="mt-3 block text-[8px] font-bold">
                Assigned to
                <select
                  value={lead.assignedTo?.id || ""}
                  onChange={(e) =>
                    update({ assignedToAdminId: e.target.value })
                  }
                  className="mt-1 h-10 w-full rounded-xl border px-3 text-[9px] font-normal"
                >
                  <option value="">Unassigned</option>
                  {admins.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-3 block text-[8px] font-bold">
                Follow up
                <input
                  type="datetime-local"
                  value={
                    lead.followUpAt
                      ? new Date(lead.followUpAt).toISOString().slice(0, 16)
                      : ""
                  }
                  onChange={(e) =>
                    update({
                      followUpAt: e.target.value
                        ? new Date(e.target.value).toISOString()
                        : "",
                    })
                  }
                  className="mt-1 h-10 w-full rounded-xl border px-3 text-[9px] font-normal"
                />
              </label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    const d = new Date();
                    d.setDate(d.getDate() + 1);
                    update({ followUpAt: d.toISOString() });
                  }}
                  className="rounded-xl border py-2 text-[8px] font-bold"
                >
                  Tomorrow
                </button>
                <button
                  onClick={() => {
                    const d = new Date();
                    d.setDate(d.getDate() + 7);
                    update({ followUpAt: d.toISOString() });
                  }}
                  className="rounded-xl border py-2 text-[8px] font-bold"
                >
                  Next week
                </button>
              </div>
            </Section>
            <Section title="Internal notes" icon={<NotebookPen size={15} />}>
              <form onSubmit={addNote}>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={2000}
                  placeholder="Add a private Admin note"
                  className="h-24 w-full resize-none rounded-xl border p-3 text-[9px]"
                />
                <button className="mt-2 h-9 w-full rounded-xl bg-forest text-[8px] font-bold text-white">
                  Add note
                </button>
              </form>
              <div className="mt-4 space-y-3">
                {lead.notes.map((n: any) => (
                  <div key={n.id} className="border-t pt-3">
                    <p className="text-[9px] leading-4" dir="auto">{n.content}</p>
                    <p className="mt-1 text-[7px] text-[#89938e]">
                      {n.admin.name} · {fmt(n.createdAt)}
                    </p>
                  </div>
                ))}
              </div>
            </Section>
            <Section title="Timeline">
              <div className="space-y-3">
                {lead.events.map((e: any) => (
                  <div key={e.id} className="flex gap-2">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-coral" />
                    <div>
                      <p className="text-[8px] font-bold">
                        {e.type.replaceAll("_", " ")}
                      </p>
                      <p className="mt-0.5 text-[7px] text-[#89938e]">
                        {e.admin?.name ? `${e.admin.name} · ` : ""}
                        {fmt(e.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          </aside>
        </div>
      </div>
    </main>
  );
}
function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[20px] border bg-white p-5">
      <h2 className="flex items-center gap-2 text-[11px] font-bold">
        {icon}
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}
function Grid({ values }: { values: [string, any][] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {values.map(([k, v]) => (
        <div key={k}>
          <p className="text-[7px] font-bold uppercase text-[#909a95]">{k}</p>
          <p className="mt-1 text-[9px] font-semibold" dir="auto">{String(v)}</p>
        </div>
      ))}
    </div>
  );
}
function budget(v: any) {
  if (!v) return "—";
  return `${v.min ? Number(v.min).toLocaleString() : ""}${v.min && v.max ? " – " : ""}${v.max ? Number(v.max).toLocaleString() : ""} ${v.currency || ""}`;
}
function summaryText(v: any) {
  if (!v || typeof v !== "object") return "No structured summary available.";
  const labels: Record<string, string> = {
    customerGoal: "Goal",
    budget: "Budget",
    preferredLocations: "Preferred locations",
    propertyTypes: "Property types",
    bedrooms: "Bedrooms",
    bathrooms: "Bathrooms",
    preferredPhase: "Preferred phase",
    preferredBuilding: "Preferred building",
    preferredPaymentDurationMonths: "Payment duration",
    maxDownPayment: "Max down payment",
    hardRequirements: "Must have",
    softPreferences: "Preferences",
    intentScore: "Intent score",
    selectedUnitCode: "Selected unit",
    preferredContactChannel: "Contact channel",
    preferredConfirmationChannel: "Confirmation channel",
    preferredVisitDayPart: "Visit day part",
    preferredVisitTiming: "Visit timing",
  };
  const format = (key: string, value: any) => {
    if (key === "budget" && value && typeof value === "object") return budget(value);
    if (key === "preferredPaymentDurationMonths" && Number.isFinite(Number(value))) return `${value} months`;
    if (key === "maxDownPayment" && Number.isFinite(Number(value))) return Number(value).toLocaleString();
    if (Array.isArray(value)) return value.join("، ");
    if (value && typeof value === "object") return Object.entries(value).filter(([, item]) => item != null).map(([subKey, item]) => `${subKey}: ${String(item)}`).join(" · ");
    return String(value);
  };
  const rows = Object.entries(v)
    .filter(([key, value]) => key !== "recentConversation" && value != null && value !== "" && (!Array.isArray(value) || value.length))
    .map(([key, value]) => `${labels[key] || key.replace(/([A-Z])/g, " $1")}: ${format(key, value)}`);
  return rows.length ? rows.join("\n") : "No structured summary available.";
}

function trustLabel(value?:string){return ({CONTACT_VALID:"بيانات صالحة مبدئيًا",NEEDS_VERIFICATION:"يحتاج تحقق",SUSPICIOUS:"مشبوه ويحتاج مراجعة",ADMIN_CONFIRMED_REAL:"أكد الأدمن أنه حقيقي",ADMIN_CONFIRMED_FAKE:"أكد الأدمن أنه Fake"} as Record<string,string>)[value||""]||value||"—";}
function channelLabel(value?:string|null){return ({CALL:"مكالمة",WHATSAPP:"WhatsApp",SMS:"SMS",EMAIL:"Email"} as Record<string,string>)[value||""]||"—";}
function visitLabel(day?:string|null,timing?:string|null){const a=({MORNING:"الصبح",AFTERNOON:"العصر",EVENING:"المساء"} as Record<string,string>)[day||""];const b=({MIDWEEK:"نص الأسبوع",WEEKEND:"نهاية الأسبوع",WEEKDAY:"يوم عمل"} as Record<string,string>)[timing||""];return [a,b].filter(Boolean).join(" · ")||"—";}
function reasonLabel(value:string){return ({invalid_phone:"رقم الهاتف غير صالح",implausible_phone:"رقم يبدو تجريبيًا",placeholder_name:"اسم تجريبي",unit_code_as_name:"تم إدخال كود وحدة بدل الاسم",implausible_name:"الاسم يحتاج تحقق",repeated_name_token:"الاسم مكرر بشكل غير طبيعي",missing_name:"الاسم غير مكتمل",unclear_input:"رسالة غير مفهومة",repeated_nonsense_input:"إدخالات غير مفهومة متكررة",previous_admin_confirmed_fake_contact:"نفس بيانات التواصل سبق تأكيدها Fake"} as Record<string,string>)[value]||value.replaceAll("_"," ");}
