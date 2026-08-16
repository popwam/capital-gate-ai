"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowUpLeft,
  Bot,
  Boxes,
  Building2,
  CheckCircle2,
  Clock3,
  FileSpreadsheet,
  MapPinned,
  MessageSquareText,
  Network,
  Sparkles,
  TrendingUp,
  UsersRound,
  Warehouse,
} from "lucide-react";
import { adminApi, adminErrorMessage } from "@/lib/api";

type Dashboard = {
  units: number;
  availableUnits: number;
  reservedUnits?: number;
  soldUnits?: number;
  unavailableUnits?: number;
  projects: number;
  developers: number;
  activeImports: number;
  importsNeedingInput: number;
  newLeads: number;
  followUps: number;
  mappedUnits?: number;
  projectsWithBoundary?: number;
  activePaymentPlans?: number;
  pendingKnowledge?: number;
  conversations24h?: number;
};

type ImportBatch = {
  id: string;
  name?: string | null;
  fileName: string;
  uploadedAt: string;
  status: string;
  rowsDetected: number;
  rowsCreated: number;
  rowsUpdated: number;
  rowsFailed: number;
  project?: { name: string } | null;
  developer?: { name: string } | null;
};

type ImportPage = { items: ImportBatch[]; total: number };
type AIHealthItem = {
  provider?: string;
  configured?: boolean;
  healthy?: boolean;
  status?: string;
  model?: string | null;
  selectedModel?: string | null;
  errorCode?: string;
};
type AIHealth = AIHealthItem | AIHealthItem[];

type LeadSummary = { newLeads: number; highIntent: number; followUpsDue: number; thisWeek: number };

const fmt = new Intl.NumberFormat("ar-EG");

function MetricCard({ icon: Icon, label, value, hint, href, tone = "plain" }: { icon: typeof Warehouse; label: string; value: number; hint: string; href: string; tone?: "plain" | "warn" | "good" }) {
  const toneClass = tone === "warn" ? "bg-[#fff7e8] text-[#94661b]" : tone === "good" ? "bg-[#eaf5ef] text-[#2d7258]" : "bg-[#eef2ef] text-[#36544a]";
  return (
    <a href={href} className="group rounded-[22px] border border-[#dfe4e0] bg-white p-4 shadow-[0_1px_2px_rgba(15,35,29,.03)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_35px_rgba(15,35,29,.07)]">
      <div className="flex items-start justify-between gap-3">
        <span className={`grid h-10 w-10 place-items-center rounded-xl ${toneClass}`}><Icon size={19} /></span>
        <ArrowUpLeft size={16} className="text-[#9aa49f] transition group-hover:-translate-x-0.5 group-hover:-translate-y-0.5" />
      </div>
      <p className="mt-5 text-[29px] font-bold leading-none tracking-[-.04em]">{fmt.format(value || 0)}</p>
      <p className="mt-2 text-[14px] font-bold">{label}</p>
      <p className="mt-1 text-[12px] leading-6 text-[#77837d]">{hint}</p>
    </a>
  );
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    UPLOADED: "تم الرفع",
    ANALYZING: "جاري التحليل",
    NEEDS_INPUT: "يحتاج مراجعة",
    READY: "جاهز للمعاينة",
    IMPORTING: "جاري الاستيراد",
    COMPLETED: "مكتمل",
    FAILED: "فشل",
    CANCELLED: "ملغي",
    ROLLED_BACK: "تم التراجع",
  };
  return labels[status] || status;
}

function statusTone(status: string) {
  if (status === "COMPLETED") return "bg-[#e9f4ee] text-[#236249]";
  if (status === "FAILED") return "bg-red-50 text-red-700";
  if (status === "NEEDS_INPUT") return "bg-[#fff4dd] text-[#8b621e]";
  return "bg-[#eef1ef] text-[#61706a]";
}

export default function AdminDashboardPage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [imports, setImports] = useState<ImportBatch[]>([]);
  const [leadSummary, setLeadSummary] = useState<LeadSummary | null>(null);
  const [health, setHealth] = useState<AIHealth | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.allSettled([
      adminApi.get<Dashboard>("/real-estate/dashboard"),
      adminApi.get<ImportPage>("/imports?page=1&pageSize=5"),
      adminApi.get<LeadSummary>("/leads/summary"),
      adminApi.get<AIHealth>("/system/ai-health"),
    ]).then((results) => {
      if (results[0].status === "fulfilled") setDashboard(results[0].value);
      else setError(adminErrorMessage(results[0].reason));
      if (results[1].status === "fulfilled") setImports(results[1].value.items.slice(0, 5));
      if (results[2].status === "fulfilled") setLeadSummary(results[2].value);
      if (results[3].status === "fulfilled") setHealth(results[3].value);
    });
  }, []);

  const availability = dashboard?.units ? Math.round(((dashboard.availableUnits || 0) / dashboard.units) * 100) : 0;
  const mapped = dashboard?.units ? Math.round((((dashboard.mappedUnits ?? 0) / dashboard.units) * 100)) : 0;
  const aiItems = useMemo(() => Array.isArray(health) ? health : health ? [health] : [], [health]);
  const aiHealthy = aiItems.length > 0 && aiItems.every((item) => item.healthy !== false && item.status !== "down");

  return (
    <main className="mx-auto max-w-[1480px] p-4 sm:p-6 lg:p-8" dir="rtl">
      <section className="mb-6 overflow-hidden rounded-[26px] bg-[#123c33] text-white shadow-[0_18px_60px_rgba(18,60,51,.14)]">
        <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[1.35fr_.65fr] lg:p-8">
          <div>
            <div className="flex items-center gap-2 text-[12px] font-bold text-[#9fd0bd]"><Sparkles size={15} /> مركز تشغيل المنصة</div>
            <h2 className="mt-3 max-w-3xl text-[26px] font-bold leading-[1.45] sm:text-[32px]">كل ما يحتاجه المشروع العقاري في شاشة تشغيل واحدة.</h2>
            <p className="mt-3 max-w-3xl text-[13px] leading-7 text-white/62 sm:text-[14px]">المخزون، الاستيراد، المستر بلان، خطط السداد، العملاء والمحادثات كلها مبنية على البيانات الحقيقية الموجودة في النظام.</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <a href="/admin/data/import" className="rounded-xl bg-white px-4 py-2.5 text-[13px] font-bold text-[#123c33]">رفع مخزون جديد</a>
              <a href="/admin/projects" className="rounded-xl border border-white/20 bg-white/7 px-4 py-2.5 text-[13px] font-bold text-white">إدارة مشروع</a>
              <a href="/admin/inventory" className="rounded-xl border border-white/20 bg-white/7 px-4 py-2.5 text-[13px] font-bold text-white">فتح المخزون</a>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 self-stretch">
            <div className="rounded-2xl bg-white/8 p-4"><p className="text-[11px] text-white/50">نسبة الوحدات المتاحة</p><p className="mt-2 text-[27px] font-bold">{availability}%</p><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#8fd1b7]" style={{ width: `${Math.min(100, availability)}%` }} /></div></div>
            <div className="rounded-2xl bg-white/8 p-4"><p className="text-[11px] text-white/50">تحديد المستر بلان</p><p className="mt-2 text-[27px] font-bold">{mapped}%</p><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#f0b877]" style={{ width: `${Math.min(100, mapped)}%` }} /></div></div>
            <div className="rounded-2xl bg-white/8 p-4"><p className="text-[11px] text-white/50">خطط سداد نشطة</p><p className="mt-2 text-[27px] font-bold">{fmt.format(dashboard?.activePaymentPlans ?? 0)}</p></div>
            <div className="rounded-2xl bg-white/8 p-4"><p className="text-[11px] text-white/50">محادثات آخر 24 ساعة</p><p className="mt-2 text-[27px] font-bold">{fmt.format(dashboard?.conversations24h ?? 0)}</p></div>
          </div>
        </div>
      </section>

      {error && <div className="mb-5 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-800">{error}</div>}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Warehouse} label="إجمالي المخزون" value={dashboard?.units ?? 0} hint={`${fmt.format(dashboard?.availableUnits ?? 0)} وحدة متاحة حاليًا`} href="/admin/inventory" />
        <MetricCard icon={Building2} label="المشروعات" value={dashboard?.projects ?? 0} hint={`${fmt.format(dashboard?.developers ?? 0)} مطور داخل الكتالوج`} href="/admin/projects" />
        <MetricCard icon={UsersRound} label="عملاء جدد" value={leadSummary?.newLeads ?? dashboard?.newLeads ?? 0} hint={`${fmt.format(leadSummary?.highIntent ?? 0)} فرص مرتفعة النية`} href="/admin/leads" tone={(leadSummary?.newLeads ?? 0) > 0 ? "good" : "plain"} />
        <MetricCard icon={Clock3} label="متابعات مطلوبة" value={leadSummary?.followUpsDue ?? dashboard?.followUps ?? 0} hint={`${fmt.format(leadSummary?.thisWeek ?? 0)} عميل خلال آخر أسبوع`} href="/admin/leads" tone={(leadSummary?.followUpsDue ?? 0) > 0 ? "warn" : "plain"} />
      </section>

      <section className="mt-6 grid gap-5 xl:grid-cols-[1.45fr_.75fr]">
        <div className="rounded-[24px] border border-[#dfe4e0] bg-white">
          <div className="flex items-center justify-between border-b px-5 py-4 sm:px-6">
            <div><h3 className="font-bold">آخر عمليات الاستيراد</h3><p className="mt-1 text-[12px] text-[#7b8781]">أحدث دفعات المخزون وحالتها الفعلية</p></div>
            <a href="/admin/data" className="text-[12px] font-bold text-[#356d5c]">عرض الكل</a>
          </div>
          <div className="divide-y">
            {imports.length ? imports.map((batch) => (
              <a key={batch.id} href={`/admin/data/import?import=${batch.id}`} className="grid gap-3 px-5 py-4 transition hover:bg-[#fafbf9] sm:grid-cols-[1.25fr_.8fr_.7fr_auto] sm:items-center sm:px-6">
                <div className="min-w-0"><p className="truncate text-[14px] font-bold" dir="auto">{batch.name || batch.fileName}</p><p className="mt-1 truncate text-[12px] text-[#81908a]" dir="auto">{batch.project?.name || batch.developer?.name || batch.fileName}</p></div>
                <div className="text-[12px] text-[#64716b]"><b className="text-[#23332d]">{fmt.format(batch.rowsDetected)}</b> صف<br/><span>{fmt.format(batch.rowsCreated)} جديد · {fmt.format(batch.rowsUpdated)} تحديث</span></div>
                <div className="text-[12px] text-[#7d8983]">{new Date(batch.uploadedAt).toLocaleDateString("ar-EG", { day: "numeric", month: "short", year: "numeric" })}</div>
                <span className={`w-fit rounded-full px-2.5 py-1 text-[11px] font-bold ${statusTone(batch.status)}`}>{statusLabel(batch.status)}</span>
              </a>
            )) : <div className="px-6 py-12 text-center text-sm text-[#7b8781]">لا توجد عمليات استيراد حتى الآن.</div>}
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-[24px] border border-[#dfe4e0] bg-white p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3"><div><h3 className="font-bold">حالة الذكاء الاصطناعي</h3><p className="mt-1 text-[12px] text-[#7b8781]">Workers AI + Groq + fallback</p></div><span className={`grid h-10 w-10 place-items-center rounded-xl ${aiHealthy ? "bg-[#eaf5ef] text-[#287055]" : "bg-[#fff2e6] text-[#a26725]"}`}>{aiHealthy ? <CheckCircle2 size={20}/> : <AlertCircle size={20}/>}</span></div>
            <div className="mt-5 space-y-2">
              {aiItems.length ? aiItems.map((item, index) => (
                <div key={`${item.provider}-${index}`} className="flex items-center justify-between gap-3 rounded-xl bg-[#f5f7f5] px-3 py-3">
                  <div className="min-w-0"><p className="truncate text-[13px] font-bold" dir="auto">{item.provider || "AI"}</p><p className="mt-0.5 truncate text-[11px] text-[#809089]" dir="auto">{item.model || item.selectedModel || "حسب الإعداد"}</p></div>
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${item.healthy === false ? "bg-red-500" : "bg-emerald-500"}`} />
                </div>
              )) : <p className="rounded-xl bg-[#f5f7f5] p-3 text-[12px] text-[#7b8781]">جارٍ قراءة حالة الموديلات…</p>}
            </div>
            <a href="/admin/system" className="mt-4 flex h-10 items-center justify-center gap-2 rounded-xl border text-[12px] font-bold"><Bot size={15}/> تفاصيل النظام</a>
          </div>

          <div className="rounded-[24px] border border-[#dfe4e0] bg-white p-5 sm:p-6">
            <h3 className="font-bold">تحتاج انتباهك</h3>
            <div className="mt-4 space-y-2">
              <ActionRow icon={FileSpreadsheet} label="استيرادات تحتاج إجابة" value={dashboard?.importsNeedingInput ?? 0} href="/admin/data" warning />
              <ActionRow icon={Sparkles} label="معرفة مشروع قيد المراجعة" value={dashboard?.pendingKnowledge ?? 0} href="/admin/projects" />
              <ActionRow icon={MapPinned} label="مشروعات بحدود GPS" value={dashboard?.projectsWithBoundary ?? 0} href="/admin/projects" />
              <ActionRow icon={Network} label="وحدات محددة على المستر بلان" value={dashboard?.mappedUnits ?? 0} href="/admin/inventory" />
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-[24px] border border-[#dfe4e0] bg-white p-5 sm:p-6">
        <div className="mb-5 flex items-center justify-between"><div><h3 className="font-bold">التشغيل السريع</h3><p className="mt-1 text-[12px] text-[#7c8882]">أكثر المهام استخدامًا في النسخة الحالية</p></div></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <QuickLink icon={Boxes} title="راجع وحدة" text="السعر، الحالة، خطط السداد ومكان الوحدة." href="/admin/inventory" />
          <QuickLink icon={MapPinned} title="حدّث مستر بلان" text="البوابات، المباني، الوحدات وحدود المشروع." href="/admin/projects" />
          <QuickLink icon={TrendingUp} title="راجع فرصة بيع" text="نية الشراء، المتابعة وسياق المحادثة." href="/admin/leads" />
          <QuickLink icon={MessageSquareText} title="راجع محادثة" text="افهم ما طلبه العميل وما رد به النظام." href="/admin/conversations" />
        </div>
      </section>
    </main>
  );
}

function ActionRow({ icon: Icon, label, value, href, warning = false }: { icon: typeof Activity; label: string; value: number; href: string; warning?: boolean }) {
  return <a href={href} className="flex items-center justify-between gap-3 rounded-xl bg-[#f7f8f6] px-3 py-3 transition hover:bg-[#f0f3f0]"><div className="flex min-w-0 items-center gap-3"><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${warning && value > 0 ? "bg-[#fff0d5] text-[#9a6a1d]" : "bg-[#eaf0ed] text-[#46675b]"}`}><Icon size={17}/></span><span className="truncate text-[13px] font-bold">{label}</span></div><b className="text-[15px]">{fmt.format(value || 0)}</b></a>;
}

function QuickLink({ icon: Icon, title, text, href }: { icon: typeof Boxes; title: string; text: string; href: string }) {
  return <a href={href} className="group rounded-2xl border border-[#e1e5e1] p-4 transition hover:border-[#bfd2ca] hover:bg-[#f9fbfa]"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#edf3f0] text-[#345e50]"><Icon size={18}/></span><p className="mt-4 text-[14px] font-bold">{title}</p><p className="mt-1 text-[12px] leading-6 text-[#7b8781]">{text}</p></a>;
}
