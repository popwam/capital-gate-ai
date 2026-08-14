import assert from "node:assert/strict";
import test from "node:test";
import { spatialScore } from "./spatial-ranking";

test("Gate 2 and third floor increase spatial score", () => {
  const result = spatialScore({
    floor: "3",
    proximities: [{ targetType: "GATE", distanceMeters: 120, gate: { name: "Gate 2", gateNumber: 2, isMain: false } }],
  }, {
    language: "ar-EG", preferredFloor: 3, preferredGate: "Gate 2",
    proximityPreferences: [{ targetType: "GATE", targetName: "Gate 2", preference: "NEAR", maxDistanceMeters: 200 }],
  });
  assert.ok(result.score >= 18);
  assert.ok(result.reasons.includes("preferred floor"));
  assert.ok(result.reasons.includes("near preferred gate"));
});
