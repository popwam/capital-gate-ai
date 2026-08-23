import { AIContextKind, AIMessage, AnswerInput, StructuredIntent } from "./ai-provider";
import { getPromptLoader } from "../prompts/prompt-loader";
import { getPromptRegistry } from "../prompts/prompt-registry";

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
const text = (value: unknown, limit = 500) => typeof value === "string" ? value.slice(0, limit) : value ?? null;
const numeric = (value: unknown) => value == null ? null : Number(value);

function compactIntent(intent: StructuredIntent) {
  const keys: Array<keyof StructuredIntent> = [
    "language","dialect","purpose","inventoryMarket","locations","propertyTypes","bedrooms","bathrooms",
    "budgetMin","budgetMax","priceTarget","priceMin","priceMax","budgetFlexible","budgetFlexibility",
    "explicitRejectedPriceMin","explicitRejectedPriceMax","currency","deliveryMaxYears","maxDownPayment",
    "maxTravelMinutes","builtUpAreaMin","builtUpAreaMax","targetBuiltUpArea","preferredFloor","minimumFloor","maximumFloor",
    "preferredPhase","preferredProjectZone","preferredBuilding","preferredGate","maxGateDistanceMeters",
    "preferredPaymentDurationMonths","maxMonthlyInstallment","preferredDownPaymentPercent","proximityPreferences","hardRequirements",
    "softPreferences","rejectedLocations","rejectedProjects","preferredDevelopers","preferredProjects",
    "requestedProject","requestedMedia","purchaseIntent","turnIntent","aggregationDimension","externalUnitId",
    "preferredContactChannel","preferredConfirmationChannel","preferredPaymentMode","preferredVisitDayPart","preferredVisitTiming",
    "familyRequirements","investmentRequirements","customerConcerns","presentation",
  ];
  return Object.fromEntries(keys.flatMap((key) => intent[key] == null ? [] : [[key, intent[key]]]));
}

function paymentHighlight(plans: any[], intent: StructuredIntent) {
  if (!Array.isArray(plans) || !plans.length) return null;
  const byDuration = [...plans].sort((a,b) => Number(b.durationMonths ?? 0) - Number(a.durationMonths ?? 0));
  const byDownPayment = [...plans].sort((a,b) => Number(a.downPaymentAmount ?? a.downPayment ?? Infinity) - Number(b.downPaymentAmount ?? b.downPayment ?? Infinity));
  const preferred = intent.preferredPaymentDurationMonths != null ? [...plans].sort((a,b) => Math.abs(Number(a.durationMonths ?? 0)-intent.preferredPaymentDurationMonths!) - Math.abs(Number(b.durationMonths ?? 0)-intent.preferredPaymentDurationMonths!))[0] : null;
  const plan = preferred ?? (intent.maxDownPayment != null ? byDownPayment[0] : byDuration[0]);
  return {
    name: text(plan.name,80), durationMonths: plan.durationMonths ?? null,
    downPaymentAmount: numeric(plan.downPaymentAmount ?? plan.downPayment),
    downPaymentPercent: numeric(plan.downPaymentPercent), installmentAmount: numeric(plan.installmentAmount),
    installmentFrequency: plan.installmentFrequency ?? null, totalPrice: numeric(plan.totalPrice), currency: plan.currency ?? null,
    planType: plan.planType ?? "INSTALLMENT", reservationAmount: numeric(plan.reservationAmount),
    installmentEveryValue: plan.installmentEveryValue ?? null, installmentEveryUnit: plan.installmentEveryUnit ?? null,
    firstInstallmentTiming: plan.firstInstallmentTiming ?? null,
    firstInstallmentAfterValue: plan.firstInstallmentAfterValue ?? null,
    firstInstallmentAfterUnit: plan.firstInstallmentAfterUnit ?? null,
    distributionMode: plan.distributionMode ?? "EQUAL",
    percentageSchedule: Array.isArray(plan.percentageSchedule) ? plan.percentageSchedule.slice(0,24) : [],
  };
}

function propertyFact(value:any,intent:StructuredIntent){
  return {
    unitCode:value.externalUnitId??null,
    projectName:value.project?.nameAr??value.project?.nameEn??value.project?.name??null,
    developerName:value.developer?.nameAr??value.developer?.nameEn??value.developer?.brandName??value.developer?.name??value.project?.developer?.nameAr??value.project?.developer?.nameEn??value.project?.developer?.brandName??value.project?.developer?.name??null,
    location:value.project?.location?.nameAr??value.project?.location?.nameEn??value.project?.location?.name??null,
    formattedAddress:value.project?.formattedAddress??value.project?.location?.formattedAddress??null,
    projectLatitude:numeric(value.project?.latitude??value.project?.location?.latitude),
    projectLongitude:numeric(value.project?.longitude??value.project?.location?.longitude),
    unitType:value.unitType??null, bedrooms:value.bedrooms??null, bathrooms:value.bathrooms??null,
    builtUpArea:numeric(value.builtUpArea), price:numeric(value.price), currency:value.currency??null,
    availability:value.status??null, deliveryDate:value.deliveryDate??null, finishingType:value.finishingType??null,
    paymentPlan:value.bestPaymentPlan ?? paymentHighlight(value.paymentPlans,intent),
    internalLocation:{ floor:value.floor??null, phase:value.phaseRef?.nameAr??value.phaseRef?.nameEn??value.phaseRef?.name??value.phase??null, zone:value.projectZone?.nameAr??value.projectZone?.nameEn??value.projectZone?.name??value.cluster??null, building:value.projectBuilding?.nameAr??value.projectBuilding?.nameEn??value.projectBuilding?.name??value.building??null, buildingLatitude:numeric(value.projectBuilding?.latitude), buildingLongitude:numeric(value.projectBuilding?.longitude), unitLatitude:numeric(value.latitude), unitLongitude:numeric(value.longitude), closestGate:value.closestGate??null },
    offer:Array.isArray(value.offers)&&value.offers[0]?{title:text(value.offers[0].title,100),discountAmount:numeric(value.offers[0].discountAmount),endsAt:value.offers[0].endsAt??null}:null,
    // Ranking metadata stays server-side. It is not a verified property attribute.
  };
}

function projectCore(value:any){
  return {
    projectName:value.nameAr??value.nameEn??value.name??null,
    developerName:value.developer?.nameAr??value.developer?.nameEn??value.developer?.brandName??value.developer?.name??null,
    location:value.location?.nameAr??value.location?.nameEn??value.location?.name??null,
    formattedAddress:value.formattedAddress??value.location?.formattedAddress??null, projectTypes:(value.projectTypes?.length?value.projectTypes:[value.projectType].filter(Boolean)).slice(0,8), projectStatus:value.projectStatus??null,
    deliveryStatuses:(value.deliveryStatuses?.length?value.deliveryStatuses:[value.deliveryStatus].filter(Boolean)).slice(0,8), deliveryDate:value.deliveryDate??null, deliveryInformation:text(value.deliveryInformation,350),
    finishingOptions:value.finishingOptions?.slice?.(0,8)??[], unitTypes:value.unitTypes?.slice?.(0,10)??[],
    minArea:numeric(value.minArea), maxArea:numeric(value.maxArea), minBedrooms:value.minBedrooms??null, maxBedrooms:value.maxBedrooms??null,
    priceSummary:text(value.priceSummary,300), paymentSummary:text(value.paymentSummary,300),
    shortDescription:text(value.shortDescriptionAr??value.shortDescriptionEn??value.shortDescription,500), projectLatitude:numeric(value.latitude??value.location?.latitude), projectLongitude:numeric(value.longitude??value.location?.longitude),
    phases:Array.isArray(value.phases)?value.phases.slice(0,12).map((phase:any)=>({name:phase.nameAr??phase.nameEn??phase.name,launchYear:phase.launchYear??null,deliveryYear:phase.deliveryYear??null,status:phase.status??null,deliveryStatuses:phase.deliveryStatuses?.slice?.(0,6)??[],projectTypes:phase.projectTypes?.slice?.(0,6)??[],constructionPercentage:numeric(phase.constructionPercentage),unitTypes:phase.unitTypes?.slice?.(0,8)??[],finishingOptions:phase.finishingOptions?.slice?.(0,8)??[],customerFit:phase.customerFit?.slice?.(0,8)??[],minBedrooms:phase.minBedrooms??null,maxBedrooms:phase.maxBedrooms??null,minArea:numeric(phase.minArea),maxArea:numeric(phase.maxArea)})):[],
    competitors:Array.isArray(value.competitorsFrom)?value.competitorsFrom.slice(0,12).map((row:any)=>({projectName:row.competitorProject?.nameAr??row.competitorProject?.nameEn??row.competitorProject?.name??null,developerName:row.competitorProject?.developer?.nameAr??row.competitorProject?.developer?.nameEn??row.competitorProject?.developer?.name??null,location:row.competitorProject?.location?.nameAr??row.competitorProject?.location?.nameEn??row.competitorProject?.location?.name??null})).filter((row:any)=>row.projectName):[],
  };
}

function compactFact(value:any,kind:AIContextKind,intent:StructuredIntent){
  if(!value||typeof value!=="object")return value;
  if(kind==="PROPERTY_SEARCH"||kind==="COMPARISON")return propertyFact(value,intent);
  if(kind==="DEVELOPER_HISTORY")return{
    name:value.nameAr??value.nameEn??value.brandName??value.name,
    foundedYear:value.foundedYear??null,yearsInMarket:value.yearsInMarket??null,
    deliveredProjectsCount:value.deliveredProjectsCount??null,
    projectsUnderConstructionCount:value.projectsUnderConstructionCount??null,
    geographicFocus:value.geographicFocus?.slice?.(0,12)??[],specialties:value.specialties?.slice?.(0,12)??[],
    portfolio:value.portfolioProjects?.slice?.(0,20).map((p:any)=>({projectName:p.projectName,status:p.status,projectType:p.projectType,location:p.location?.name??p.locationText,launchYear:p.launchYear,deliveryYear:p.deliveryYear,unitsCount:p.unitsCount}))??[]
  };
  if(["INVESTMENT","RESALE","RENTAL"].includes(kind)){
    const segment=kind;
    const profiles=[
      ...(Array.isArray(value.marketProfiles)?value.marketProfiles:[]),
      ...(Array.isArray(value.phases)?value.phases.flatMap((phase:any)=>(phase.marketProfiles??[]).map((profile:any)=>({...profile,phaseName:phase.nameAr??phase.nameEn??phase.name}))):[]),
    ].filter((profile:any)=>String(profile.segment??"").toUpperCase()===segment).slice(0,16).map((profile:any)=>({
      scope:profile.unitId?"UNIT":profile.phaseId?"PHASE":"PROJECT",phaseName:profile.phaseName??null,propertyUse:profile.propertyUse??null,suitability:profile.suitability??null,demand:profile.demand??null,yieldMin:numeric(profile.yieldMin),yieldMax:numeric(profile.yieldMax),liquidity:profile.liquidity??null,targetCustomers:profile.targetCustomers?.slice?.(0,8)??[],advantages:profile.advantages?.slice?.(0,8)??[],risks:profile.risks?.slice?.(0,8)??[],metrics:profile.metrics??null,notes:text(profile.notes,350),source:text(profile.source,120),
    }));
    const legacy=value.investmentProfile??value;
    const legacyProfile=kind==="INVESTMENT"?{suitableForLiving:legacy.suitableForLiving,suitableForInvestment:legacy.suitableForInvestment,strongestUnitTypes:legacy.strongestUnitTypes?.slice?.(0,8)??[],targetCustomers:legacy.targetCustomers?.slice?.(0,8)??[],advantages:legacy.investmentAdvantages?.slice?.(0,8)??[],risks:legacy.investmentRisks?.slice?.(0,8)??[],notes:text(legacy.notes,350),source:text(legacy.source,120)}:kind==="RESALE"?{resaleDemand:legacy.resaleDemand,advantages:legacy.investmentAdvantages?.slice?.(0,5)??[],risks:legacy.investmentRisks?.slice?.(0,5)??[],source:text(legacy.source,120)}:{suitableForRental:legacy.suitableForRental,rentalDemand:legacy.rentalDemand,expectedRentalYieldMin:numeric(legacy.expectedRentalYieldMin),expectedRentalYieldMax:numeric(legacy.expectedRentalYieldMax),strongestUnitTypes:legacy.strongestUnitTypes?.slice?.(0,5)??[],source:text(legacy.source,120)};
    return {...projectCore(value),marketProfiles:profiles,legacyMarketProfile:profiles.length?undefined:legacyProfile};
  }
  if(kind==="AMENITIES")return{...projectCore(value),amenities:value.amenities?.slice?.(0,30).map((x:any)=>({name:x.amenity?.nameAr??x.amenity?.nameEn??x.amenity?.canonicalName,category:x.amenity?.category,notes:text(x.notes,120)}))??[]};
  if(kind==="MEDIA_REQUEST")return{type:value.type,url:value.url,altText:text(value.altTextAr??value.altTextEn??value.altText,160),caption:text(value.caption,160),isCover:Boolean(value.isCover)};
  if(kind==="BROCHURE_REQUEST")return{type:value.type,name:value.name,url:value.url,language:value.language??null};
  if(kind==="DISTANCE"){const route=value.routes?.[0]??{};const meters=value.distanceMeters??route.distanceMeters;const rawDuration=value.durationSeconds??value.duration??route.duration;const seconds=typeof rawDuration==="string"?Number.parseFloat(rawDuration):Number(rawDuration);return{source:value.source??value.distanceType,distanceKm:numeric(value.distanceKm??(meters!=null?Number(meters)/1000:null)),estimatedMinutes:value.estimatedMinutes??(Number.isFinite(seconds)?Math.round(seconds/60):null),from:value.from?.name??value.from,to:value.to?.name??value.to,destinationName:value.destinationName??null,notes:text(value.notes,200)}};
  if(kind==="AGGREGATION")return value;
  return{...projectCore(value),landmarks:value.landmarks?.slice?.(0,12).map((x:any)=>({name:x.name,category:x.category,distanceKm:numeric(x.distanceKm),estimatedMinutes:x.estimatedMinutes,distanceType:x.distanceType}))??[],amenities:value.amenities?.slice?.(0,20).map((x:any)=>x.amenity?.nameAr??x.amenity?.nameEn??x.amenity?.canonicalName)??[]};
}

function compactSummary(value:unknown,level:"normal"|"aggressive"){
  if(!value||typeof value!=="object")return value?text(value,level==="aggressive"?600:1200):undefined;
  const v=value as Record<string,any>;
  return{customerGoal:text(v.customerGoal,120),budget:v.budget??undefined,preferredLocations:v.preferredLocations?.slice?.(0,8),propertyTypes:v.propertyTypes?.slice?.(0,8),bedrooms:v.bedrooms,hardRequirements:v.hardRequirements?.slice?.(0,8),softPreferences:v.softPreferences?.slice?.(0,8),intentScore:v.intentScore};
}

export function compactAnswerInput(input:AnswerInput,level:"normal"|"aggressive"=input.compactionLevel??"normal"):AnswerInput{
  const kind=input.contextKind??"PROPERTY_SEARCH",candidateLimit=level==="aggressive"?3:5,historyLimit=level==="aggressive"?4:8;
  const selected=input.messages.slice(-historyLimit);
  return{
    ...input,
    messages:selected.map((m,index)=>({...m,content:m.content.slice(0,index===selected.length-1?3000:level==="aggressive"?700:1400)})),
    verifiedFacts:input.verifiedFacts.slice(0,candidateLimit).map(v=>compactFact(v,kind,input.intent)),
    approvedKnowledge:["PROJECT_DETAILS","INVESTMENT","RESALE","RENTAL","AMENITIES"].includes(kind)?(input.approvedKnowledge??[]).slice(0,level==="aggressive"?2:4).map((v:any)=>({category:v.category,content:text(v.content,level==="aggressive"?250:500)})):[],
    conversationSummary:compactSummary(input.conversationSummary,level),compactionLevel:level,
  };
}

function buildMessages(input:AnswerInput):AIMessage[]{
  const loader = getPromptLoader();
  const registry = getPromptRegistry();

  // Load versioned prompts
  const systemConfig = registry.get('advisor-system') || { name: 'advisor-system', version: 'v1', variant: 'control' };
  const contextConfig = registry.get('advisor-context') || { name: 'advisor-context', version: 'v1', variant: 'control' };

  const systemPrompt = loader.load(systemConfig.name, systemConfig.version);
  const contextPrompt = loader.load(contextConfig.name, contextConfig.version);

  const messages: AIMessage[] = [
    { role: "system", content: systemPrompt.template({}) },
  ];

  // Add conversation summary if present
  if (input.conversationSummary) {
    const summaryConfig = registry.get('conversation-summary') || { name: 'conversation-summary', version: 'v1' };
    const summaryPrompt = loader.load(summaryConfig.name, summaryConfig.version);
    messages.push({
      role: "system",
      content: summaryPrompt.template({ summary: JSON.stringify(input.conversationSummary) }),
    });
  }

  // Add conversation history with delimiters to prevent prompt injection
  const conversationHistory = input.messages.map((msg) => {
    if (msg.role === "user") {
      return { role: msg.role, content: `[USER INPUT START]\n${msg.content}\n[USER INPUT END]` };
    }
    return msg;
  });
  messages.push(...conversationHistory);

  // Add context injection
  messages.push({
    role: "user",
    content: contextPrompt.template({
      contextKind: input.contextKind ?? "PROPERTY_SEARCH",
      currentState: JSON.stringify(compactIntent(input.intent)),
      verifiedFacts: JSON.stringify(input.verifiedFacts),
      approvedKnowledge: JSON.stringify(input.approvedKnowledge ?? []),
    }),
  });

  return messages;
}

export function advisorMessages(input:AnswerInput):AIMessage[]{
  let compact=compactAnswerInput(input),messages=buildMessages(compact);
  if(bytes(messages)>64_000||Math.ceil(JSON.stringify(messages).length/4)>14_000){compact=compactAnswerInput(input,"aggressive");messages=buildMessages(compact)}
  return messages;
}

export function answerContextMetrics(input:AnswerInput,model="unknown",stream=false){
  const compact=compactAnswerInput(input),messages=advisorMessages(compact),body={model,messages,temperature:0.2,max_tokens:1000,...(stream?{stream:true}:{})};
  return{messages,bodyBytes:bytes(body),estimatedInputTokens:Math.ceil(JSON.stringify(messages).length/4),messageCount:messages.length,recentHistoryCount:compact.messages.length,resultCount:compact.verifiedFacts.length,verifiedContextBytes:bytes(compact.verifiedFacts),contextBytes:bytes(messages)};
}

/**
 * Get current prompt version for logging
 */
export function getCurrentPromptVersion(): string {
  const registry = getPromptRegistry();
  const systemConfig = registry.get('advisor-system');
  return systemConfig?.version ?? 'unknown';
}

/**
 * Get current prompt variant for A/B testing
 */
export function getCurrentPromptVariant(): string {
  const registry = getPromptRegistry();
  const systemConfig = registry.get('advisor-system');
  return systemConfig?.variant ?? 'control';
}
