import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { SignJWT } from "jose";

try { process.loadEnvFile(new URL("../.env", import.meta.url)); } catch { /* visual QA can still cover the public chat */ }

const output = new URL("./visual-qa/", import.meta.url);
await mkdir(output, { recursive: true });

const properties = [
  { id:"u-east", externalUnitId:"EG-301", unitType:"Apartment", bedrooms:3, bathrooms:3, builtUpArea:165, price:7_900_000, currency:"EGP", status:"AVAILABLE", deliveryDate:"2028-12-31", project:{name:"East Gardens",location:{name:"التجمع الخامس"}}, media:[], paymentPlans:[{durationMonths:96,downPaymentPercent:0.10,currency:"EGP"}] },
  { id:"u-cairo", externalUnitId:"CH-155", unitType:"Apartment", bedrooms:3, bathrooms:2, builtUpArea:155, price:8_800_000, currency:"EGP", status:"AVAILABLE", deliveryDate:"2029-12-31", project:{name:"Cairo Heights",location:{name:"القاهرة الجديدة"}}, media:[], paymentPlans:[{durationMonths:84,downPaymentPercent:0.15,currency:"EGP"}] },
];
const paymentResult = {unit:{id:"u-east",externalUnitId:"TEST-APT-301",projectId:"p-east",projectName:"East Gardens Test"},plans:[{id:"plan-east",name:"Controlled installment plan",durationMonths:96,downPaymentPercent:10,currency:"EGP",owner:{type:"UNIT",id:"u-east"}}]};
const ui = [{type:"PROPERTY_RESULTS",data:{properties}},{type:"PROPERTY_COMPARISON",data:{properties}},{type:"PAYMENT_PLANS",data:paymentResult}];
const messages = [
  {id:"m1",role:"USER",content:"أنا بدور على شقة 3 غرف في التجمع لحد 10 مليون.",createdAt:new Date().toISOString()},
  {id:"m2",role:"ASSISTANT",content:"لقيتلك اختيارين مناسبين 👇",toolPayload:{type:"nadim_v2",ui},createdAt:new Date().toISOString()},
];

async function mock(page) {
  await page.route("**/api/backend/v1/**", route => {
    const path = new URL(route.request().url()).pathname;
    if(path.endsWith("/conversations/visual-conversation/messages")) return route.fulfill({json:messages});
    if(path.endsWith("/conversations")) return route.fulfill({json:route.request().method()==="POST"?{id:"visual-conversation",title:"شقة 3 غرف في التجمع",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}:[]});
    if(path.endsWith("/admin/real-estate/dashboard")) return route.fulfill({json:{units:156,availableUnits:132,projects:18,developers:9,activeImports:1,importsNeedingInput:2,newLeads:12,followUps:28,mappedUnits:121,projectsWithBoundary:14,activePaymentPlans:31,pendingKnowledge:3,conversations24h:156}});
    if(path.endsWith("/admin/imports")) return route.fulfill({json:{items:[],total:0}});
    if(path.endsWith("/admin/leads/summary")) return route.fulfill({json:{newLeads:12,highIntent:7,followUpsDue:28,thisWeek:41,trustAlertsOpen:2}});
    if(path.endsWith("/admin/system/ai-health")) return route.fulfill({json:[{provider:"bedrock-glm",healthy:true,model:"zai.glm-5"},{provider:"groq",healthy:true,model:"fallback"}]});
    return route.fulfill({status:404,json:{message:"visual fixture not found"}});
  });
  await page.route("**/api/nadim/turn", route => route.fulfill({json:{conversationId:"nadim-visual",reply:messages[1].content,message:messages[1],ui,suppressReply:false,mode:"AI",state:{languageStyle:{preferredResponseStyle:"AR_EGYPTIAN"}}}}));
  await page.addInitScript(() => {
    localStorage.setItem("cgai-active-conversation", "visual-conversation");
    localStorage.setItem("cgai-conversations", JSON.stringify([{id:"visual-conversation",title:"شقة 3 غرف في التجمع",updatedAt:"الآن",nadimConversationId:"nadim-visual",mode:"AI",messages:[]} ]));
    localStorage.setItem("cgai-cache-version", "3");
  });
}

const browser = await chromium.launch({ headless:true });
const findings = [];
for (const target of [
  {name:"chat-desktop-rtl",viewport:{width:1440,height:1000},url:"http://127.0.0.1:3000/"},
  {name:"chat-mobile-rtl",viewport:{width:390,height:844},url:"http://127.0.0.1:3000/"},
  {name:"dashboard-desktop-rtl",viewport:{width:1440,height:1000},url:"http://127.0.0.1:3000/admin"},
]) {
  const context = await browser.newContext({ viewport:target.viewport, locale:"ar-EG", colorScheme:"light" });
  if(target.name.startsWith("dashboard-") && process.env.ADMIN_JWT_SECRET) {
    const token=await new SignJWT({sub:"visual-qa",role:"ADMIN"}).setProtectedHeader({alg:"HS256"}).setIssuer("maqar-api").setAudience("maqar-admin").setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(process.env.ADMIN_JWT_SECRET));
    await context.addCookies([{name:"maqar_admin_session",value:token,url:"http://127.0.0.1:3000",httpOnly:true,sameSite:"Lax"}]);
  }
  const page = await context.newPage();
  const errors=[];
  page.on("console", message => { if(message.type()==="error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));
  await mock(page);
  await page.goto(target.url, { waitUntil:"networkidle" });
  await page.waitForTimeout(1500);
  if(target.name.startsWith("chat-")) {
    await page.getByRole("button",{name:"وحدة في حدود 5 مليون"}).click();
    const send=page.getByRole("button",{name:"إرسال"});
    await send.click();
    await page.getByText("East Gardens").first().waitFor({timeout:3000}).catch(()=>undefined);
    await page.waitForTimeout(900);
  }
  await page.screenshot({path:fileURLToPath(new URL(`${target.name}.png`,output)),fullPage:true});
  const metrics = await page.evaluate(() => ({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,dir:document.documentElement.dir,lang:document.documentElement.lang,badFractionalPercent:document.body.innerText.includes("0.1%")||document.body.innerText.includes("0.15%"),hasNormalizedPercent:document.body.innerText.includes("10%")&&document.body.innerText.includes("15%")}));
  findings.push({target:target.name,metrics,errors});
  if(target.name==="chat-desktop-rtl") {
    await page.getByRole("button",{name:"Switch to English"}).click();
    await page.screenshot({path:fileURLToPath(new URL("chat-desktop-ltr.png",output)),fullPage:true});
  }
  await context.close();
}
await browser.close();
await writeFile(new URL("findings.json",output),JSON.stringify(findings,null,2));
if(findings.some(item=>item.errors.length||item.metrics.scrollWidth>item.metrics.clientWidth||item.metrics.badFractionalPercent||(item.target.startsWith("chat-")&&!item.metrics.hasNormalizedPercent))) process.exitCode=1;
