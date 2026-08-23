import { Injectable } from "@nestjs/common";
import { StructuredIntent } from "../providers/ai-provider";

/**
 * Formats conversation responses and handles presentation logic.
 * Extracted from ChatService for single-responsibility clarity.
 */
@Injectable()
export class ConversationFormatterService {
  money(value: unknown, currency = "EGP"): string | null {
    if (value == null || value === "") return null;
    const amount = Number(value);
    return Number.isFinite(amount) ? `${amount.toLocaleString("en-US")} ${currency}` : null;
  }

  cairoGreeting(ar: boolean): string {
    let hour = 18;
    try {
      hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
    } catch { /* keep an evening-safe fallback */ }
    const morning = hour >= 5 && hour < 12;
    return ar ? (morning ? "صباح الخير" : "مساء الخير") : (morning ? "Good morning" : "Good evening");
  }

  smallTalkAnswer(state: StructuredIntent): string {
    const ar = state.language?.startsWith("ar") ?? true;
    return ar
      ? "قولّي اللي في دماغك مباشرة: ميزانية، منطقة، نوع وحدة، مشروع، استثمار أو سكن — وأنا أرتبلك الصورة من البيانات المتاحة."
      : "Tell me what matters directly: budget, area, unit type, project, investment, or living — and I'll work from the verified inventory.";
  }

  withFirstTurnIntro(answer: string, state: StructuredIntent, isFirstTurn: boolean): string {
    if (!isFirstTurn) return answer;
    const ar = state.language?.startsWith("ar") ?? true;
    const mentionsCg = /\bCg\b|أنا\s+\*?\*?Cg|I['']?m\s+\*?\*?Cg/iu.test(answer);
    if (mentionsCg) return ar ? `${this.cairoGreeting(true)}.\n\n${answer}` : `${this.cairoGreeting(false)}.\n\n${answer}`;
    return ar
      ? `${this.cairoGreeting(true)}، أنا **Cg**.\n\n${answer}`
      : `${this.cairoGreeting(false)}, I'm **Cg**.\n\n${answer}`;
  }

  humanUnitLabel(unit: any, ar: boolean): string {
    if (!unit) return ar ? "الوحدة المختارة" : "the selected unit";
    const area = unit.builtUpArea != null ? `${Number(unit.builtUpArea)} ${ar ? "م²" : "m²"}` : null;
    const rooms = unit.bedrooms != null ? `${unit.bedrooms} ${ar ? "غرف" : unit.bedrooms === 1 ? "bedroom" : "bedrooms"}` : null;
    const project = this.displayProject(unit);
    const type = unit.unitType && !rooms ? unit.unitType : null;
    if (ar) return ["وحدة", area, rooms, type, project ? `مشروع ${project}` : null].filter(Boolean).join(" · ");
    return ["Unit", area, rooms, type, project ? `in ${project}` : null].filter(Boolean).join(" · ");
  }

  displayProject(unit: any): string | null {
    return unit?.project?.nameAr ?? unit?.project?.nameEn ?? unit?.project?.name ?? null;
  }

  displayDeveloper(unit: any): string | null {
    return unit?.developer?.nameAr ?? unit?.developer?.nameEn ?? unit?.developer?.brandName ?? unit?.developer?.name
      ?? unit?.project?.developer?.nameAr ?? unit?.project?.developer?.nameEn ?? unit?.project?.developer?.brandName ?? unit?.project?.developer?.name ?? null;
  }

  displayLocation(unit: any): string | null {
    return unit?.project?.location?.nameAr ?? unit?.project?.location?.nameEn ?? unit?.project?.location?.name
      ?? unit?.project?.formattedAddress ?? null;
  }

  sanitizeCustomerAnswer(answer: string, language?: string): string {
    const fallback = language?.startsWith("ar") ? "المعلومة الداخلية دي غير مخصصة للعرض، لكن أقدر أوضح لك البيانات المتاحة باسم المشروع أو الوحدة." : "That internal identifier is not meant for display; I can provide the available information using the project or unit name.";
    // Customer links are delivered by verified UI actions. Free-form model text never gets
    // to construct a route, brochure, media, or external URL on its own.
    let safe = answer.replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/giu, "$1");
    safe = safe.replace(/https?:\/\/[^\s)>]+/giu, "");
    safe = safe.replace(/\bc[a-z0-9]{20,}\b/giu, language?.startsWith("ar") ? "المشروع" : "the project");
    safe = safe.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu, language?.startsWith("ar") ? "العنصر" : "the item");
    safe = safe.replace(/(?:^|\n)\s*(?:كيف يمكنني مساعدتك اليوم[؟?]?|كيف أقدر أساعدك اليوم[؟?]?|how can i help you today\??|how may i assist you today\??)\s*(?=\n|$)/giu, "\n");
    safe = safe.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return safe || fallback;
  }
}
