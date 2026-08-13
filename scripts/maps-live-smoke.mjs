import "dotenv/config";
import assert from "node:assert/strict";
import { MapsService } from "../apps/api/dist/maps.service.js";

const maps = new MapsService();
const geocoding = await maps.geocode("New Cairo, Egypt");
assert.ok(["OK", "ZERO_RESULTS"].includes(geocoding.status));
const places = await maps.places("AUC New Cairo");
assert.ok(Array.isArray(places.places));
const routes = await maps.route("New Cairo, Egypt", "AUC New Cairo, Egypt");
assert.ok(Array.isArray(routes.routes) && routes.routes.length > 0);
console.log("Google Maps geocoding, Places New, and Routes: PASS");
