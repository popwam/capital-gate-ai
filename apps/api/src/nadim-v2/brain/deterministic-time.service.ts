import { Injectable } from "@nestjs/common";

const LOCALE_TIMEZONES: Record<string, string> = {
  EG: "Africa/Cairo",
  SA: "Asia/Riyadh",
  AE: "Asia/Dubai",
  KW: "Asia/Kuwait",
  QA: "Asia/Qatar",
  BH: "Asia/Bahrain",
  OM: "Asia/Muscat",
};

@Injectable()
export class DeterministicTimeService {
  now(locale: string, requestedTimeZone?: unknown, instant = new Date()) {
    const requested = typeof requestedTimeZone === "string" ? requestedTimeZone.trim() : "";
    const region = locale.match(/[-_]([A-Za-z]{2})\b/u)?.[1]?.toUpperCase();
    const timeZone = requested || (region ? LOCALE_TIMEZONES[region] : undefined);
    if (!timeZone || !this.validTimeZone(timeZone)) {
      throw Object.assign(new Error("A known timezone is required"), { code: "TIMEZONE_REQUIRED" });
    }
    return {
      timeZone,
      iso: instant.toISOString(),
      localDateTime: new Intl.DateTimeFormat(locale || "en", {
        timeZone,
        dateStyle: "full",
        timeStyle: "short",
        hour12: false,
      }).format(instant),
    };
  }

  private validTimeZone(value: string) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value }).format(new Date(0));
      return true;
    } catch {
      return false;
    }
  }
}
