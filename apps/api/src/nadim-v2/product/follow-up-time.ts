export type FollowUpTemporalRequest =
  | { kind: "RELATIVE"; amount: number; unit: "MINUTE" | "HOUR" | "DAY" | "WEEK" }
  | { kind: "TOMORROW"; localTime?: string };

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const asciiDigits = (value: string) => value.replace(/[٠-٩]/gu, (digit) => String(ARABIC_DIGITS.indexOf(digit)));

/** Outage-safe extraction. The healthy AI brain emits the same normalized contract. */
export function extractFollowUpTemporalRequest(message: string): FollowUpTemporalRequest | undefined {
  const text = asciiDigits(message).normalize("NFKC").toLocaleLowerCase();
  if (/(?:بكر[ةهع]؟?|بكرا|غد[ًاا]?|tomorrow)/iu.test(text)) {
    const clock = text.match(/(?:الساعة|الساعه|ساعة|at)\s*(\d{1,2})(?:\s*[:.]\s*(\d{1,2}))?\s*(ص|صباح(?:ًا|ا)?|م|مساء(?:ً|ا)?|am|pm)?/iu);
    if (!clock) return { kind: "TOMORROW" };
    let hour = Number(clock[1]);
    const minute = Number(clock[2] ?? 0);
    const period = clock[3]?.toLocaleLowerCase();
    if (/(?:م|مساء|pm)/iu.test(period ?? "") && hour < 12) hour += 12;
    if (/(?:ص|صباح|am)/iu.test(period ?? "") && hour === 12) hour = 0;
    return hour <= 23 && minute <= 59
      ? { kind: "TOMORROW", localTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` }
      : { kind: "TOMORROW" };
  }
  if (/(?:الأسبوع\s+الجاي|الاسبوع\s+الجاي|next\s+week)/iu.test(text)) return { kind: "RELATIVE", amount: 1, unit: "WEEK" };
  if (/(?:نص|نصف|half)(?:\s+an?)?\s*(?:ساعة|ساعه|hour)/iu.test(text)) return { kind: "RELATIVE", amount: 30, unit: "MINUTE" };
  if (/(?:ساعتين|ساعتان|two\s+hours?)/iu.test(text)) return { kind: "RELATIVE", amount: 2, unit: "HOUR" };
  const match = text.match(/(?:بعد|كمان|in)\s+([\d.]+|one|two)\s*(دق(?:يقة|ايق?)|minutes?|ساعة|ساعه|ساعات|hours?|يوم|days?|أسبوع|اسبوع|weeks?)/iu);
  if (!match) return undefined;
  const amount = ({ one: 1, two: 2 } as Record<string, number>)[match[1]] ?? Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const rawUnit = match[2];
  const unit = /(?:دق|minute)/iu.test(rawUnit) ? "MINUTE"
    : /(?:ساعة|ساعه|ساعات|hour)/iu.test(rawUnit) ? "HOUR"
      : /(?:أسبوع|اسبوع|week)/iu.test(rawUnit) ? "WEEK" : "DAY";
  return { kind: "RELATIVE", amount, unit };
}

export function temporalRequestFromPayload(payload: Record<string, unknown>): FollowUpTemporalRequest | undefined {
  const value = payload.temporal && typeof payload.temporal === "object" ? payload.temporal as Record<string, unknown> : payload;
  if (value.kind === "TOMORROW") return { kind: "TOMORROW", localTime: typeof value.localTime === "string" ? value.localTime : undefined };
  if (value.kind !== "RELATIVE") return undefined;
  const amount = Number(value.amount);
  const unit = value.unit;
  if (!Number.isFinite(amount) || amount <= 0 || !["MINUTE", "HOUR", "DAY", "WEEK"].includes(String(unit))) return undefined;
  return { kind: "RELATIVE", amount, unit: unit as "MINUTE" | "HOUR" | "DAY" | "WEEK" };
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)])) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
}

function localToUtc(parts: Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>, timeZone: string) {
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let guess = target;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const actual = zonedParts(new Date(guess), timeZone);
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    guess += target - represented;
  }
  return new Date(guess);
}

export function resolveFollowUpDueAt(request: FollowUpTemporalRequest, timeZone: string, now = new Date()) {
  if (request.kind === "TOMORROW") {
    const local = zonedParts(now, timeZone);
    const next = new Date(Date.UTC(local.year, local.month - 1, local.day + 1, local.hour, local.minute, local.second));
    const tomorrow = { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate(), hour: local.hour, minute: local.minute, second: local.second };
    if (request.localTime && /^([01]\d|2[0-3]):[0-5]\d$/u.test(request.localTime)) [tomorrow.hour, tomorrow.minute] = request.localTime.split(":").map(Number);
    return localToUtc(tomorrow, timeZone);
  }
  const unitMs = { MINUTE: 60_000, HOUR: 3_600_000, DAY: 86_400_000, WEEK: 604_800_000 }[request.unit];
  return new Date(now.getTime() + request.amount * unitMs);
}
