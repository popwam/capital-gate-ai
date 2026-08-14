"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { adminApi, adminErrorMessage } from "@/lib/api";

type Gate = { id:string; name:string; nameAr?:string|null; nameEn?:string|null; code?:string|null; gateNumber?:number|null; latitude?:string|number|null; longitude?:string|number|null; isMain:boolean; isActive:boolean; notes?:string|null };
type Building = { id:string; name:string; nameAr?:string|null; code?:string|null; zoneId?:string|null };
type Zone = { id:string; name:string; nameAr?:string|null; code?:string|null; buildings?:Building[] };
type Unit = { id:string; externalUnitId:string; floor?:string|null; projectZoneId?:string|null; projectBuildingId?:string|null; internalLocationDescription?:string|null; projectZone?:Zone|null; projectBuilding?:Building|null };
type Proximity = { id:string; targetType:string; gateId?:string|null; distanceMeters?:number|null; walkingMinutes?:number|null; verified:boolean; gate?:Gate|null };

export function ProjectSpatialEditor({ projectId }:{ projectId:string }) {
  const [gates,setGates]=useState<Gate[]>([]);
  const [zones,setZones]=useState<Zone[]>([]);
  const [units,setUnits]=useState<Unit[]>([]);
  const [selectedUnitId,setSelectedUnitId]=useState("");
  const [proximities,setProximities]=useState<Proximity[]>([]);
  const [error,setError]=useState("");
  const [saving,setSaving]=useState(false);
  const buildings=useMemo(()=>zones.flatMap(z=>z.buildings||[]),[zones]);
  const selectedUnit=units.find(u=>u.id===selectedUnitId);

  const load=async()=>{
    if(!projectId)return;
    setError("");
    try{
      const [project,unitResult]=await Promise.all([
        adminApi.get<any>(`/real-estate/projects/${projectId}`),
        adminApi.get<any>(`/catalog/units?projectId=${encodeURIComponent(projectId)}&pageSize=100`),
      ]);
      setGates(Array.isArray(project.gates)?project.gates:[]);
      setZones(Array.isArray(project.zones)?project.zones:[]);
      const nextUnits=Array.isArray(unitResult?.items)?unitResult.items:[];
      setUnits(nextUnits);
      setSelectedUnitId(current=>current&&nextUnits.some((u:Unit)=>u.id===current)?current:(nextUnits[0]?.id||""));
    }catch(e){setError(adminErrorMessage(e));}
  };
  useEffect(()=>{void load();},[projectId]);
  useEffect(()=>{if(!selectedUnitId){setProximities([]);return;} adminApi.get<Proximity[]>(`/real-estate/units/${selectedUnitId}/proximities`).then(setProximities).catch(e=>setError(adminErrorMessage(e)));},[selectedUnitId]);

  async function run(action:()=>Promise<unknown>,form?:HTMLFormElement){setSaving(true);setError("");try{await action();form?.reset();await load();if(selectedUnitId){setProximities(await adminApi.get<Proximity[]>(`/real-estate/units/${selectedUnitId}/proximities`));}}catch(err){setError(adminErrorMessage(err));}finally{setSaving(false);}}
  async function addGate(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget,f=new FormData(form);await run(()=>adminApi.post(`/real-estate/projects/${projectId}/gates`,{name:String(f.get("name")||"").trim(),nameAr:String(f.get("nameAr")||"").trim()||undefined,nameEn:String(f.get("nameEn")||"").trim()||undefined,code:String(f.get("code")||"").trim()||undefined,gateNumber:f.get("gateNumber")?Number(f.get("gateNumber")):undefined,latitude:f.get("latitude")?Number(f.get("latitude")):undefined,longitude:f.get("longitude")?Number(f.get("longitude")):undefined,isMain:f.get("isMain")==="on",notes:String(f.get("notes")||"").trim()||undefined}),form);}
  async function addZone(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget,f=new FormData(form);await run(()=>adminApi.post(`/real-estate/projects/${projectId}/zones`,{name:String(f.get("name")||"").trim(),code:String(f.get("code")||"").trim()||undefined,nameAr:String(f.get("nameAr")||"").trim()||undefined,nameEn:String(f.get("nameEn")||"").trim()||undefined}),form);}
  async function addBuilding(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget,f=new FormData(form);await run(()=>adminApi.post(`/real-estate/projects/${projectId}/buildings`,{name:String(f.get("name")||"").trim(),nameAr:String(f.get("nameAr")||"").trim()||undefined,code:String(f.get("code")||"").trim()||undefined,zoneId:String(f.get("zoneId")||"")||undefined,latitude:f.get("latitude")?Number(f.get("latitude")):undefined,longitude:f.get("longitude")?Number(f.get("longitude")):undefined}),form);}
  async function saveUnitLocation(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!selectedUnitId)return;const f=new FormData(e.currentTarget);await run(()=>adminApi.patch(`/real-estate/units/${selectedUnitId}/internal-location`,{projectZoneId:String(f.get("projectZoneId")||"")||undefined,projectBuildingId:String(f.get("projectBuildingId")||"")||undefined,floor:String(f.get("floor")||"").trim()||undefined,latitude:f.get("latitude")?Number(f.get("latitude")):undefined,longitude:f.get("longitude")?Number(f.get("longitude")):undefined,internalLocationDescription:String(f.get("internalLocationDescription")||"").trim()||undefined}));}
  async function addGateDistance(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!selectedUnitId)return;const form=e.currentTarget,f=new FormData(form);const gateId=String(f.get("gateId")||"");if(!gateId)return;await run(()=>adminApi.post(`/real-estate/units/${selectedUnitId}/proximities`,{targetType:"GATE",gateId,distanceMeters:f.get("distanceMeters")?Number(f.get("distanceMeters")):undefined,walkingMinutes:f.get("walkingMinutes")?Number(f.get("walkingMinutes")):undefined,source:"ADMIN",verified:true}),form);}
  async function removeProximity(id:string){if(!confirm("حذف قياس القرب ده؟"))return;await run(()=>adminApi.delete(`/real-estate/proximities/${id}`));}

  const input="h-11 rounded-xl border border-[#d9ddd8] bg-white px-3 text-sm outline-none focus:border-[#8eaaa0]";
  return <section className="mt-6 rounded-[22px] border bg-white p-5" dir="rtl">
    <div className="mb-5"><h2 className="text-lg font-bold">الموقع الداخلي للمشروع والوحدات</h2><p className="mt-1 text-sm leading-6 text-[#68756f]">سجّل كل البوابات والمناطق والمباني، وبعدها اربط كل وحدة بمكانها الحقيقي. المشروع لا يُفترض له بوابة واحدة.</p></div>
    {error&&<div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <div className="grid gap-5 xl:grid-cols-3">
      <div><h3 className="mb-2 font-bold">البوابات ({gates.length})</h3><div className="mb-3 max-h-52 space-y-2 overflow-auto">{gates.map(g=><div key={g.id} className="rounded-xl bg-[#f5f4ef] p-3 text-sm"><b>{g.nameAr||g.name}</b>{g.isMain&&<span className="mr-2 rounded bg-[#dfeee7] px-2 py-1 text-xs">رئيسية</span>}<div className="mt-1 text-xs text-[#77827d]">{g.code||"بدون كود"}{g.gateNumber?` · بوابة ${g.gateNumber}`:""}</div></div>)}</div><form onSubmit={addGate} className="grid gap-2"><input required name="name" placeholder="اسم البوابة" className={input}/><div className="grid grid-cols-2 gap-2"><input name="nameAr" placeholder="العربي" className={input}/><input name="nameEn" placeholder="English" className={input}/></div><div className="grid grid-cols-2 gap-2"><input name="code" placeholder="الكود" className={input}/><input name="gateNumber" type="number" min="1" placeholder="رقم البوابة" className={input}/></div><div className="grid grid-cols-2 gap-2"><input name="latitude" type="number" step="any" placeholder="Latitude" className={input}/><input name="longitude" type="number" step="any" placeholder="Longitude" className={input}/></div><label className="flex items-center gap-2 text-sm"><input name="isMain" type="checkbox"/> بوابة رئيسية</label><button disabled={saving} className="h-11 rounded-xl bg-forest font-bold text-white">إضافة بوابة</button></form></div>
      <div><h3 className="mb-2 font-bold">المناطق الداخلية ({zones.length})</h3><div className="mb-3 max-h-52 space-y-2 overflow-auto">{zones.map(z=><div key={z.id} className="rounded-xl bg-[#f5f4ef] p-3 text-sm"><b>{z.nameAr||z.name}</b><div className="text-xs text-[#77827d]">{z.buildings?.length||0} مبنى</div></div>)}</div><form onSubmit={addZone} className="grid gap-2"><input required name="name" placeholder="اسم Zone" className={input}/><div className="grid grid-cols-2 gap-2"><input name="nameAr" placeholder="العربي" className={input}/><input name="nameEn" placeholder="English" className={input}/></div><input name="code" placeholder="الكود" className={input}/><button disabled={saving} className="h-11 rounded-xl bg-forest font-bold text-white">إضافة منطقة</button></form></div>
      <div><h3 className="mb-2 font-bold">المباني ({buildings.length})</h3><div className="mb-3 max-h-52 space-y-2 overflow-auto">{buildings.map(b=><div key={b.id} className="rounded-xl bg-[#f5f4ef] p-3 text-sm"><b>{b.nameAr||b.name}</b><div className="text-xs text-[#77827d]">{zones.find(z=>z.id===b.zoneId)?.nameAr||zones.find(z=>z.id===b.zoneId)?.name||"بدون Zone"}</div></div>)}</div><form onSubmit={addBuilding} className="grid gap-2"><input required name="name" placeholder="اسم المبنى" className={input}/><input name="nameAr" placeholder="الاسم العربي" className={input}/><input name="code" placeholder="الكود" className={input}/><select name="zoneId" className={input}><option value="">بدون Zone</option>{zones.map(z=><option key={z.id} value={z.id}>{z.nameAr||z.name}</option>)}</select><button disabled={saving} className="h-11 rounded-xl bg-forest font-bold text-white">إضافة مبنى</button></form></div>
    </div>

    <div className="mt-7 border-t pt-6"><h3 className="font-bold">تحديد مكان كل وحدة</h3><p className="mt-1 text-sm text-[#68756f]">ده اللي يخلي البحث يفهم: الدور الثالث، جنب بوابة 2، في منتصف المشروع، أو قريب من بوابة معينة.</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-[280px_1fr]">
        <div><label className="mb-2 block text-sm font-bold">الوحدة</label><select value={selectedUnitId} onChange={e=>setSelectedUnitId(e.target.value)} className={`${input} w-full`}><option value="">اختر وحدة</option>{units.map(u=><option key={u.id} value={u.id}>{u.externalUnitId}</option>)}</select></div>
        {selectedUnit&&<form key={selectedUnit.id} onSubmit={saveUnitLocation} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"><select name="projectZoneId" defaultValue={selectedUnit.projectZoneId||""} className={input}><option value="">Zone غير محدد</option>{zones.map(z=><option key={z.id} value={z.id}>{z.nameAr||z.name}</option>)}</select><select name="projectBuildingId" defaultValue={selectedUnit.projectBuildingId||""} className={input}><option value="">مبنى غير محدد</option>{buildings.map(b=><option key={b.id} value={b.id}>{b.nameAr||b.name}</option>)}</select><input name="floor" defaultValue={selectedUnit.floor||""} placeholder="الدور" className={input}/><input name="latitude" type="number" step="any" placeholder="Unit Latitude (اختياري)" className={input}/><input name="longitude" type="number" step="any" placeholder="Unit Longitude (اختياري)" className={input}/><input name="internalLocationDescription" defaultValue={selectedUnit.internalLocationDescription||""} placeholder="وصف: قريب من البوابة الخلفية..." className={input}/><button disabled={saving} className="h-11 rounded-xl bg-forest px-4 font-bold text-white sm:col-span-2 lg:col-span-3">حفظ مكان الوحدة</button></form>}
      </div>

      {selectedUnit&&<div className="mt-5 rounded-2xl bg-[#f8f7f3] p-4"><h4 className="font-bold">المسافة من البوابات</h4><div className="mt-3 grid gap-2 md:grid-cols-2">{proximities.filter(p=>p.targetType==="GATE").map(p=><div key={p.id} className="flex items-center justify-between rounded-xl bg-white p-3 text-sm"><div><b>{p.gate?.nameAr||p.gate?.name||"بوابة"}</b><div className="text-xs text-[#77827d]">{p.distanceMeters!=null?`${p.distanceMeters} متر`:"المسافة غير محددة"}{p.walkingMinutes!=null?` · ${p.walkingMinutes} دقيقة مشي`:""}</div></div><button onClick={()=>removeProximity(p.id)} className="rounded-lg border px-2 py-1 text-xs text-red-600">حذف</button></div>)}</div><form onSubmit={addGateDistance} className="mt-3 grid gap-2 sm:grid-cols-4"><select required name="gateId" className={input}><option value="">اختر البوابة</option>{gates.map(g=><option key={g.id} value={g.id}>{g.nameAr||g.name}{g.gateNumber?` — ${g.gateNumber}`:""}</option>)}</select><input required name="distanceMeters" type="number" min="0" placeholder="المسافة بالمتر" className={input}/><input name="walkingMinutes" type="number" min="0" placeholder="دقائق مشي" className={input}/><button disabled={saving} className="h-11 rounded-xl bg-[#263d34] font-bold text-white">إضافة المسافة</button></form></div>}
    </div>
  </section>;
}
