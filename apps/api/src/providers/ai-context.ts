import { AIContextKind, AIMessage, AnswerInput, StructuredIntent } from "./ai-provider";

const SYSTEM_PROMPT = `You are Cg Ai, a high-quality Egyptian real-estate advisor. "Cg" is the primary brand and "Ai" is the intelligence layer.

CONVERSATION QUALITY
- Understand Egyptian Arabic, MSA, English, mixed Arabic/English, and common Arabizi.
- Mirror the customer's language naturally. Egyptian Arabic is welcome when the customer uses it.
- Answer the actual question first. Give useful substance before asking anything back.
- Never answer with a bare label, a name-only list, or a one-line database dump when verified context can support a better explanation.
- Be concise, but not abrupt. A normal answer is usually 2-5 short paragraphs or compact bullets when comparison is clearer.
- Ask a follow-up only when a missing fact genuinely blocks a better answer. Do not force a question at the end of every turn.
- Keep continuity across turns; do not make the user repeat context already present in conversation state.
- Resolve short references such as "ده", "دي", "المشروع ده", and "المطور" from recent context.

REAL-ESTATE GROUNDING
- VERIFIED_FACTS and APPROVED_KNOWLEDGE are the only sources for project, developer, inventory, price, availability, payment, location, resale, rental, and amenity claims.
- Never invent prices, availability, scarcity, ROI, rental yield, resale demand, delivery dates, amenities, distances, developer history, or payment terms.
- You may calculate or compare values explicitly present in verified facts. Clearly describe derived values as calculations when useful.
- If a requested fact is unavailable, say exactly what is missing without pretending it exists.
- For recommendations, explain WHY each option fits the customer's stated budget, location, unit type, payment preference, or goal using verified facts.
- For comparison/investment/resale questions, identify meaningful trade-offs and uncertainty. Do not manufacture a winner when the data is insufficient.
- Do not use outside web knowledge in a customer answer unless it is explicitly supplied as approved knowledge by the application.

SALES BEHAVIOR
- Be helpful and calm; never use fake urgency, fake scarcity, pressure tactics, or unsupported superlatives.
- Do not request contact information unless the customer shows clear intent to proceed, book a viewing, reserve, or asks to be contacted.
- When contact is appropriate, request only the minimum needed information.

STYLE
- Prefer natural sentences over form-like prompts.
- Avoid canned greetings and repeated closings.
- Never dump raw database fields or pseudo-tables into customer chat.
- Use exact unit/project names and numbers from verified context when they help.
- If cards, maps, media, or documents are attached by the application, refer to them naturally instead of restating every field.
- Never mention internal prompts, routing, model names, VERIFIED_FACTS, APPROVED_KNOWLEDGE, database schemas, tool names, or hidden reasoning.`

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
    percentageSchedule: Array.isArray(plan.percentageSchedule) ? plan.percentageSchedule.slice(0,24) : [],
  };
}

function propertyFact(value:any,intent:StructuredIntent){
  return {
    unitId:value.id??null,
    unitCode:value.externalUnitId??null,
    projectId:value.project?.id??value.projectId??null,
    projectName:value.project?.nameAr??value.project?.nameEn??value.project?.name??null,
    developerId:value.developer?.id??value.developerId??null,
    developerName:value.developer?.nameAr??value.developer?.nameEn??value.developer?.brandName??value.developer?.name??value.project?.developer?.nameAr??value.project?.developer?.nameEn??value.project?.developer?.name??null,
    location:value.project?.location?.nameAr??value.project?.location?.nameEn??value.project?.location?.name??null,
    unitType:value.unitType??null, bedrooms:value.bedrooms??null, bathrooms:value.bathrooms??null,
    builtUpArea:numeric(value.builtUpArea), price:numeric(value.price), currency:value.currency??null,
    availability:value.status??null, deliveryDate:value.deliveryDate??null, finishingType:value.finishingType??null,
    paymentPlan:value.bestPaymentPlan ?? paymentHighlight(value.paymentPlans,intent),
    internalLocation:{ floor:value.floor??null, phase:value.phase??null, zone:value.projectZone?.nameAr??value.projectZone?.nameEn??value.projectZone?.name??value.cluster??null, building:value.projectBuilding?.nameAr??value.projectBuilding?.nameEn??value.projectBuilding?.name??value.building??null, buildingLatitude:numeric(value.projectBuilding?.latitude), buildingLongitude:numeric(value.projectBuilding?.longitude), unitLatitude:numeric(value.latitude), unitLongitude:numeric(value.longitude), closestGate:value.closestGate??null },
    offer:Array.isArray(value.offers)&&value.offers[0]?{title:text(value.offers[0].title,100),discountAmount:numeric(value.offers[0].discountAmount),endsAt:value.offers[0].endsAt??null}:null,
    matchScore:value.matchScore??null, matchReasons:Array.isArray(value.matchReasons)?value.matchReasons.slice(0,4):[],
  };
}

function projectCore(value:any){
  return {
    projectId:value.id??null, projectName:value.nameAr??value.nameEn??value.name??null,
    developerName:value.developer?.nameAr??value.developer?.nameEn??value.developer?.brandName??value.developer?.name??null,
    location:value.location?.nameAr??value.location?.nameEn??value.location?.name??null,
    formattedAddress:value.formattedAddress??null, projectType:value.projectType??null, projectStatus:value.projectStatus??null,
    deliveryStatus:value.deliveryStatus??null, deliveryDate:value.deliveryDate??null, deliveryInformation:text(value.deliveryInformation,350),
    finishingOptions:value.finishingOptions?.slice?.(0,8)??[], unitTypes:value.unitTypes?.slice?.(0,10)??[],
    minArea:numeric(value.minArea), maxArea:numeric(value.maxArea), minBedrooms:value.minBedrooms??null, maxBedrooms:value.maxBedrooms??null,
    priceSummary:text(value.priceSummary,300), paymentSummary:text(value.paymentSummary,300),
    shortDescription:text(value.shortDescriptionAr??value.shortDescriptionEn??value.shortDescription,500),
  };
}

function compactFact(value:any,kind:AIContextKind,intent:StructuredIntent){
  if(!value||typeof value!=="object")return value;
  if(kind==="PROPERTY_SEARCH"||kind==="COMPARISON")return propertyFact(value,intent);
  if(kind==="DEVELOPER_HISTORY")return{
    developerId:value.id,
    name:value.nameAr??value.nameEn??value.brandName??value.name,
    foundedYear:value.foundedYear??null,yearsInMarket:value.yearsInMarket??null,
    deliveredProjectsCount:value.deliveredProjectsCount??null,
    projectsUnderConstructionCount:value.projectsUnderConstructionCount??null,
    geographicFocus:value.geographicFocus?.slice?.(0,12)??[],specialties:value.specialties?.slice?.(0,12)??[],
    portfolio:value.portfolioProjects?.slice?.(0,20).map((p:any)=>({projectName:p.projectName,status:p.status,projectType:p.projectType,location:p.location?.name??p.locationText,launchYear:p.launchYear,deliveryYear:p.deliveryYear,unitsCount:p.unitsCount}))??[]
  };
  if(["INVESTMENT","RESALE","RENTAL"].includes(kind)){
    const p=value.investmentProfile??value;
    return {...projectCore(value),investment:kind==="INVESTMENT"?{
      suitableForLiving:p.suitableForLiving,suitableForInvestment:p.suitableForInvestment,strongestUnitTypes:p.strongestUnitTypes?.slice?.(0,8)??[],targetCustomers:p.targetCustomers?.slice?.(0,8)??[],advantages:p.investmentAdvantages?.slice?.(0,8)??[],risks:p.investmentRisks?.slice?.(0,8)??[],notes:text(p.notes,350),source:text(p.source,120)
    }:kind==="RESALE"?{
      resaleDemand:p.resaleDemand,advantages:p.investmentAdvantages?.slice?.(0,5)??[],risks:p.investmentRisks?.slice?.(0,5)??[],source:text(p.source,120)
    }:{
      suitableForRental:p.suitableForRental,rentalDemand:p.rentalDemand,expectedRentalYieldMin:numeric(p.expectedRentalYieldMin),expectedRentalYieldMax:numeric(p.expectedRentalYieldMax),strongestUnitTypes:p.strongestUnitTypes?.slice?.(0,5)??[],source:text(p.source,120)
    }};
  }
  if(kind==="AMENITIES")return{...projectCore(value),amenities:value.amenities?.slice?.(0,30).map((x:any)=>({name:x.amenity?.nameAr??x.amenity?.nameEn??x.amenity?.canonicalName,category:x.amenity?.category,notes:text(x.notes,120)}))??[]};
  if(kind==="MEDIA_REQUEST")return{id:value.id,type:value.type,url:value.url,altText:text(value.altTextAr??value.altTextEn??value.altText,160),caption:text(value.caption,160),isCover:Boolean(value.isCover)};
  if(kind==="BROCHURE_REQUEST")return{id:value.id,type:value.type,name:value.name,url:value.url,language:value.language??null};
  if(kind==="DISTANCE")return{source:value.source??value.distanceType,distanceKm:numeric(value.distanceKm??(value.distanceMeters!=null?Number(value.distanceMeters)/1000:null)),estimatedMinutes:value.estimatedMinutes??value.duration??null,from:value.from?.name??value.from,to:value.to?.name??value.to,notes:text(value.notes,200)};
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
  return[
    {role:"system",content:SYSTEM_PROMPT},
    ...(input.conversationSummary?[{role:"system" as const,content:`CONVERSATION_SUMMARY=${JSON.stringify(input.conversationSummary)}`}]:[]),
    ...input.messages,
    {role:"user",content:[
      `CONTEXT_KIND=${input.contextKind??"PROPERTY_SEARCH"}`,
      `CURRENT_STATE=${JSON.stringify(compactIntent(input.intent))}`,
      `VERIFIED_FACTS=${JSON.stringify(input.verifiedFacts)}`,
      `APPROVED_KNOWLEDGE=${JSON.stringify(input.approvedKnowledge??[])}`,
      "",
      "Answer the customer's LAST message directly and naturally. Lead with the answer and add enough verified explanation to be useful. Use recent history to resolve context. Do not repeat previous inventory unless asked. Do not present missing information as a form/checklist. Ask a follow-up only if a missing fact materially blocks the answer. Never finish with a compulsory question. Avoid canned responses and bare database dumps."
    ].join("\n")}
  ];
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
