import assert from "node:assert/strict";
import test from "node:test";
import { textDirection } from "./text-direction.ts";

test("Arabic text is right-to-left", () => {
  assert.equal(textDirection("عاوز شقة 3 غرف في القاهرة الجديدة"), "rtl");
});

test("English text is left-to-right", () => {
  assert.equal(textDirection("I need a three-bedroom apartment"), "ltr");
});

test("mixed Arabic-English text follows its first strong character", () => {
  assert.equal(textDirection("عاوز apartment 3 bedrooms في New Cairo"), "rtl");
  assert.equal(textDirection("Apartment في القاهرة الجديدة"), "ltr");
});
