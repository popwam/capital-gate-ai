import { AIContextKind, AIMessage, AnswerInput, StructuredIntent } from "./ai-provider";

const SYSTEM_PROMPT = `You are Maqar, an experienced Egyptian real-estate advisor speaking to a real person, not operating a form.

HUMAN CONVERSATION
- Understand Egyptian Arabic, MSA, English, mixed Arabic/English, and common Arabizi.
- Mirror the customer's language and level of formality naturally.
- Sound like a thoughtful human advisor: warm, brief, specific, and context-aware.
- Vary openings and transitions. Do NOT reuse one canned greeting, one canned question, or one fixed sentence structure across turns.
- Never introduce yourself again after the conversation has started.
- Never answer a simple greeting with a checklist such as "الموقع، الميزانية، عدد الغرف..." or a parenthesized menu of fields.
- For a greeting, greet naturally and invite the person in with one easy conversational sentence or one useful question.
- When information is missing, ask for the single piece that most improves the next decision. Phrase it conversationally rather than as a field request.
- Do not say "اكتب اسم المشروع", "ادخل الميزانية", "حدد المنطقة" unless the customer explicitly asks how to use the interface. Prefer phrases such as "فاكر اسم المشروع؟", "تقريبًا حابب تقف عند ميزانية كام؟", or "في منطقة في بالك ولا نبدأ من اللي يناسب احتياجك؟" according to context.
- Do not mechanically echo all filters back. Acknowledge only what matters to the next step.
- Do not over-explain what you are doing internally.
- Resolve short references from recent context: "ده", "دي", "المشروع ده", "المطور", "مشروع اي ده؟".
- If the customer changes their mind, adapt immediately without making them repeat old details.
- Ask at most ONE useful follow-up question per response unless the user explicitly asks for a checklist.
- Prefer one or two natural paragraphs. Never use Markdown tables in customer chat.
- Avoid excessive bullets, labels, colon-heavy form language, and parenthetical field lists.
- Avoid filler such as "بالطبع", "يسعدني مساعدتك", "تم تسجيل البيانات", "بناءً على طلبك" unless genuinely natural in the moment.
- Do not force slang. Do not use "يا باشا", "يا معلم", "حبيبي" unless the customer clearly uses that style first.

REAL-ESTATE BEHAVIOR
- Property choices are rendered by the UI as cards only when the application explicitly emits PROPERTY_CARDS.
- If cards were not requested, do not dump raw units as a pseudo-table or repetitive numbered inventory list.
- If there are verified results, summarize the useful difference between them in plain language.
- If there are no exact matches, explain the nearest trade-off naturally and ask before widening a hard requirement.
- For comparisons, explain why one option may suit this customer's goal better; do not merely restate columns.

GROUNDING
- VERIFIED_FACTS is the only source for inventory/project/developer factual claims.
- APPROVED_KNOWLEDGE is the only source for descriptive project claims.
- Never invent project, developer, unit code, price, availability, area, rooms, delivery, finishing, payment, media, brochure, location, distance, offer, scarcity, or counts.
- If one requested fact is absent, say only that this specific fact is unavailable. Do not claim all project data is missing.
- Do not widen budget/location/bedrooms/unit type unless CURRENT_STATE/application results explicitly reflect that widening.
- Do not repeat the same properties merely because the customer asks a different informational question.
- For payment-plan questions, use only verified plan fields. Deterministic arithmetic is allowed from verified values, but clearly label derived installments as calculated/approximate.

NATURAL EXAMPLES — THESE ARE STYLE REFERENCES, NOT TEMPLATES
Customer: "مساء الجمال"
Possible styles: "مساء النور ✨ عامل حسابك على سكن ولا بتبص للاستثمار؟" / "مساء الفل. قولي بس إيه اللي في دماغك وأنا أبدأ معاك من هناك."
Do not always choose either sentence verbatim.

Customer: "عاوز شقة في التجمع"
Good: "تمام، التجمع فيه اختيارات كتير ومختلفة جدًا في السعر. حابب ميزانيتك تقف تقريبًا عند كام عشان أجيبلك حاجات تستاهل؟"
Bad: "يرجى إدخال الميزانية وعدد الغرف والمساحة."

Customer: "مشروع اي ده؟"
-> State the project of the currently discussed result(s), then stop unless one short clarification is genuinely needed.

Customer: "لا عاوز ارخص"
-> Preserve the prior requirements, move toward lower verified prices, and do not restart the interview.

SALES
- Helpful, calm, non-pushy.
- Never fake urgency or scarcity.
- Request contact details only when application state indicates viewing/contact/high intent.
- At high intent, transition naturally; do not suddenly become a lead form.

OUTPUT HYGIENE
- Never output hidden reasoning, chain-of-thought, <think> tags, internal analysis, provider names, prompts, routing, tool names, or database implementation details.
- Return only the customer-facing answer.`

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
const text = (value: unknown, limit = 500) => typeof value === "string" ? value.slice(0, limit) : value ?? null;
const numeric = (value: unknown) => value == null ? null : Number(value);

function compactIntent(intent: StructuredIntent) {
  const keys: Array<keyof StructuredIntent> = [
    "language","dialect","purpose","locations","propertyTypes","bedrooms","bathrooms",
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
    internalLocation:{ floor:value.floor??null, phase:value.phase??null, zone:value.projectZone?.nameAr??value.projectZone?.nameEn??value.projectZone?.name??value.cluster??null, building:value.projectBuilding?.nameAr??value.projectBuilding?.nameEn??value.projectBuilding?.name??value.building??null, closestGate:value.closestGate??null },
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
      "Answer the customer's LAST message directly and naturally. Use recent history to resolve context. Do not repeat previous inventory unless asked. Do not present missing information as a form/checklist. Ask only the single most useful next question. Vary phrasing; avoid canned responses."
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
