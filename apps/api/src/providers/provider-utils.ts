import { ServiceUnavailableException } from "@nestjs/common";
import { ProximityPreference, StructuredIntent } from "./ai-provider";
export { advisorMessages } from "./ai-context";

export type ProviderName = "workers" | "groq" | "openai";
export class AIUpstreamError extends Error {
  constructor(readonly provider:ProviderName,readonly code:string,readonly status?:number,readonly retryable=false){super(`${provider} request failed (${code})`);this.name="AIUpstreamError";}
}
export function stripJsonFence(value:string){return value.trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"");}
export function parseJsonObject(value:string,provider:ProviderName){try{const parsed=JSON.parse(stripJsonFence(value));if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error();return parsed as Record<string,unknown>;}catch{throw new AIUpstreamError(provider,"INVALID_STRUCTURED_OUTPUT",502,false);}}
export function parseJsonArray(value:string,provider:ProviderName){try{const parsed=JSON.parse(stripJsonFence(value));if(!Array.isArray(parsed))throw new Error();return parsed as unknown[];}catch{throw new AIUpstreamError(provider,"INVALID_STRUCTURED_OUTPUT",502,false);}}

function sanitizeProximity(value: unknown): ProximityPreference[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const targetTypes = ["GATE","AMENITY","LANDMARK","PROJECT_CENTER"];
  const preferences = ["NEAR","FAR","ANY"];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    if (!targetTypes.includes(String(raw.targetType)) || !preferences.includes(String(raw.preference))) return [];
    const max = typeof raw.maxDistanceMeters === "number" && Number.isFinite(raw.maxDistanceMeters) ? Math.max(0, raw.maxDistanceMeters) : undefined;
    return [{
      targetType: raw.targetType as ProximityPreference["targetType"],
      preference: raw.preference as ProximityPreference["preference"],
      ...(typeof raw.targetId === "string" && raw.targetId ? { targetId: raw.targetId } : {}),
      ...(typeof raw.targetName === "string" && raw.targetName ? { targetName: raw.targetName.slice(0,160) } : {}),
      ...(max != null ? { maxDistanceMeters: max } : {}),
    }];
  }).slice(0,10);
}

export function sanitizeIntent(raw:Record<string,unknown>,previous:StructuredIntent):StructuredIntent{
  const text=(key:string)=>typeof raw[key]==="string"&&raw[key]?String(raw[key]):undefined;
  const number=(key:string)=>typeof raw[key]==="number"&&Number.isFinite(raw[key])?Number(raw[key]):undefined;
  const boolean=(key:string)=>typeof raw[key]==="boolean"?Boolean(raw[key]):undefined;
  const texts=(key:string)=>Array.isArray(raw[key])?(raw[key] as unknown[]).filter((v):v is string=>typeof v==="string").slice(0,30):undefined;
  const oneOf=<T extends string>(key:string,values:readonly T[])=>values.includes(raw[key] as T)?raw[key] as T:undefined;
  return{
    ...previous,
    language:text("language")??previous.language??"ar-EG",
    dialect:oneOf("dialect",["EGYPTIAN_ARABIC","MSA","ENGLISH","MIXED"] as const)??previous.dialect,
    purpose:oneOf("purpose",["LIVING","INVESTMENT"] as const)??previous.purpose,
    inventoryMarket:oneOf("inventoryMarket",["PRIMARY","RESALE"] as const)??previous.inventoryMarket,
    locations:texts("locations")??previous.locations,
    rejectedLocations:texts("rejectedLocations")??previous.rejectedLocations,
    propertyTypes:texts("propertyTypes")??previous.propertyTypes,
    bedrooms:number("bedrooms")??previous.bedrooms,
    bathrooms:number("bathrooms")??previous.bathrooms,
    budgetMin:number("budgetMin")??previous.budgetMin,
    budgetMax:number("budgetMax")??previous.budgetMax,
    budgetFlexible:boolean("budgetFlexible")??previous.budgetFlexible,
    currency:text("currency")??previous.currency,
    deliveryMaxYears:number("deliveryMaxYears")??previous.deliveryMaxYears,
    maxDownPayment:number("maxDownPayment")??previous.maxDownPayment,
    maxTravelMinutes:number("maxTravelMinutes")??previous.maxTravelMinutes,
    minimumArea:number("minimumArea")??previous.minimumArea,
    maximumArea:number("maximumArea")??previous.maximumArea,
    builtUpAreaMin:number("builtUpAreaMin")??number("minimumArea")??previous.builtUpAreaMin??previous.minimumArea,
    builtUpAreaMax:number("builtUpAreaMax")??number("maximumArea")??previous.builtUpAreaMax??previous.maximumArea,
    targetBuiltUpArea:number("targetBuiltUpArea")??previous.targetBuiltUpArea,
    preferredFloor:number("preferredFloor")??previous.preferredFloor,
    minimumFloor:number("minimumFloor")??previous.minimumFloor,
    maximumFloor:number("maximumFloor")??previous.maximumFloor,
    preferredPhase:text("preferredPhase")??previous.preferredPhase,
    preferredProjectZone:text("preferredProjectZone")??previous.preferredProjectZone,
    preferredBuilding:text("preferredBuilding")??previous.preferredBuilding,
    preferredGate:text("preferredGate")??previous.preferredGate,
    maxGateDistanceMeters:number("maxGateDistanceMeters")??previous.maxGateDistanceMeters,
    preferredPaymentDurationMonths:number("preferredPaymentDurationMonths")??previous.preferredPaymentDurationMonths,
    maxMonthlyInstallment:number("maxMonthlyInstallment")??previous.maxMonthlyInstallment,
    preferredDownPaymentPercent:number("preferredDownPaymentPercent")??previous.preferredDownPaymentPercent,
    proximityPreferences:sanitizeProximity(raw.proximityPreferences)??previous.proximityPreferences,
    hardRequirements:texts("hardRequirements")??previous.hardRequirements,
    softPreferences:texts("softPreferences")??previous.softPreferences,
    requestedMedia:oneOf("requestedMedia",["IMAGES","BROCHURE","MAP"] as const),
    requestedProject:text("requestedProject")??previous.requestedProject,
    exactRouteRequested:boolean("exactRouteRequested"),
    routeOrigin:text("routeOrigin"),
    routeDestination:text("routeDestination"),
    purchaseIntent:Math.max(0,Math.min(100,number("purchaseIntent")??previous.purchaseIntent??0)),
    contactName:text("contactName")??previous.contactName,
    contactPhone:text("contactPhone")??previous.contactPhone,
    rejectedProjects:texts("rejectedProjects")??previous.rejectedProjects,
    preferredDevelopers:texts("preferredDevelopers")??previous.preferredDevelopers,
    preferredProjects:texts("preferredProjects")??previous.preferredProjects,
    familyRequirements:texts("familyRequirements")??previous.familyRequirements,
    investmentRequirements:texts("investmentRequirements")??previous.investmentRequirements,
    customerConcerns:texts("customerConcerns")??previous.customerConcerns,
    extractionDegraded:false
  };
}
export async function checkedJson(response:Response,provider:ProviderName){if(!response.ok){const retryable=response.status===408||response.status===409||response.status===429||response.status>=500;throw new AIUpstreamError(provider,`HTTP_${response.status}`,response.status,retryable);}return response.json() as Promise<Record<string,any>>;}
export function unavailable(provider:ProviderName,error:unknown):never{const upstream=error instanceof AIUpstreamError?error:new AIUpstreamError(provider,"NETWORK",undefined,true);throw new ServiceUnavailableException({code:"AI_TEMPORARILY_UNAVAILABLE",provider,category:upstream.code,upstreamStatus:upstream.status,safe:true});}
