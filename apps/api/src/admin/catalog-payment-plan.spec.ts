import * as assert from "node:assert/strict";
import { test } from "node:test";
import { CatalogController } from "./catalog.controller";

test("manual project payment plan persists and reloads without a unit owner", async () => {
  const plans:any[]=[];
  const prisma:any={
    project:{findUniqueOrThrow:async ({include}:any)=>include?{id:"project-1",name:"Project",developer:{},location:null,media:[],documents:[],amenities:[],investmentProfile:null,landmarks:[],competitorsFrom:[],paymentPlans:plans,_count:{units:0,knowledgeItems:0}}:{id:"project-1"}},
    paymentPlan:{create:async ({data}:any)=>{const plan={id:`plan-${plans.length+1}`,isActive:true,...data};plans.push(plan);return plan;}},
  };
  const audits:any[]=[];
  const controller=new CatalogController(prisma,{record:async (...args:any[])=>audits.push(args)} as any,{} as any,{invalidateCustomerData:()=>undefined} as any);
  const created:any=await controller.projectPaymentPlan("project-1",{name:"8 years",durationMonths:96,downPaymentPercent:10,currency:"EGP",installmentFrequency:"QUARTERLY"},{admin:{id:"admin-1"}});
  assert.equal(created.projectId,"project-1");
  assert.equal(created.unitId,undefined);
  const reloaded:any=await controller.project("project-1");
  assert.equal(reloaded.paymentPlans.length,1);
  assert.equal(reloaded.paymentPlans[0].durationMonths,96);
  assert.equal(audits[0][1],"PROJECT_PAYMENT_PLAN_CREATED");
});
