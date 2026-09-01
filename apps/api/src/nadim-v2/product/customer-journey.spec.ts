import { strict as assert } from "node:assert";
import { test } from "node:test";
import { initialNadimState } from "../domain/nadim-state";
import { extractCustomerName, extractCustomerPhone, followUpTransition, reservationTransition } from "./customer-journey";
import { extractFollowUpTemporalRequest, resolveFollowUpDueAt } from "./follow-up-time";

test("reservation journey retains exact unit and collects only missing fields", () => {
  const state = { ...initialNadimState({ channel: "WEB", locale: "ar-EG" }), selectedUnitId: "unit-301" };
  const started = reservationTransition({ state, message: "عاوز احجز الوحدة الأولى", reservationIntent: true, now: new Date("2026-09-01T10:00:00Z") });
  assert.equal(started?.pendingAction?.unitId, "unit-301");
  assert.deepEqual(started?.pendingAction?.missingFields, ["fullName", "phone", "paymentMethod"]);

  const continued = reservationTransition({
    state: { ...state, pendingAction: started!.pendingAction },
    message: "الاسم ممدوح ممدوح رقم الهاتف 01033662881 و طريقة السداد المخصص للمشروع",
    reservationIntent: false,
  });
  assert.equal(continued?.pendingAction?.unitId, "unit-301");
  assert.deepEqual(continued?.pendingAction?.collectedFields, {
    fullName: "ممدوح ممدوح",
    phone: "01033662881",
    paymentMethod: "PROJECT_PAYMENT_PLAN",
  });
  assert.equal(continued?.ready, true);
  assert.equal(continued?.shouldSubmit, true);
});

test("reservation journey reuses verified profile contact and never invents it", () => {
  const state = { ...initialNadimState({ channel: "WEB" }), selectedUnitId: "unit-301" };
  const known = reservationTransition({ state, message: "reserve the first unit", reservationIntent: true, profile: { name: "Mamdouh", phone: "+201033662881" } });
  assert.deepEqual(known?.pendingAction?.missingFields, ["paymentMethod"]);
  const unknown = reservationTransition({ state, message: "reserve it", reservationIntent: true });
  assert.equal(unknown?.pendingAction?.collectedFields.phone, undefined);
});

test("customer entity extraction supports Arabic contact fragments", () => {
  const message = "اسمي ممدوح ممدوح ورقمي 01033662881";
  assert.equal(extractCustomerName(message), "ممدوح ممدوح");
  assert.equal(extractCustomerPhone(message), "01033662881");
});

test("tomorrow at 11 is deterministic in the customer timezone", () => {
  const temporal = extractFollowUpTemporalRequest("حددها بكرا الساعة 11");
  assert.deepEqual(temporal, { kind: "TOMORROW", localTime: "11:00" });
  assert.equal(resolveFollowUpDueAt(temporal!, "Africa/Cairo", new Date("2026-09-01T10:00:00Z")).toISOString(), "2026-09-02T08:00:00.000Z");
});

test("WhatsApp preference persists until a later exact follow-up time", () => {
  const state = initialNadimState({ channel: "WEB", locale: "ar-EG" });
  const preference = followUpTransition({ state, message: "كنت عاوز المتابعة تكون من الواتس", profilePhone: "01033662881" });
  assert.equal(preference?.pendingFollowUp.channel, "WHATSAPP");
  assert.equal(preference?.pendingFollowUp.outboundAddress, "01033662881");
  const scheduled = followUpTransition({ state: { ...state, pendingFollowUp: preference!.pendingFollowUp }, message: "حددها بكرا الساعة 11", profilePhone: null });
  assert.equal(scheduled?.ready, true);
  assert.deepEqual(scheduled?.pendingFollowUp.temporal, { kind: "TOMORROW", localTime: "11:00" });
});
