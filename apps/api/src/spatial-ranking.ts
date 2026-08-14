import { ProximityPreference, StructuredIntent } from "./providers/ai-provider";

export type SpatialUnitLike = {
  floor?: string | null;
  phase?: string | null;
  cluster?: string | null;
  building?: string | null;
  projectZone?: { name?: string | null; nameAr?: string | null; nameEn?: string | null } | null;
  projectBuilding?: { name?: string | null; nameAr?: string | null; nameEn?: string | null } | null;
  proximities?: Array<{
    targetType: string;
    distanceMeters?: number | null;
    walkingMinutes?: number | null;
    gate?: { name?: string | null; nameAr?: string | null; nameEn?: string | null; code?: string | null; gateNumber?: number | null; isMain?: boolean | null } | null;
    amenity?: { canonicalName?: string | null; nameAr?: string | null; nameEn?: string | null } | null;
    landmark?: { name?: string | null } | null;
  }>;
};

const norm = (value: unknown) => String(value ?? "").toLowerCase().normalize("NFKC").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function proximityNames(item: NonNullable<SpatialUnitLike["proximities"]>[number]) {
  return [
    item.gate?.name,
    item.gate?.nameAr,
    item.gate?.nameEn,
    item.gate?.code,
    item.gate?.gateNumber != null ? `gate ${item.gate.gateNumber}` : null,
    item.gate?.gateNumber != null ? `بوابه ${item.gate.gateNumber}` : null,
    item.gate?.isMain ? "main gate" : null,
    item.gate?.isMain ? "البوابه الرئيسيه" : null,
    item.amenity?.canonicalName,
    item.amenity?.nameAr,
    item.amenity?.nameEn,
    item.landmark?.name,
  ].filter(Boolean).map(norm);
}

export function matchesProximity(item: NonNullable<SpatialUnitLike["proximities"]>[number], preference: ProximityPreference) {
  if (item.targetType !== preference.targetType) return false;
  if (preference.targetId) {
    const candidateId = (item as any).gateId ?? (item as any).amenityId ?? (item as any).landmarkId;
    if (candidateId && candidateId !== preference.targetId) return false;
  }
  if (!preference.targetName) return true;
  const wanted = norm(preference.targetName === "MAIN_GATE" ? "main gate" : preference.targetName);
  return proximityNames(item).some(name => name.includes(wanted) || wanted.includes(name));
}

export function spatialScore(unit: SpatialUnitLike, intent: StructuredIntent) {
  let score = 0;
  const reasons: string[] = [];

  const floorNumber = Number.parseInt(String(unit.floor ?? ""), 10);
  if (intent.preferredFloor != null && Number.isFinite(floorNumber) && floorNumber === intent.preferredFloor) {
    score += 8;
    reasons.push("preferred floor");
  }
  if (intent.minimumFloor != null && Number.isFinite(floorNumber) && floorNumber >= intent.minimumFloor) score += 2;
  if (intent.maximumFloor != null && Number.isFinite(floorNumber) && floorNumber <= intent.maximumFloor) score += 2;

  const zoneNames = [unit.cluster, unit.projectZone?.name, unit.projectZone?.nameAr, unit.projectZone?.nameEn].map(norm).filter(Boolean);
  if (intent.preferredProjectZone && zoneNames.some(v => v.includes(norm(intent.preferredProjectZone)))) {
    score += 7;
    reasons.push("internal zone match");
  }
  const buildingNames = [unit.building, unit.projectBuilding?.name, unit.projectBuilding?.nameAr, unit.projectBuilding?.nameEn].map(norm).filter(Boolean);
  if (intent.preferredBuilding && buildingNames.some(v => v.includes(norm(intent.preferredBuilding)))) {
    score += 7;
    reasons.push("building match");
  }
  if (intent.preferredPhase && norm(unit.phase).includes(norm(intent.preferredPhase))) {
    score += 5;
    reasons.push("phase match");
  }

  const preferences = [...(intent.proximityPreferences ?? [])];
  if (intent.preferredGate && !preferences.some(p => p.targetType === "GATE")) {
    preferences.push({ targetType: "GATE", targetName: intent.preferredGate, preference: "NEAR", maxDistanceMeters: intent.maxGateDistanceMeters });
  }

  for (const pref of preferences) {
    if (pref.preference === "ANY") continue;
    const matches = (unit.proximities ?? []).filter(item => matchesProximity(item, pref));
    if (!matches.length) continue;
    const bestDistance = Math.min(...matches.map(item => item.distanceMeters ?? Number.MAX_SAFE_INTEGER));
    const bounded = pref.maxDistanceMeters != null && Number.isFinite(bestDistance);
    if (pref.preference === "NEAR") {
      if (!bounded || bestDistance <= pref.maxDistanceMeters!) {
        score += 10;
        reasons.push(pref.targetType === "GATE" ? "near preferred gate" : `near ${pref.targetType.toLowerCase()}`);
      } else score -= 4;
    } else if (pref.preference === "FAR") {
      if (!bounded || bestDistance >= pref.maxDistanceMeters!) {
        score += 6;
        reasons.push(`far from ${pref.targetType.toLowerCase()}`);
      } else score -= 6;
    }
  }
  return { score, reasons };
}

export function closestGate(unit: SpatialUnitLike) {
  const gates = (unit.proximities ?? []).filter(item => item.targetType === "GATE" && item.gate);
  gates.sort((a,b) => (a.distanceMeters ?? Number.MAX_SAFE_INTEGER) - (b.distanceMeters ?? Number.MAX_SAFE_INTEGER));
  const best = gates[0];
  if (!best?.gate) return null;
  return {
    name: best.gate.nameAr ?? best.gate.nameEn ?? best.gate.name ?? (best.gate.gateNumber != null ? `Gate ${best.gate.gateNumber}` : null),
    gateNumber: best.gate.gateNumber ?? null,
    isMain: Boolean(best.gate.isMain),
    distanceMeters: best.distanceMeters ?? null,
    walkingMinutes: best.walkingMinutes ?? null,
  };
}
