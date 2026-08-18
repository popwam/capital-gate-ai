import { Injectable } from "@nestjs/common";
import { MessageRole, Prisma } from "@prisma/client";
import { PrismaService } from "./database/prisma.service";
import { StructuredIntent } from "./providers/ai-provider";

export type ContactChannel = "CALL" | "WHATSAPP" | "SMS" | "EMAIL";
export type TrustLevel = "CONTACT_VALID" | "NEEDS_VERIFICATION" | "SUSPICIOUS";

export type ContactPreferences = {
  preferredContactChannel?: ContactChannel;
  preferredConfirmationChannel?: ContactChannel;
  preferredVisitDayPart?: "MORNING" | "AFTERNOON" | "EVENING";
  preferredVisitTiming?: "MIDWEEK" | "WEEKEND" | "WEEKDAY";
};

export type TrustAssessment = ContactPreferences & {
  level: TrustLevel;
  score: number;
  reasons: string[];
  candidateName?: string;
  candidatePhone?: string;
  normalizedPhone?: string;
  canCreateLead: boolean;
  learnedFromFeedback: boolean;
};

const arDigits: Record<string, string> = { "٠":"0", "١":"1", "٢":"2", "٣":"3", "٤":"4", "٥":"5", "٦":"6", "٧":"7", "٨":"8", "٩":"9" };
const normalizeDigits = (value: string) => value.replace(/[٠-٩]/g, (digit) => arDigits[digit]);
const normalizeText = (value: string) => value.toLowerCase().normalize("NFKC").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s+/g, " ").trim();

const placeholders = new Set([
  "test", "test user", "fake", "fake user", "dummy", "unknown", "asdf", "asdfgh", "qwerty", "aaa", "aaaa", "xxx", "xxxx", "name",
  "تجربه", "اختبار", "وهمي", "فيك", "مجهول", "غير معروف", "اسم", "عميل تجريبي",
]);

function stripContactPhrases(value: string) {
  return value
    .replace(/^(?:انا|أنا|اسمي|الاسم|my name is|name is)\s*[:\-]?\s*/iu, "")
    .replace(/(?:ورقمي|ورقم|رقمي|رقم(?:ي)?|phone|mobile|number)\s*[:\-]?\s*$/iu, "")
    .trim();
}

function extractPhoneCandidate(source: string) {
  const normalized = normalizeDigits(source);
  const matches = [...normalized.matchAll(/(?:\+?\d[\d\s().-]{3,}\d)/g)]
    .map((match) => match[0].trim())
    .filter((candidate) => candidate.replace(/\D/g, "").length >= 5);
  if (!matches.length) return undefined;
  return matches.sort((a, b) => b.replace(/\D/g, "").length - a.replace(/\D/g, "").length)[0];
}

function normalizePhone(candidate?: string) {
  if (!candidate) return undefined;
  const digits = candidate.replace(/\D/g, "");
  if (/^01[0125]\d{8}$/.test(digits)) return `+2${digits}`;
  if (/^201[0125]\d{8}$/.test(digits)) return `+${digits}`;
  if (candidate.trim().startsWith("+") && /^\d{8,15}$/.test(digits)) return `+${digits}`;
  return undefined;
}

function fakePhonePattern(candidate?: string) {
  if (!candidate) return false;
  const digits = candidate.replace(/\D/g, "");
  return /(\d)\1{6,}$/.test(digits) || /0123456789|1234567890|9876543210/.test(digits);
}

function extractNameCandidate(source: string, phoneCandidate?: string, stateName?: string) {
  if (stateName?.trim()) return stateName.trim();
  let value = normalizeDigits(source);
  if (phoneCandidate) value = value.replace(phoneCandidate, " ");
  value = value
    .replace(/(?:رقمي|رقم(?:ي)?|ورقمي|ورقم|phone|mobile|number)\s*[:\-]?/giu, " ")
    .replace(/(?:واتساب|whatsapp|مكالمة|اتصال|call|sms|رسالة|ايميل|email)/giu, " ")
    .replace(/[|,،;؛]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  value = stripContactPhrases(value);
  if (!value || value.length > 80) return undefined;
  const letters = (value.match(/[\p{L}]/gu) ?? []).length;
  if (letters < 2) return undefined;
  return value;
}

function nameIssue(name?: string) {
  if (!name) return "missing_name";
  const normalized = normalizeText(name);
  if (placeholders.has(normalized)) return "placeholder_name";
  if (/^[a-z0-9]+(?:[-_][a-z0-9]+){2,}$/i.test(name)) return "unit_code_as_name";
  if (/^(.)\1{3,}$/iu.test(normalized.replace(/\s/g, ""))) return "implausible_name";
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length >= 3 && new Set(tokens).size === 1) return "repeated_name_token";
  const letters = (name.match(/[\p{L}]/gu) ?? []).length;
  const digits = (name.match(/\d/g) ?? []).length;
  if (letters < 2 || digits > letters) return "implausible_name";
  return undefined;
}

function looksLikeGibberish(value: string) {
  const normalized = normalizeText(value).replace(/\d+/g, " ").trim();
  if (!normalized) return false;
  if (/^(?:asdf|asdfgh|qwerty|zxcv|hjkl|aaaa+|xxxx+|ضصثقفغعهخحج|شسيبلاتنمكطئءؤرلا)+$/iu.test(normalized.replace(/\s/g, ""))) return true;
  const letters = (normalized.match(/[\p{L}]/gu) ?? []).length;
  return normalized.length >= 8 && letters / normalized.length < 0.25;
}

function channelFrom(value: string): ContactChannel | undefined {
  if (/(?:واتساب|whats?app)/iu.test(value)) return "WHATSAPP";
  if (/(?:sms|رساله\s*نصيه|رسالة\s*نصية|رساله|رسالة)/iu.test(value)) return "SMS";
  if (/(?:ايميل|إيميل|email|mail)/iu.test(value)) return "EMAIL";
  if (/(?:مكالمه|مكالمة|اتصال|كلمني|call|phone call)/iu.test(value)) return "CALL";
  return undefined;
}

export function contactPreferencesFromText(source: string, current: ContactPreferences = {}): ContactPreferences {
  const text = normalizeText(normalizeDigits(source));
  const result: ContactPreferences = { ...current };
  if (/(?:الصبح|صباح|morning)/iu.test(text)) result.preferredVisitDayPart = "MORNING";
  if (/(?:العصر|بعد الظهر|afternoon)/iu.test(text)) result.preferredVisitDayPart = "AFTERNOON";
  if (/(?:بالليل|المساء|مساء|evening)/iu.test(text)) result.preferredVisitDayPart = "EVENING";
  if (/(?:نص|وسط|منتصف)\s*(?:الاسبوع|الأسبوع)|midweek/iu.test(text)) result.preferredVisitTiming = "MIDWEEK";
  else if (/(?:ويك\s*اند|نهايه\s*الاسبوع|نهاية\s*الأسبوع|weekend)/iu.test(text)) result.preferredVisitTiming = "WEEKEND";
  else if (/(?:يوم\s*عمل|ايام\s*العمل|أيام\s*العمل|weekday)/iu.test(text)) result.preferredVisitTiming = "WEEKDAY";

  const confirmationMatch = text.match(/(?:التاكيد|التأكيد|تاكيد|تأكيد|confirm(?:ation)?)[^،,.؛;]{0,30}/iu)?.[0];
  const contactMatch = text.match(/(?:التواصل|كلمني|كلمني|اتواصل|يكلموني|يكلمك|contact)[^،,.؛;]{0,30}/iu)?.[0];
  const confirmationChannel = confirmationMatch ? channelFrom(confirmationMatch) : undefined;
  const contactChannel = contactMatch ? channelFrom(contactMatch) : undefined;
  if (confirmationChannel) result.preferredConfirmationChannel = confirmationChannel;
  if (contactChannel) result.preferredContactChannel = contactChannel;

  const channels = [...text.matchAll(/واتساب|whats?app|sms|رساله\s*نصيه|رسالة\s*نصية|ايميل|إيميل|email|مكالمه|مكالمة|اتصال|call/giu)]
    .map((match) => channelFrom(match[0]))
    .filter((value): value is ContactChannel => Boolean(value));
  if (!contactMatch && !confirmationMatch) {
    if (!result.preferredContactChannel && channels[0]) result.preferredContactChannel = channels[0];
    else if (!result.preferredConfirmationChannel && channels[0]) result.preferredConfirmationChannel = channels[0];
    if (!result.preferredConfirmationChannel && channels[1]) result.preferredConfirmationChannel = channels[1];
  }
  return result;
}

@Injectable()
export class CustomerTrustService {
  constructor(private readonly prisma: PrismaService) {}

  applyConversationPreferences(state: StructuredIntent, content: string) {
    const next = contactPreferencesFromText(content, {
      preferredContactChannel: state.preferredContactChannel,
      preferredConfirmationChannel: state.preferredConfirmationChannel,
      preferredVisitDayPart: state.preferredVisitDayPart,
      preferredVisitTiming: state.preferredVisitTiming,
    });
    return Object.assign(state, next);
  }

  async assessContact(input: {
    conversationId: string;
    content: string;
    state: StructuredIntent;
    contactExpected: boolean;
    allowImplicitPhone?: boolean;
  }): Promise<TrustAssessment> {
    const phoneCandidate = (input.allowImplicitPhone === false ? undefined : extractPhoneCandidate(input.content)) ?? input.state.contactPhone;
    const normalized = normalizePhone(phoneCandidate);
    const candidateName = extractNameCandidate(input.content, phoneCandidate, input.state.contactName);
    const reasons: string[] = [];
    let score = 100;

    const phoneWasAttempted = Boolean(phoneCandidate);
    if (phoneWasAttempted && !normalized) { reasons.push("invalid_phone"); score -= 45; }
    if (normalized && fakePhonePattern(normalized)) { reasons.push("implausible_phone"); score -= 45; }

    const issue = nameIssue(candidateName);
    if (input.contactExpected && issue) {
      reasons.push(issue);
      score -= issue === "missing_name" ? 20 : 40;
    }

    const recent = await this.prisma.message.findMany({
      where: { conversationId: input.conversationId, role: MessageRole.USER },
      orderBy: { createdAt: "desc" },
      take: 4,
      select: { content: true },
    });
    const gibberishCount = recent.filter((item) => looksLikeGibberish(item.content)).length;
    if (gibberishCount >= 2) { reasons.push("repeated_nonsense_input"); score -= 35; }
    else if (gibberishCount === 1 && looksLikeGibberish(input.content)) { reasons.push("unclear_input"); score -= 15; }

    let learnedFromFeedback = false;
    const feedbackPhone = normalized ?? phoneCandidate?.replace(/\s+/g, "");
    if (feedbackPhone) {
      const feedback = await this.prisma.customerTrustAlert.findFirst({
        where: { candidatePhone: feedbackPhone, status: { in: ["ADMIN_CONFIRMED_FAKE", "ADMIN_CONFIRMED_REAL"] } },
        orderBy: { resolvedAt: "desc" },
        select: { status: true },
      });
      if (feedback?.status === "ADMIN_CONFIRMED_FAKE") {
        reasons.push("previous_admin_confirmed_fake_contact");
        score = Math.min(score, 10);
        learnedFromFeedback = true;
      } else if (feedback?.status === "ADMIN_CONFIRMED_REAL") {
        score = Math.max(score, 90);
        for (const weak of ["placeholder_name", "implausible_name", "repeated_name_token", "unclear_input", "repeated_nonsense_input"]) {
          const index = reasons.indexOf(weak);
          if (index >= 0) reasons.splice(index, 1);
        }
        learnedFromFeedback = true;
      }
    }

    score = Math.max(0, Math.min(100, score));
    const hardInvalid = reasons.some((reason) => ["invalid_phone", "implausible_phone", "placeholder_name", "unit_code_as_name", "implausible_name", "repeated_name_token", "missing_name"].includes(reason));
    const unclearInput = reasons.includes("unclear_input");
    const repeatedNonsense = reasons.includes("repeated_nonsense_input");
    const suspicious = reasons.includes("previous_admin_confirmed_fake_contact") || repeatedNonsense || reasons.length >= 3;
    const needsReview = hardInvalid || unclearInput || repeatedNonsense;
    const level: TrustLevel = suspicious ? "SUSPICIOUS" : needsReview ? "NEEDS_VERIFICATION" : "CONTACT_VALID";
    const preferences = contactPreferencesFromText(input.content, {
      preferredContactChannel: input.state.preferredContactChannel,
      preferredConfirmationChannel: input.state.preferredConfirmationChannel,
      preferredVisitDayPart: input.state.preferredVisitDayPart,
      preferredVisitTiming: input.state.preferredVisitTiming,
    });

    return {
      level,
      score,
      reasons: [...new Set(reasons)],
      candidateName,
      candidatePhone: phoneCandidate,
      normalizedPhone: normalized,
      canCreateLead: level === "CONTACT_VALID" && Boolean(normalized && candidateName && !nameIssue(candidateName) && !fakePhonePattern(normalized)),
      learnedFromFeedback,
      ...preferences,
    };
  }

  async recordAlert(input: {
    conversationId: string;
    leadId?: string;
    assessment: TrustAssessment;
    content: string;
  }) {
    if (input.assessment.level === "CONTACT_VALID") return null;
    const open = await this.prisma.customerTrustAlert.findFirst({
      where: { conversationId: input.conversationId, status: "OPEN" },
      orderBy: { createdAt: "desc" },
    });
    const data = {
      leadId: input.leadId ?? null,
      riskLevel: input.assessment.level,
      score: input.assessment.score,
      reasons: input.assessment.reasons,
      candidateName: input.assessment.candidateName ?? null,
      candidatePhone: input.assessment.normalizedPhone ?? input.assessment.candidatePhone?.replace(/\s+/g, "") ?? null,
      messagePreview: input.content.slice(0, 240),
      payload: {
        learnedFromFeedback: input.assessment.learnedFromFeedback,
      } as Prisma.InputJsonValue,
    };
    if (open) return this.prisma.customerTrustAlert.update({ where: { id: open.id }, data });
    return this.prisma.customerTrustAlert.create({ data: { conversationId: input.conversationId, ...data } });
  }

  async resolveOpenAlerts(conversationId: string, leadId?: string) {
    return this.prisma.customerTrustAlert.updateMany({
      where: { conversationId, status: "OPEN" },
      data: { status: "AUTO_RESOLVED_AFTER_VALID_CONTACT", resolvedAt: new Date(), ...(leadId ? { leadId } : {}) },
    });
  }

  unclearMessage(ar = true) {
    return ar
      ? "الرسالة دي مش واضحة كفاية عندي، ومش حابب أفترض قصدك وأطلعك بنتيجة غلط. اكتبلي طلبك مرة تانية بشكل أبسط؛ ولو بتكمل حجز أو معاينة هطلب منك بيانات التواصل الصحيحة وقتها."
      : "That message is not clear enough for me to act on safely. Please rephrase it more simply; if you are continuing a viewing or reservation request, I will ask for valid contact details at that point.";
  }

  customerCorrectionMessage(assessment: TrustAssessment, ar = true) {
    if (!ar) {
      if (assessment.reasons.includes("invalid_phone") || assessment.reasons.includes("implausible_phone")) return "I couldn't validate that phone number well enough to attach it to a viewing request. Send the real mobile number you want the sales team to use, together with the name you want them to address you by.";
      if (assessment.reasons.some((reason) => ["placeholder_name", "unit_code_as_name", "implausible_name", "repeated_name_token"].includes(reason))) return "That name looks like a placeholder rather than contact details. Send the real name you want the sales team to use and a valid mobile number, and I'll continue from there.";
      return "I don't want to save uncertain customer details. Send the real contact name and a valid mobile number and I'll continue the request.";
    }
    if (assessment.reasons.includes("invalid_phone") || assessment.reasons.includes("implausible_phone")) return "الرقم اللي وصلني مش بصيغة أقدر أعتمدها لطلب معاينة. ابعتلي رقم الموبايل الحقيقي اللي تحب فريق المبيعات يتواصل عليه، ومعاه الاسم اللي تحبهم ينادوك بيه، وأنا أكمل من هنا.";
    if (assessment.reasons.some((reason) => ["placeholder_name", "unit_code_as_name", "implausible_name", "repeated_name_token"].includes(reason))) return "الاسم اللي وصلني شكله اسم تجريبي أو مش بيانات تواصل فعلية، ومش حابب أسجل طلب باسم غلط. ابعتلي الاسم الحقيقي اللي تحب فريق المبيعات ينادوك بيه ورقم موبايل صالح، وأنا أكمل لك الطلب.";
    return "البيانات اللي وصلتني لسه مش كفاية أسجل بيها طلب باسم صحيح. ابعتلي الاسم اللي تحب فريق المبيعات ينادوك بيه ورقم موبايل صالح للتواصل، وأنا أكمل من هنا.";
  }
}
