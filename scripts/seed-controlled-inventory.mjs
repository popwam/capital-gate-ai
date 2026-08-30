import { PrismaClient } from "@prisma/client";

if (!process.argv.includes("--confirm-controlled-test-inventory")) {
  throw new Error("Refusing to seed without --confirm-controlled-test-inventory");
}

const prisma = new PrismaClient();
const verifiedAt = new Date("2026-08-29T00:00:00.000Z");
const marker = { inventoryClass: "CONTROLLED_TEST", commercialUse: false, verifiedAt: verifiedAt.toISOString(), source: "AICG_PRODUCT_E2E_FIXTURE" };
const areas = [
  { slug: "controlled-test-new-cairo", name: "New Cairo", nameAr: "التجمع الخامس", aliases: ["التجمع", "التجمع الخامس", "القاهرة الجديدة", "نيو كايرو", "new cairo", "fifth settlement"] },
  { slug: "controlled-test-sheikh-zayed", name: "Sheikh Zayed", nameAr: "الشيخ زايد", aliases: ["زايد", "الشيخ زايد", "شيخ زايد", "sheikh zayed", "zayed"] },
];
const projects = [
  { slug: "controlled-test-east-gardens", name: "East Gardens Test", area: 0, developer: "Controlled East Developments" },
  { slug: "controlled-test-cairo-heights", name: "Cairo Heights Test", area: 0, developer: "Controlled Horizon" },
  { slug: "controlled-test-zayed-grove", name: "Zayed Grove Test", area: 1, developer: "Controlled West Developments" },
  { slug: "controlled-test-west-valley", name: "West Valley Test", area: 1, developer: "Controlled Horizon" },
];
const units = [
  [0,"APT-201","Apartment",2,2,125,6200000,"AVAILABLE",6,2027],[0,"APT-301","Apartment",3,3,165,7900000,"AVAILABLE",8,2028],[0,"APT-302","Apartment",3,3,175,9300000,"RESERVED",7,2027],[0,"TH-101","Townhouse",3,3,225,14500000,"AVAILABLE",8,2029],[0,"VIL-401","Villa",4,5,330,23800000,"AVAILABLE",7,2028],
  [1,"APT-110","Apartment",2,2,135,7000000,"AVAILABLE",5,2027],[1,"APT-210","Apartment",3,2,155,8800000,"AVAILABLE",9,2029],[1,"APT-310","Apartment",4,4,220,13200000,"UNAVAILABLE",8,2028],[1,"TH-220","Townhouse",4,4,260,17500000,"AVAILABLE",10,2030],
  [2,"APT-105","Apartment",2,2,130,6500000,"AVAILABLE",7,2027],[2,"APT-205","Apartment",3,3,170,9100000,"AVAILABLE",8,2028],[2,"TH-305","Townhouse",3,4,235,15200000,"AVAILABLE",9,2029],[2,"VIL-405","Villa",4,5,350,24900000,"AVAILABLE",10,2029],[2,"VIL-505","Villa",4,5,390,28500000,"RESERVED",8,2028],
  [3,"APT-115","Apartment",2,2,145,7400000,"AVAILABLE",6,2027],[3,"APT-315","Apartment",3,3,185,10500000,"AVAILABLE",8,2028],[3,"TH-415","Townhouse",4,4,275,18900000,"AVAILABLE",10,2030],[3,"VIL-515","Villa",4,5,370,26500000,"UNAVAILABLE",9,2029],
];

try {
  const locationRows = [];
  for (const area of areas) {
    const { aliases, ...location } = area;
    const row = await prisma.location.upsert({ where: { slug: area.slug }, create: { type: "AREA", ...location, canonicalName: area.name, nameEn: area.name, source: "CONTROLLED_TEST" }, update: { name: area.name, nameAr: area.nameAr, nameEn: area.name, canonicalName: area.name, source: "CONTROLLED_TEST" } });
    locationRows.push(row);
    for (const value of aliases) {
      const normalizedValue = value.toLocaleLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      await prisma.locationAlias.upsert({
        where: { locationId_normalizedValue: { locationId: row.id, normalizedValue } },
        create: { locationId: row.id, value, normalizedValue, language: /[\u0600-\u06ff]/u.test(value) ? "ar" : "en", approvalStatus: "APPROVED" },
        update: { value, approvalStatus: "APPROVED" },
      });
    }
  }
  const developerRows = new Map();
  for (const name of [...new Set(projects.map((item) => item.developer))]) {
    const slug = `controlled-test-${name.toLowerCase().replace(/[^a-z0-9]+/gu, "-")}`;
    developerRows.set(name, await prisma.developer.upsert({ where: { slug }, create: { name, slug, canonicalName: name, nameEn: name, geographicFocus: ["Egypt"], specialties: ["CONTROLLED_TEST"], sourceMetadata: marker }, update: { sourceMetadata: marker } }));
  }
  const projectRows = [];
  for (const item of projects) {
    const developer = developerRows.get(item.developer);
    projectRows.push(await prisma.project.upsert({ where: { slug: item.slug }, create: { developerId: developer.id, locationId: locationRows[item.area].id, name: item.name, slug: item.slug, canonicalName: item.name, nameEn: item.name, adminStatus: "PUBLISHED", projectStatus: "CONTROLLED_TEST", projectTypes: ["RESIDENTIAL"], finishingOptions: ["FINISHED", "SEMI_FINISHED"], unitTypes: ["Apartment", "Townhouse", "Villa"], customerFit: ["E2E_TESTING"], sourceMetadata: marker }, update: { sourceMetadata: marker, adminStatus: "PUBLISHED" } }));
  }
  for (const [projectIndex, code, unitType, bedrooms, bathrooms, area, price, status, years, deliveryYear] of units) {
    const project = projectRows[projectIndex];
    const developer = developerRows.get(projects[projectIndex].developer);
    const unit = await prisma.unit.upsert({
      where: { developerId_projectId_externalUnitId: { developerId: developer.id, projectId: project.id, externalUnitId: `TEST-${code}` } },
      create: { developerId: developer.id, projectId: project.id, externalUnitId: `TEST-${code}`, unitType, bedrooms, bathrooms, builtUpArea: area, price, currency: "EGP", status, installmentYears: years, deliveryDate: new Date(`${deliveryYear}-12-31T00:00:00.000Z`), availabilityUpdatedAt: verifiedAt, sourceMetadata: marker },
      update: { unitType, bedrooms, bathrooms, builtUpArea: area, price, currency: "EGP", status, installmentYears: years, deliveryDate: new Date(`${deliveryYear}-12-31T00:00:00.000Z`), availabilityUpdatedAt: verifiedAt, sourceMetadata: marker },
    });
    await prisma.paymentPlan.deleteMany({ where: { unitId: unit.id, sourceMetadata: { path: ["inventoryClass"], equals: "CONTROLLED_TEST" } } });
    await prisma.paymentPlan.create({ data: { unitId: unit.id, name: "Controlled installment plan", durationMonths: years * 12, downPaymentPercent: 0.10, totalPrice: price, currency: "EGP", planType: "INSTALLMENT", sourceMetadata: marker, notes: "Controlled test data; not a commercial offer" } });
  }
  console.log(`Seeded ${units.length} controlled test units across ${projects.length} test projects.`);
} finally {
  await prisma.$disconnect();
}
