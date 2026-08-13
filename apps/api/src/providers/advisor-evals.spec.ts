import * as assert from "node:assert/strict";
import { test } from "node:test";
import { advisorMessages } from "./provider-utils";

const prompts = [
  ["عاوز شقة في التجمع"], ["ميزانيتي حوالي 12 مليون"], ["بس المقدم ميعديش مليون ونص"], ["مش مهم الاستلام دلوقتي"], ["طب إيه الأفضل للاستثمار؟"],
  ["خلاص سيب المشروع ده", "طب لو مستقبل سيتي؟"], ["عاوز أشوف الصور"], ["البروشور موجود؟"], ["المكان بعيد كام من الـAUC؟"], ["أنا مهتم، ممكن حد يكلمني؟"],
  ["I need a home in New Cairo", "maybe 3 bedrooms"], ["عاوز apartment 3 bedrooms في New Cairo"], ["budget 15M بس low down payment"], ["tagamo3 2 bedrooms ready to move"], ["عاوز حاجة للاستثمار وإعادة بيعها تكون سهلة"],
  ["مش عاوز الشيخ زايد", "شوفلي العاصمة"], ["عاوز تاون هاوس لأسرة فيها 3 أطفال"], ["المساحة من 160 لـ200 متر"], ["التقسيط أهم عندي من السعر"], ["لو زودت مليون ولا اتنين هيفرق؟"],
  ["وريني أحسن 3 بس ومميزات وعيوب كل واحدة"], ["هل السعر ده مؤكد؟"], ["في عرض بينتهي بكرة؟"], ["عاوز أحجز معاينة"], ["Ana 3ayez sha2a fel tagamo3 budget 10m"],
] as const;

test("advisor evaluation set covers at least 25 Arabic, English, mixed and multi-turn cases", () => {
  assert.equal(prompts.length, 25);
  assert.ok(prompts.some(sequence => sequence.length > 1));
  assert.ok(prompts.some(sequence => /[\u0600-\u06ff]/.test(sequence.join(" ")) && /[a-z]/i.test(sequence.join(" "))));
});

test("advisor guardrails require verified facts, one useful question and no fake scarcity", () => {
  const system = advisorMessages({ messages: [], intent: { language: "ar-EG" }, verifiedFacts: [] })[0].content;
  assert.match(system, /only come from VERIFIED_FACTS/);
  assert.match(system, /ask at most one useful question/);
  assert.match(system, /Never invent.*scarcity/);
});
