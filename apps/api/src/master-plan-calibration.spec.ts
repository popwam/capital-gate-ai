import assert from "node:assert/strict";
import test from "node:test";
import { calibrateMasterPlan } from "./master-plan-calibration";

test("maps Master Plan pixels to GPS using 3+ calibration anchors", () => {
  const map = calibrateMasterPlan([
    { x: 0, y: 0, latitude: 30, longitude: 31 },
    { x: 100, y: 0, latitude: 30, longitude: 32 },
    { x: 0, y: 100, latitude: 31, longitude: 31 },
  ]);

  assert.deepEqual(map({ x: 50, y: 50 }), {
    latitude: 30.5,
    longitude: 31.5,
  });
});
