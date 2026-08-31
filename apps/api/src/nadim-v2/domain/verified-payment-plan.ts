export type VerifiedPaymentPlan = {
  id: string;
  name?: string | null;
  durationMonths?: number | null;
  downPaymentAmount?: number | null;
  downPaymentPercent?: number | null;
  installmentAmount?: number | null;
  installmentFrequency?: string | null;
  effectiveTotalPrice?: number | null;
  currency?: string | null;
  owner: { type: "UNIT" | "PHASE" | "PROJECT"; id: string };
};

export type VerifiedUnitPaymentPlanResult = {
  unit: {
    id: string;
    externalUnitId: string;
    projectId: string;
    projectName: string;
  };
  plans: VerifiedPaymentPlan[];
};
