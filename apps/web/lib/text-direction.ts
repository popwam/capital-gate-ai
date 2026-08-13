export type TextDirection = "rtl" | "ltr";

const ARABIC_OR_RTL = /[\u0590-\u08ff\ufb1d-\ufdfd\ufe70-\ufefc]/;
const ENGLISH = /[A-Za-z]/;

/** Mirrors the browser's first-strong-character bidi behavior for supported languages. */
export function textDirection(value: string): TextDirection {
  for (const character of value) {
    if (ARABIC_OR_RTL.test(character)) return "rtl";
    if (ENGLISH.test(character)) return "ltr";
  }
  return "ltr";
}
