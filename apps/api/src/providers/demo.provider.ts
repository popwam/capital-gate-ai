import { Injectable } from "@nestjs/common";
import { AIMessage, AIProvider, AnswerInput, StructuredIntent } from "./ai-provider";

@Injectable()
export class DemoAIProvider implements AIProvider {
  async extractIntent(messages: AIMessage[], previous: StructuredIntent) {
    const text = messages.at(-1)?.content.toLowerCase() ?? "";
    const budget = text.match(/(\d+(?:\.\d+)?)\s*(?:m|million|مليون)/);
    return { ...previous, language: /[\u0600-\u06ff]/.test(text) ? "ar-EG" : "en", purpose: /invest|استثمار/.test(text) ? "INVESTMENT" : previous.purpose, locations: /new cairo|التجمع/.test(text) ? ["NEW_CAIRO"] : previous.locations, bedrooms: Number(text.match(/(\d+)\s*(?:bed|غرف)/)?.[1]) || previous.bedrooms, budgetMax: budget ? Number(budget[1]) * 1_000_000 : previous.budgetMax, currency: "EGP", requestedMedia: /photo|image|صور/.test(text) ? "IMAGES" : /brochure|بروشور/.test(text) ? "BROCHURE" : undefined, purchaseIntent: /book|reserve|viewing|احجز|معاينة/.test(text) ? 90 : previous.purchaseIntent } satisfies StructuredIntent;
  }
  async composeAnswer({ intent, verifiedFacts }: AnswerInput) {
    if (!verifiedFacts.length) return intent.language === "ar-EG" ? "مفيش نتيجة مطابقة متاحة حالياً. تحب أوسّع البحث في السعر ولا المناطق القريبة؟" : "I couldn’t find an exact available match. Would you like me to expand by price or nearby areas?";
    return intent.language === "ar-EG" ? `لقيت ${verifiedFacts.length} اختيارات موثّقة قريبة من طلبك.` : `I found ${verifiedFacts.length} verified options close to your request.`;
  }
  async *streamAnswer(input: AnswerInput) {
    const answer = await this.composeAnswer(input);
    for (const token of answer.split(/(\s+)/)) yield token;
  }
  async extractKnowledge(sourceText: string) { return { summary: sourceText.slice(0, 400), amenities: [], investmentAdvantages: [], faq: [], approvalStatus: "PENDING" }; }
  async mapColumns() { return []; }
}
