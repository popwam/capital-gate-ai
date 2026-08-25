import { Injectable } from "@nestjs/common";
import { StructuredIntent } from "../../providers/ai-provider";
import { PrismaService } from "../../database/prisma.service";
import { PropertySearchService } from "../../property-search.service";
import { NadimPlan, NadimToolResult } from "../domain/nadim-plan";
import { NadimSearchState, NadimState } from "../domain/nadim-state";

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
      } : null,
    } : null,
    developer: unit.developer ? {
      id: unit.developer.id,
      name: unit.developer.nameAr ?? unit.developer.nameEn ?? unit.developer.brandName ?? unit.developer.name,
    } : null,
    paymentPlans: Array.isArray(unit.paymentPlans) ? unit.paymentPlans.map((plan: any) => ({
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
  });
}

function searchIntent(search: NadimSearchState, locale: string): StructuredIntent {
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
    budgetMax: search.budgetMax,
    currency: search.currency,
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
  constructor(private readonly properties: PropertySearchService, private readonly prisma: PrismaService) {}

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
    if (tool === "PROPERTY_SEARCH") {
      const units = await this.properties.searchProperties(searchIntent(state.search, state.locale), Number(args.limit ?? 5));
      return units.map(compactUnit);
    }
    if (tool === "GET_UNIT_FACTS") {
      const unit = args.unitId
        ? await this.properties.getProperty(String(args.unitId))
        : await this.properties.findUnitByExternalId(String(args.unitReference));
      if (!unit) throw Object.assign(new Error("Property not found"), { status: 404 });
      return compactUnit(unit);
    }
    if (tool === "GET_PAYMENT_PLAN") return serialize(await this.properties.getPaymentPlans(String(args.unitId)));
    if (tool === "COMPARE_PROPERTIES") return (await this.properties.compareProperties((args.unitIds as string[]) ?? [])).map(compactUnit);
    if (tool === "GET_AVAILABILITY") {
      const unit = await this.properties.getProperty(String(args.unitId));
      return serialize({ unitId: unit.id, externalUnitId: unit.externalUnitId, status: unit.status, availabilityUpdatedAt: unit.availabilityUpdatedAt });
    }
    if (tool === "GET_MEDIA") {
      const unit = await this.properties.getProperty(String(args.unitId));
      return serialize({ unitId: unit.id, externalUnitId: unit.externalUnitId, media: compactUnit(unit).media });
    }
    if (tool === "GET_PROJECT_FACTS") return serialize(await this.properties.getProject(String(args.projectId)));
    if (tool === "GET_LOCATION") {
      const unit = await this.properties.getProperty(String(args.unitId));
      return compactUnit(unit).project?.location ?? null;
    }
    if (tool === "CUSTOMER_LOOKUP") return this.prisma.customer.findUnique({ where: { id: String(args.customerId) }, select: { id: true, name: true, normalizedPhone: true, normalizedEmail: true } });
    if (tool === "LEAD_LOOKUP") return this.prisma.lead.findFirst({ where: { customerId: String(args.customerId), status: { notIn: ["WON", "LOST"] } }, orderBy: { updatedAt: "desc" }, select: { id: true, status: true, intent: true, intentScore: true, followUpAt: true } });
    return null;
  }

  private errorCode(error: unknown) {
    const status = (error as { status?: number; getStatus?: () => number })?.getStatus?.() ?? (error as { status?: number })?.status;
    if (status === 404) return "VERIFIED_DATA_NOT_FOUND";
    return "TOOL_EXECUTION_FAILED";
  }
}
