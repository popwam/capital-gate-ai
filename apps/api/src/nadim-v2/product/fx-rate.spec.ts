import { strict as assert } from "node:assert";
import { test } from "node:test";
import { FxRateProvider, FxRateService } from "./fx-rate.service";

class MockFxProvider implements FxRateProvider {
  calls = 0;
  constructor(private readonly rates: Record<string, number>) {}
  async getRate(from: string, to: string) {
    this.calls += 1;
    const rate = this.rates[`${from}:${to}`];
    if (!rate) throw new Error("unavailable");
    return { rate, asOf: new Date("2026-08-31T10:00:00.000Z"), source: "TEST_FX" };
  }
}

test("verified FX normalizes USD SAR and AED to EGP and retains the quote", async () => {
  const provider = new MockFxProvider({ "USD:EGP": 50, "SAR:EGP": 13.3, "AED:EGP": 13.6 });
  const service = new FxRateService(provider);
  assert.equal((await service.normalize(300_000, "USD")).normalizedAmount, 15_000_000);
  assert.equal((await service.normalize(1_000_000, "SAR")).normalizedAmount, 13_300_000);
  const aed = await service.normalize(500_000, "AED");
  assert.equal(aed.normalizedAmount, 6_800_000);
  assert.equal(aed.fxSource, "TEST_FX");
  assert.equal(aed.fxAsOf, "2026-08-31T10:00:00.000Z");
});

test("FX cache avoids repeated provider calls and unavailable FX never invents a rate", async () => {
  const provider = new MockFxProvider({ "USD:EGP": 50 });
  const service = new FxRateService(provider);
  await service.getRate("USD", "EGP");
  await service.getRate("USD", "EGP");
  assert.equal(provider.calls, 1);
  await assert.rejects(
    () => service.getRate("SAR", "EGP"),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "FX_UNAVAILABLE",
  );
});
