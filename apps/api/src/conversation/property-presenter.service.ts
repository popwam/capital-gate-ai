import { Injectable } from "@nestjs/common";
import { AIContextKind, StructuredIntent } from "../providers/ai-provider";
import { ConversationFormatterService } from "./conversation-formatter.service";

/**
 * Formats property and project information for customer responses.
 * Extracted from ChatService for domain separation.
 */
@Injectable()
export class PropertyPresenterService {
  constructor(private readonly formatter: ConversationFormatterService) {}

  propertyDetailAnswer(unit: any, ar: boolean): string | undefined {
    if (!unit) return undefined;
    const project = this.formatter.displayProject(unit);
    const developer = this.formatter.displayDeveloper(unit);
    const location = this.formatter.displayLocation(unit);
    const price = this.formatter.money(unit.price, unit.currency ?? "EGP");
    const area = unit.builtUpArea != null ? `${Number(unit.builtUpArea)} م²` : null;
    const phase = unit.phaseRef?.nameAr ?? unit.phaseRef?.nameEn ?? unit.phaseRef?.name ?? unit.phase ?? null;
    const building = unit.projectBuilding?.nameAr ?? unit.projectBuilding?.nameEn ?? unit.projectBuilding?.name ?? unit.building ?? null;
    if (!ar) {
      return [
        `Unit ${unit.externalUnitId ?? ""}${project ? ` is in ${project}` : ""}${developer ? ` by ${developer}` : ""}.`,
        [unit.unitType, unit.bedrooms != null ? `${unit.bedrooms} bedrooms` : null, area, price, unit.status].filter(Boolean).join(" · "),
        [phase ? `Phase: ${phase}` : null, building ? `Building: ${building}` : null, location ? `Location: ${location}` : null].filter(Boolean).join(" · "),
      ].filter(Boolean).join("\n\n");
    }
    return [
      `الوحدة **${unit.externalUnitId ?? ""}**${project ? ` في مشروع **${project}**` : ""}${developer ? ` من المطور **${developer}**` : ""}.`,
      [unit.unitType, unit.bedrooms != null ? `${unit.bedrooms} غرف` : null, area, price, unit.status === "AVAILABLE" ? "متاحة حاليًا" : unit.status].filter(Boolean).join(" · "),
      [phase ? `المرحلة: ${phase}` : null, building ? `المبنى: ${building}` : null, location ? `الموقع: ${location}` : null].filter(Boolean).join(" · "),
    ].filter(Boolean).join("\n\n");
  }

  verifiedFactsAnswer(state: StructuredIntent, facts: unknown[], contextKind: AIContextKind): string | undefined {
    const ar = state.language?.startsWith("ar") ?? true;
    const values = (facts as any[]).filter(Boolean);
    const units = values.filter((item) => item?.externalUnitId || item?.unitCode);

    if (contextKind === "PROPERTY_SEARCH" || contextKind === "COMPARISON") {
      if (!units.length) return undefined;
      const first = units[0];
      const objective = state.queryObjective;
      if (objective === "CHEAPEST" || objective === "MOST_EXPENSIVE") {
        const label = objective === "CHEAPEST" ? (ar ? "أرخص وحدة موثقة" : "The cheapest verified unit") : (ar ? "أغلى وحدة موثقة" : "The most expensive verified unit");
        const type = first.unitType ? (ar ? `نوعها **${first.unitType}**` : `Its type is **${first.unitType}**`) : (ar ? "نوعها غير مسجل في البيانات الموثقة" : "Its type is not recorded in the verified data");
        const price = this.formatter.money(first.price, first.currency ?? "EGP");
        const project = this.formatter.displayProject(first);
        const location = this.formatter.displayLocation(first);
        const details = [type, price ? (ar ? `وسعرها ${price}` : `priced at ${price}`) : null, project ? (ar ? `في مشروع **${project}**` : `in **${project}**`) : null, location ? (ar ? `بمنطقة ${location}` : `in ${location}`) : null].filter(Boolean).join(ar ? "، " : ", ");
        return `${label} ${ar ? "ضمن شروط البحث الحالية" : "under the current search constraints"}: ${details}.`;
      }
      if (units.length === 1) return this.propertyDetailAnswer(first, ar);
      const lines = units.slice(0, 4).map((unit) => {
        const code = unit.externalUnitId ?? unit.unitCode;
        const price = this.formatter.money(unit.price, unit.currency ?? "EGP");
        const project = this.formatter.displayProject(unit);
        const location = this.formatter.displayLocation(unit);
        return `- ${[code ? `**${code}**` : (ar ? "وحدة" : "Unit"), unit.unitType, price, project, location].filter(Boolean).join(" · ")}`;
      });
      return [ar ? `لقيت ${units.length} اختيارات موثقة مطابقة للشروط الحالية:` : `I found ${units.length} verified options matching the current constraints:`, ...lines].join("\n");
    }

    if (contextKind === "DEVELOPER_HISTORY") {
      const developer = values[0];
      if (!developer) return undefined;
      const name = developer.nameAr ?? developer.nameEn ?? developer.brandName ?? developer.name;
      const portfolio = Array.isArray(developer.portfolioProjects) ? developer.portfolioProjects.slice(0, 5) : [];
      const projects = portfolio.map((project: any) => project.projectName).filter(Boolean);
      return ar
        ? [name ? `المطور: **${name}**.` : null, projects.length ? `ومن المشروعات الموثقة في سجلّه: ${projects.join("، ")}.` : "مفيش مشروعات سابقة موثقة ظاهرة في البيانات الحالية."].filter(Boolean).join("\n")
        : [name ? `Developer: **${name}**.` : null, projects.length ? `Verified portfolio projects include: ${projects.join(", ")}.` : "No verified portfolio projects are present in the current data."].filter(Boolean).join("\n");
    }

    const projectValue = values[0];
    const project = projectValue?.project ?? projectValue;
    if (!project) return undefined;
    const projectName = project.nameAr ?? project.nameEn ?? project.name ?? projectValue?.projectName;
    const developer = project.developer?.nameAr ?? project.developer?.nameEn ?? project.developer?.brandName ?? project.developer?.name ?? projectValue?.developerName;
    const location = project.location?.nameAr ?? project.location?.nameEn ?? project.location?.name ?? project.formattedAddress ?? projectValue?.location;

    if (["INVESTMENT", "RESALE", "RENTAL"].includes(contextKind)) {
      const profile = project.investmentProfile;
      if (!profile?.verifiedAt) return ar ? "مفيش تقييم موثق للغرض المطلوب على المشروع ده حاليًا." : "There is no verified assessment for that purpose on this project yet.";
      const suitable = contextKind === "INVESTMENT" ? profile.suitableForInvestment : contextKind === "RENTAL" ? profile.suitableForRental : null;
      const title = [projectName ? `**${projectName}**` : null, developer ? (ar ? `من ${developer}` : `by ${developer}`) : null, location ? (ar ? `في ${location}` : `in ${location}`) : null].filter(Boolean).join(" ");
      const suitability = suitable === true ? (ar ? "مصنف كمناسب وفق التقييم الموثق." : "is marked suitable in the verified assessment.") : suitable === false ? (ar ? "مصنف كغير مناسب وفق التقييم الموثق." : "is marked unsuitable in the verified assessment.") : (ar ? "درجة الملاءمة غير محددة في التقييم الموثق." : "Suitability is not specified in the verified assessment.");
      const advantages = Array.isArray(profile.investmentAdvantages) ? profile.investmentAdvantages.slice(0, 3) : [];
      return [title, suitability, advantages.length ? (ar ? `المزايا المسجلة: ${advantages.join("، ")}.` : `Recorded advantages: ${advantages.join(", ")}.`) : null].filter(Boolean).join("\n");
    }

    if (contextKind === "AMENITIES") {
      const amenities = Array.isArray(project.amenities) ? project.amenities.map((item: any) => item.amenity?.nameAr ?? item.amenity?.nameEn ?? item.amenity?.canonicalName).filter(Boolean).slice(0, 12) : [];
      return amenities.length
        ? (ar ? `الخدمات الموثقة في **${projectName ?? "المشروع"}**: ${amenities.join("، ")}.` : `Verified amenities at **${projectName ?? "the project"}**: ${amenities.join(", ")}.`)
        : (ar ? "مفيش خدمات موثقة مسجلة للمشروع حاليًا." : "No verified amenities are recorded for the project yet.");
    }

    const types = Array.isArray(project.projectTypes) && project.projectTypes.length ? project.projectTypes : Array.isArray(project.unitTypes) ? project.unitTypes : [];
    return ar
      ? [projectName ? `المشروع: **${projectName}**.` : null, developer ? `المطور: **${developer}**.` : null, location ? `الموقع: ${location}.` : null, types.length ? `الأنواع المسجلة: ${types.slice(0, 8).join("، ")}.` : null].filter(Boolean).join("\n") || "المعلومة المطلوبة مش متاحة في البيانات الموثقة عندي حاليًا."
      : [projectName ? `Project: **${projectName}**.` : null, developer ? `Developer: **${developer}**.` : null, location ? `Location: ${location}.` : null, types.length ? `Recorded types: ${types.slice(0, 8).join(", ")}.` : null].filter(Boolean).join("\n") || "The requested information is not available in the verified data right now.";
  }

  groundedFallback(state: StructuredIntent, facts: unknown[]): string {
    const ar = state.language?.startsWith("ar") ?? true;
    const first = facts[0] as any;
    if (!first) return ar ? "المعلومة المطلوبة مش متاحة في البيانات الموثقة عندي حاليًا." : "The requested information is not available in the verified data right now.";
    if (first.unitCode) {
      const propertyFacts = (facts as any[]).filter((item) => item?.unitCode).slice(0, 4);
      if (propertyFacts.length > 1) {
        return ar
          ? `لقيت ${propertyFacts.length} اختيارات موثقة ضمن طلبك. لو الكروت ظاهرة تحت الرد هتلاقي السعر والمساحة والمشروع لكل اختيار؛ ولو مش ظاهرة قولّي **وريني الاختيارات**.`
          : `I found ${propertyFacts.length} verified options matching your request. If the cards are shown below, they contain the price, area, and project for each option; otherwise say **show me the options**.`;
      }
      const project = first.projectName;
      const developer = first.developerName;
      const location = first.location ?? first.formattedAddress;
      const price = this.formatter.money(first.price, first.currency ?? "EGP");
      return ar
        ? [`الوحدة **${first.unitCode}**${project ? ` في مشروع **${project}**` : ""}${developer ? ` من المطور **${developer}**` : ""}.`, [first.unitType, first.bedrooms != null ? `${first.bedrooms} غرف` : null, first.builtUpArea != null ? `${first.builtUpArea} م²` : null, price, first.availability === "AVAILABLE" ? "متاحة حاليًا" : first.availability].filter(Boolean).join(" · "), location ? `الموقع: ${location}` : null].filter(Boolean).join("\n\n")
        : [`Unit ${first.unitCode}${project ? ` in ${project}` : ""}${developer ? ` by ${developer}` : ""}.`, [first.unitType, first.bedrooms != null ? `${first.bedrooms} bedrooms` : null, first.builtUpArea != null ? `${first.builtUpArea} m²` : null, price, first.availability].filter(Boolean).join(" · "), location ? `Location: ${location}` : null].filter(Boolean).join("\n\n");
    }
    if (first.projectName || first.developerName || first.location || first.formattedAddress) {
      const project = first.projectName ?? null;
      const developer = first.developerName ?? null;
      const location = first.location ?? first.formattedAddress ?? null;
      const types = Array.isArray(first.projectTypes) && first.projectTypes.length ? first.projectTypes.join("، ") : null;
      return ar
        ? [project ? `المشروع: **${project}**` : null, developer ? `المطور: **${developer}**` : null, location ? `الموقع: ${location}` : null, types ? `الأنواع: ${types}` : null].filter(Boolean).join("\n")
        : [project ? `Project: **${project}**` : null, developer ? `Developer: **${developer}**` : null, location ? `Location: ${location}` : null, types ? `Types: ${types}` : null].filter(Boolean).join("\n");
    }
    return ar ? "المعلومة المطلوبة موجودة في البيانات الموثقة، وتم منع صياغة غير دقيقة من الوصول للعميل." : "The requested fact exists in verified data; an inaccurate generated answer was blocked.";
  }

  hasGroundingContradiction(answer: string, facts: unknown[]): boolean {
    const values = facts as any[];
    const hasProject = values.some((item) => Boolean(item?.projectName ?? item?.project?.name ?? item?.name));
    const hasDeveloper = values.some((item) => Boolean(item?.developerName ?? item?.developer?.name ?? item?.project?.developer?.name));
    const hasLocation = values.some((item) => Boolean(item?.location ?? item?.formattedAddress ?? item?.project?.location?.name));
    const hasPayment = values.some((item) => Boolean(item?.paymentPlan) || (Array.isArray(item?.paymentPlans) && item.paymentPlans.length));
    const missing = /(?:غير\s+(?:متوفر|متاحة|موجود)|مش\s+(?:متوفر|موجود)|ما\s*فيش|ليس\s+متوفر|unavailable|not\s+available|missing)/iu;
    if (!missing.test(answer)) return false;
    if (hasProject && /(?:اسم\s+المشروع|المشروع|project)/iu.test(answer)) return true;
    if (hasDeveloper && /(?:المطور|developer)/iu.test(answer)) return true;
    if (hasLocation && /(?:الموقع|المكان|location|address)/iu.test(answer)) return true;
    if (hasPayment && /(?:السداد|تقسيط|كاش|payment|installment)/iu.test(answer)) return true;
    return false;
  }

  cardProperty(value: any) {
    return {
      id: value.id,
      externalUnitId: value.externalUnitId,
      unitType: value.unitType,
      bedrooms: value.bedrooms,
      bathrooms: value.bathrooms,
      builtUpArea: value.builtUpArea,
      price: value.price,
      currency: value.currency,
      status: value.status,
      availabilityUpdatedAt: value.availabilityUpdatedAt,
      deliveryDate: value.deliveryDate,
      finishingType: value.finishingType,
      floor: value.floor,
      phase: value.phase,
      internalLocationDescription: value.internalLocationDescription,
      projectZone: value.projectZone ? { id: value.projectZone.id, name: value.projectZone.nameAr ?? value.projectZone.nameEn ?? value.projectZone.name } : null,
      projectBuilding: value.projectBuilding ? { id: value.projectBuilding.id, name: value.projectBuilding.nameAr ?? value.projectBuilding.nameEn ?? value.projectBuilding.name } : null,
      closestGate: value.closestGate ?? null,
      bestPaymentPlan: value.bestPaymentPlan ?? null,
      project: value.project ? {
        id: value.project.id,
        name: value.project.nameAr ?? value.project.nameEn ?? value.project.name,
        location: value.project.location ? { id: value.project.location.id, name: value.project.location.nameAr ?? value.project.location.nameEn ?? value.project.location.name } : null,
      } : null,
      developer: value.developer ? { id: value.developer.id, name: value.developer.nameAr ?? value.developer.nameEn ?? value.developer.brandName ?? value.developer.name } : null,
      paymentPlans: Array.isArray(value.paymentPlans) ? value.paymentPlans.map((plan: any) => ({
        id: plan.id,
        name: plan.name,
        durationMonths: plan.durationMonths,
        downPaymentAmount: plan.downPaymentAmount ?? plan.downPayment,
        downPaymentPercent: plan.downPaymentPercent,
        installmentAmount: plan.installmentAmount,
        installmentFrequency: plan.installmentFrequency,
        totalPrice: plan.totalPrice,
        totalPriceOverride: plan.totalPriceOverride,
        effectiveTotalPrice: plan.effectiveTotalPrice,
        discountAmount: plan.discountAmount,
        discountPercent: plan.discountPercent,
        currency: plan.currency ?? value.currency,
        scope: plan.unitId ? "UNIT" : "PROJECT",
      })) : [],
      media: Array.isArray(value.media) ? value.media.slice(0, 1).map((item: any) => ({ id: item.id, url: item.url, altText: item.altTextAr ?? item.altTextEn ?? item.altText ?? null })) : [],
    };
  }
}
