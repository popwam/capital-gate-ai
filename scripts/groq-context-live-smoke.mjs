import "dotenv/config";
import assert from "node:assert/strict";
import { GroqProvider } from "../apps/api/dist/providers/groq.provider.js";
import { answerContextMetrics } from "../apps/api/dist/providers/ai-context.js";

assert.ok(process.env.GROQ_API_KEY, "GROQ_API_KEY is required");
const groq = new GroqProvider();
groq.validateConfiguration();
const rich = Array.from({length:8},(_,index)=>({id:`unit-${index}`,externalUnitId:`LIVE-${index}`,unitType:"Apartment",bedrooms:2,bathrooms:2,builtUpArea:150+index,price:8_000_000+index,currency:"EGP",status:"AVAILABLE",finishingType:"FINISHED",project:{name:"Verified Project",location:{name:"New Cairo"},amenities:Array(30).fill({amenity:{canonicalName:"Clubhouse"}}),investmentProfile:{notes:"x".repeat(10_000)},media:Array(30).fill({url:"https://example.invalid/image"}),documents:Array(20).fill({url:"https://example.invalid/document"}),knowledgeItems:Array(30).fill({content:"x".repeat(1000)})},developer:{name:"Verified Developer",portfolioProjects:Array(40).fill({projectName:"History"})},paymentPlans:Array.from({length:20},(_,i)=>({durationMonths:60+i,downPaymentAmount:1_000_000+i,totalPrice:9_000_000+i,currency:"EGP"}))}));
const propertyInput={messages:[{role:"user",content:"عايز شقة غرفتين في التجمع في حدود 10 مليون"}],intent:{language:"ar-EG",locations:["New Cairo"],propertyTypes:["Apartment"],bedrooms:2,budgetMax:10_000_000,currency:"EGP"},verifiedFacts:rich,contextKind:"PROPERTY_SEARCH",candidatesBeforeRanking:8,requestId:"live-groq-property",conversationId:"sanitized-smoke"};
const metrics=answerContextMetrics(propertyInput,process.env.GROQ_MODEL||"openai/gpt-oss-120b",true);
const legacyMessages=[{role:"system",content:"Legacy advisor prompt"},...propertyInput.messages.slice(-10),{role:"user",content:`CURRENT_STATE=${JSON.stringify(propertyInput.intent)}\nVERIFIED_FACTS=${JSON.stringify(propertyInput.verifiedFacts)}\nAPPROVED_KNOWLEDGE=[]`}];
const legacyBody=JSON.stringify({model:process.env.GROQ_MODEL||"openai/gpt-oss-120b",messages:legacyMessages,temperature:0.2,max_tokens:1000,stream:true});
const legacyBodyBytes=Buffer.byteLength(legacyBody,"utf8"),legacyEstimatedInputTokens=Math.ceil(JSON.stringify(legacyMessages).length/4);
assert.equal(metrics.resultCount,5);assert.ok(metrics.bodyBytes<64_000);
const simple=await groq.composeAnswer({messages:[{role:"user",content:"مساء الخير"}],intent:{language:"ar-EG"},verifiedFacts:[],contextKind:"PROPERTY_SEARCH",requestId:"live-groq-arabic",conversationId:"sanitized-smoke"});assert.ok(simple.length>0);
let streamed="";for await(const chunk of groq.streamAnswer(propertyInput))streamed+=chunk;assert.ok(streamed.length>0);
const second=await groq.composeAnswer({...propertyInput,messages:[...propertyInput.messages,{role:"assistant",content:"عرضت خيارات موثقة."},{role:"user",content:"طب إيه أفضل خطة سداد؟"}],requestId:"live-groq-second-turn"});assert.ok(second.length>0);
console.log(JSON.stringify({arabic:"PASS",propertySearch:"PASS",secondTurn:"PASS",streaming:"PASS",before:{bodyBytes:legacyBodyBytes,estimatedInputTokens:legacyEstimatedInputTokens,candidatesSent:8,historyMessages:1},after:{bodyBytes:metrics.bodyBytes,estimatedInputTokens:metrics.estimatedInputTokens,candidatesSent:metrics.resultCount,historyMessages:metrics.recentHistoryCount}}));
