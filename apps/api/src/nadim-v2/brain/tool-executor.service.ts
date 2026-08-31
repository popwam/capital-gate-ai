import { Injectable, Optional } from "@nestjs/common";
import { StructuredIntent } from "../../providers/ai-provider";
import { PrismaService } from "../../database/prisma.service";
import { PropertySearchService } from "../../property-search.service";
import { NadimPlan, NadimToolResult } from "../domain/nadim-plan";
import { NadimSearchState, NadimState } from "../domain/nadim-state";
import { DeterministicTimeService } from "./deterministic-time.service";
import { normalizePaymentPlan } from "../domain/payment-percentage";
import type { VerifiedPaymentPlan, VerifiedUnitPaymentPlanResult } from "../domain/verified-payment-plan";

function serialize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function compactUnit(unit: any) {
  return serialize({
    id: unit.id,
    externalUnitId: unit.externalUnitId,
    unitType: unit.unitType,
    bedrooms: unit.bedrooms,
    bathrooms: unit.bathrooms,
    builtUpArea: unit.builtUpArea == null ? null : Number(unit.builtUpArea),
    price: unit.price == null ? null : Number(unit.price),
    currency: unit.currency,
    status: unit.status,
    availabilityUpdatedAt: unit.availabilityUpdatedAt,
    deliveryDate: unit.deliveryDate,
    finishingType: unit.finishingType,
    project: unit.project ? {
      id: unit.project.id,
      name: unit.project.nameAr ?? unit.project.nameEn ?? unit.project.name,
      location: unit.project.location ? {
        id: unit.project.location.id,
        name: unit.project.location.nameAr ?? unit.project.location.nameEn ?? unit.project.location.name,
        latitude: unit.project.latitude == null ? (unit.project.location.latitude == null ? null : Number(unit.project.location.latitude)) : Number(unit.project.latitude),
        longitude: unit.project.longitude == null ? (unit.project.location.longitude == null ? null : Number(unit.project.location.longitude)) : Number(unit.project.longitude),
      } : null,
    } : null,
    developer: unit.developer ? {
      id: unit.developer.id,
      name: unit.developer.nameAr ?? unit.developer.nameEn ?? unit.developer.brandName ?? unit.developer.name,
    } : null,
    paymentPlans: Array.isArray(unit.paymentPlans) ? unit.paymentPlans.map((plan: any) => normalizePaymentPlan({
      id: plan.id,
      name: plan.name,
      durationMonths: plan.durationMonths,
      downPaymentAmount: plan.downPaymentAmount ?? plan.downPayment,
      downPaymentPercent: plan.downPaymentPercent,
      installmentAmount: plan.installmentAmount,
      installmentFrequency: plan.installmentFrequency,
      effectiveTotalPrice: plan.effectiveTotalPrice,
      currency: plan.currency ?? unit.currency,
    })) : [],
    media: Array.isArray(unit.media) ? unit.media.map((item: any) => ({ id: item.id, type: item.type, url: item.url, altText: item.altTextAr ?? item.altTextEn ?? item.altText ?? null })).slice(0, 12) : [],
    proximities: Array.isArray(unit.proximities) ? unit.proximities.map((item: any) => ({ targetType: item.targetType, targetName: item.landmark?.nameAr ?? item.landmark?.nameEn ?? item.landmark?.name ?? item.gate?.nameAr ?? item.gate?.nameEn ?? item.gate?.name ?? item.amenity?.nameAr ?? item.amenity?.nameEn ?? item.amenity?.name, distanceMeters: item.distanceMeters == null ? null : Number(item.distanceMeters), walkingMinutes: item.walkingMinutes, drivingMinutes: item.drivingMinutes, verifiedAt: item.verifiedAt })) : [],
  });
}

function compactPaymentPlan(plan: any): VerifiedPaymentPlan {
  const normalized = normalizePaymentPlan(plan);
  const owner = plan.unitId != null
    ? { type: "UNIT" as const, id: String(plan.unitId) }
    : plan.phaseId != null
      ? { type: "PHASE" as const, id: String(plan.phaseId) }
      : { type: "PROJECT" as const, id: String(plan.projectId) };
  return {
    id: String(plan.id),
    name: plan.name ?? null,
    durationMonths: plan.durationMonths ?? null,
    downPaymentAmount: plan.downPaymentAmount == null ? null : Number(plan.downPaymentAmount),
    downPaymentPercent: normalized.downPaymentPercent == null ? null : Number(normalized.downPaymentPercent),
    installmentAmount: plan.installmentAmount == null ? null : Number(plan.installmentAmount),
    installmentFrequency: plan.installmentFrequency ?? null,
    effectiveTotalPrice: plan.effectiveTotalPrice == null ? null : Number(plan.effectiveTotalPrice),
    currency: plan.currency ?? null,
    owner,
  };
}

function searchIntent(search: NadimSearchState, locale: string): StructuredIntent {
  if (search.currency && search.currency.toUpperCase() !== "EGP" && !search.budget?.normalizedAmount) {
    throw Object.assign(new Error("Verified FX is required before searching EGP inventory"), { code: "FX_UNAVAILABLE" });
  }
  return {
    language: locale,
    locations: search.locations,
    preferredProjects: search.projects,
    preferredDevelopers: search.developers,
    propertyTypes: search.propertyTypes,
    bedrooms: search.bedrooms,
    bathrooms: search.bathrooms,
    builtUpAreaMin: search.areaMin,
    builtUpAreaMax: search.areaMax,
    budgetMin: search.budgetMin,
    budgetMax: search.budget?.normalizedAmount ?? search.budgetMax,
    currency: search.budget?.normalizedCurrency ?? search.currency,
    maxDownPayment: search.downPaymentMax,
    preferredPaymentDurationMonths: search.installmentMonths,
    softPreferences: search.installmentPreference === "LONG_TERM"
      ? ["LONG_TERM_INSTALLMENTS"]
      : search.installmentPreference === "INSTALLMENTS" ? ["INSTALLMENTS"] : undefined,
    deliveryMaxYears: search.deliveryMaxYears,
    purpose: search.purpose,
    queryObjective: search.queryObjective ?? "BEST_MATCH",
    extractionDegraded: false,
    searchRelaxationAuthorized: false,
  };
}

@Injectable()
export class ToolExecutorService {
  private readonly time: DeterministicTimeService;

  constructor(
    private readonly properties: PropertySearchService,
    private readonly prisma: PrismaService,
    @Optional() time?: DeterministicTimeService,
  ) {
    this.time = time ?? new DeterministicTimeService();
  }

  async execute(plan: NadimPlan, state: NadimState) {
    const results: NadimToolResult[] = [];
    for (const step of plan.steps) {
      const started = Date.now();
      try {
        const data = await this.executeOne(step.tool, step.arguments, state);
        results.push({ tool: step.tool, ok: true, data, latencyMs: Date.now() - started });
      } catch (error) {
        results.push({ tool: step.tool, ok: false, errorCode: this.errorCode(error), latencyMs: Date.now() - started });
      }
    }
    return results;
  }

  private async executeOne(tool: NadimPlan["steps"][number]["tool"], args: Record<string, unknown>, state: NadimState): Promise<unknown> {
    if (tool === "GET_CURRENT_TIME") return this.time.now(state.locale, args.timeZone);
    if (tool === "PROPERTY_SEARCH") {
      const units = await this.properties.searchProperties(searchIntent(state.search, state.locale), Number(args.limit ?? 5));
      return units.map(compactUnit);
    }
    if (tool === "GET_UNIT_FACTS") {
      const unit = args.unitReference
        ? await this.resolveRecentUnitReference(String(args.unitReference), state)
        : args.unitId ? await this.properties.getProperty(String(args.unitId)) : null;
      if (!unit) throw Object.assign(new Error("Property not found"), { status: 404 });
      return compactUnit(unit);
    }
    if (tool === "GET_PAYMENT_PLAN") {
      const unitId = await this.resolveUnitId(args, state);
      const result = await this.properties.getPaymentPlanResult(unitId);
      if (result.unit.id !== unitId) throw Object.assign(new Error("Payment plan unit ownership mismatch"), { code: "PAYMENT_PLAN_OWNERSHIP_MISMATCH" });
      return serialize({ unit: result.unit, plans: result.plans.map(compactPaymentPlan) } satisfies VerifiedUnitPaymentPlanResult);
    }
    if (tool === "COMPARE_PROPERTIES") return (await this.properties.compareProperties((args.unitIds as string[]) ?? [])).map(compactUnit);
    if (tool === "GET_AVAILABILITY") {
      const unit = await this.properties.getProperty(await this.resolveUnitId(args, state));
      return serialize({ unitId: unit.id, externalUnitId: unit.externalUnitId, status: unit.status, availabilityUpdatedAt: unit.availabilityUpdatedAt });
    }
    if (tool === "GET_MEDIA") {
      const unit = await this.properties.getProperty(await this.resolveUnitId(args, state));
      const projectAssets = await this.prisma.media.findMany({ where: { projectId: unit.projectId, unitId: null }, select: { id: true, type: true, url: true, altText: true, altTextAr: true, altTextEn: true }, orderBy: { sortOrder: "asc" }, take: 30 });
      const media = [...compactUnit(unit).media, ...projectAssets.map((item) => ({ id: item.id, type: item.type, url: item.url, altText: item.altTextAr ?? item.altTextEn ?? item.altText }))]
        .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index);
      return serialize({ unitId: unit.id, externalUnitId: unit.externalUnitId, media, location: compactUnit(unit).project?.location ?? null });
    }
    if (tool === "GET_PROJECT_FACTS") return serialize(await this.properties.getProject(String(args.projectId)));
    if (tool === "GET_LOCATION") {
      const unit = await this.properties.getProperty(await this.resolveUnitId(args, state));
      return compactUnit(unit).project?.location ?? null;
    }
    if (tool === "CUSTOMER_LOOKUP") return this.prisma.customer.findUnique({ where: { id: String(args.customerId) }, select: { id: true, name: true, normalizedPhone: true, normalizedEmail: true } });
    if (tool === "LEAD_LOOKUP") return this.prisma.lead.findFirst({ where: { customerId: String(args.customerId), status: { notIn: ["WON", "LOST"] } }, orderBy: { updatedAt: "desc" }, select: { id: true, status: true, intent: true, intentScore: true, followUpAt: true } });
    return null;
  }

  private async resolveRecentUnitReference(reference: string, state: NadimState) {
    const normalized = reference.normalize("NFKC").toLocaleLowerCase().replace(/[أإآ]/gu, "ا").replace(/[^\p{L}\p{N}.]+/gu, " ").trim();
    const units = state.lastResultIds.length
      ? (await Promise.all(state.lastResultIds.slice(0, 10).map((id) => this.properties.getProperty(id).catch(() => null)))).filter(Boolean) as any[]
      : [];
    const normalizedCode = reference.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    const recentExact = units.filter((unit) => String(unit.externalUnitId ?? "").normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "") === normalizedCode);
    if (recentExact.length > 1) throw Object.assign(new Error("Property reference is ambiguous"), { status: 409 });
    if (recentExact.length === 1) return recentExact[0];
    const exact = reference ? await this.properties.findUnitByExternalId(reference) : null;
    if (exact) return exact;
    if (!normalized || !units.length) return null;
    const numeric = normalized.match(/\b(\d+(?:\.\d+)?)\b/u)?.[1];
    const candidates = units.filter((unit) => {
      const project = String(unit.project?.nameAr ?? unit.project?.nameEn ?? unit.project?.name ?? "").normalize("NFKC").toLocaleLowerCase().replace(/[أإآ]/gu, "ا");
      const external = String(unit.externalUnitId ?? "").toLocaleLowerCase();
      const priceMillions = unit.price == null ? undefined : Number(unit.price) / 1_000_000;
      return (external && normalized.includes(external))
        || (project && (normalized.includes(project) || project.includes(normalized)))
        || (numeric !== undefined && priceMillions !== undefined && Math.abs(priceMillions - Number(numeric)) < 0.001);
    });
    if (candidates.length > 1) throw Object.assign(new Error("Property reference is ambiguous"), { status: 409 });
    return candidates[0] ?? null;
  }

  private async resolveUnitId(args: Record<string, unknown>, state: NadimState) {
    if (typeof args.unitReference === "string" && args.unitReference.trim()) {
      const unit = await this.resolveRecentUnitReference(args.unitReference, state);
      if (!unit?.id) throw Object.assign(new Error("Property reference was not resolved"), { code: "UNIT_REFERENCE_NOT_FOUND" });
      return String(unit.id);
    }
    if (typeof args.unitId === "string" && args.unitId) return args.unitId;
    throw Object.assign(new Error("Property reference is required"), { code: "UNIT_REFERENCE_NOT_FOUND" });
  }

  private errorCode(error: unknown) {
    if ((error as { code?: string })?.code === "FX_UNAVAILABLE") return "FX_UNAVAILABLE";
    if ((error as { code?: string })?.code === "TIMEZONE_REQUIRED") return "TIMEZONE_REQUIRED";
    if ((error as { code?: string })?.code === "UNIT_REFERENCE_NOT_FOUND") return "UNIT_REFERENCE_NOT_FOUND";
    if ((error as { code?: string })?.code === "PAYMENT_PLAN_OWNERSHIP_MISMATCH") return "PAYMENT_PLAN_OWNERSHIP_MISMATCH";
    const status = (error as { status?: number; getStatus?: () => number })?.getStatus?.() ?? (error as { status?: number })?.status;
    if (status === 404) return "VERIFIED_DATA_NOT_FOUND";
    if (status === 409) return "REFERENCE_AMBIGUOUS";
    return "TOOL_EXECUTION_FAILED";
  }
}
