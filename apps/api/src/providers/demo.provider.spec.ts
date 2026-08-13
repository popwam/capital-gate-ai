import { test } from "node:test";
import * as assert from "node:assert/strict";
import { DemoAIProvider } from "./demo.provider";

test("demo provider updates intent without inventing inventory", async () => {
  const provider = new DemoAIProvider();
  const intent = await provider.extractIntent([{ role: "user", content: "3 bed apartment in New Cairo under 15 million" }], { language: "en", purpose: "INVESTMENT" });
  assert.equal(intent.bedrooms, 3); assert.equal(intent.budgetMax, 15_000_000); assert.deepEqual(intent.locations, ["NEW_CAIRO"]); assert.equal(intent.purpose, "INVESTMENT");
});

test("demo provider explicitly reports zero verified results", async () => {
  const provider = new DemoAIProvider();
  const answer = await provider.composeAnswer({ messages: [], intent: { language: "en" }, verifiedFacts: [] });
  assert.match(answer, /couldn.t find an exact available match/i);
});
