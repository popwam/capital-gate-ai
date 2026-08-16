"use client";

import {
  FormEvent,
  useEffect,
  useState,
} from "react";

import { adminApi, adminErrorMessage } from "@/lib/api";
import { ProjectSpatialEditor } from "@/components/project-spatial-editor";

type Amenity = {
  id: string;
  canonicalName: string;
  nameAr?: string | null;
  nameEn?: string | null;
  category?: string | null;
};

type DeveloperRef = {
  id?: string;
  name?: string | null;
  canonicalName?: string | null;
  nameAr?: string | null;
  nameEn?: string | null;
};

type LocationRef = {
  id?: string;
  name?: string | null;
  canonicalName?: string | null;
  nameAr?: string | null;
  nameEn?: string | null;
};

type ProjectAmenity = {
  amenityId: string;
  amenity?: Amenity | null;
};

type CompetitorRelation = {
  competitorProject?: {
    id: string;
    name?: string | null;
    nameAr?: string | null;
    nameEn?: string | null;
  } | null;
};

type Project = Record<string, any> & {
  id: string;

  name?: string | null;
  nameAr?: string | null;
  nameEn?: string | null;

  developer?: DeveloperRef | null;
  location?: LocationRef | null;

  amenities?: ProjectAmenity[] | null;
  investmentProfile?: Record<string, any> | null;
  landmarks?: Array<Record<string, any>> | null;
  competitorsFrom?: CompetitorRelation[] | null;

  media?: Array<Record<string, any>> | null;
  documents?: Array<Record<string, any>> | null;
  paymentPlans?: Array<Record<string, any>> | null;

  unitTypes?: string[] | null;
  finishingOptions?: string[] | null;
  customerFit?: string[] | null;

  _count?: {
    units?: number;
    knowledgeItems?: number;
  } | null;
};

type Readiness = {
  ready: boolean;
  missing: string[];
  imageCount: number;
};

const safeArray = <T,>(
  value: T[] | null | undefined,
): T[] => (Array.isArray(value) ? value : []);

const displayDeveloper = (
  developer?: DeveloperRef | null,
) =>
  developer?.nameAr ||
  developer?.name ||
  developer?.canonicalName ||
  developer?.nameEn ||
  "المطور غير محدد";

const displayLocation = (
  location?: LocationRef | null,
) =>
  location?.nameAr ||
  location?.name ||
  location?.canonicalName ||
  location?.nameEn ||
  "الموقع غير محدد";

const csv = (
  value: FormDataEntryValue | null,
) =>
  String(value ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export default function ProjectDetails({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [id, setId] = useState("");
  const [item, setItem] = useState<Project | null>(null);

  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [projects, setProjects] = useState<
    Array<{
      id: string;
      name: string;
    }>
  >([]);

  const [readiness, setReadiness] =
    useState<Readiness | null>(null);

  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  const normalizeProject = (
    project: Project,
  ): Project => ({
    ...project,

    developer: project.developer ?? null,
    location: project.location ?? null,

    amenities: safeArray(project.amenities),
    landmarks: safeArray(project.landmarks),
    competitorsFrom: safeArray(
      project.competitorsFrom,
    ),
    media: safeArray(project.media),
    documents: safeArray(project.documents),
    paymentPlans: safeArray(project.paymentPlans),

    unitTypes: safeArray(project.unitTypes),
    finishingOptions: safeArray(
      project.finishingOptions,
    ),
    customerFit: safeArray(project.customerFit),

    _count: {
      units: project._count?.units ?? 0,
      knowledgeItems:
        project._count?.knowledgeItems ?? 0,
    },
  });

  const load = async (projectId: string) => {
    if (!projectId) return;

    setLoading(true);
    setError("");

    try {
      const [projectResult, amenitiesResult, projectsResult, readyResult] =
        await Promise.all([
          adminApi.get<Project>(
            `/real-estate/projects/${projectId}`,
          ),

          adminApi.get<Amenity[]>(
            "/real-estate/amenities",
          ),

          adminApi.get<
            Array<{
              id: string;
              name: string;
            }>
          >("/catalog/projects"),

          adminApi.get<Readiness>(
            `/real-estate/projects/${projectId}/readiness`,
          ),
        ]);

      setItem(normalizeProject(projectResult));

      setAmenities(
        safeArray(amenitiesResult),
      );

      setProjects(
        safeArray(projectsResult),
      );

      setReadiness({
        ready: readyResult?.ready ?? false,
        missing: safeArray(
          readyResult?.missing,
        ),
        imageCount:
          readyResult?.imageCount ?? 0,
      });
    } catch (e) {
      setError(adminErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    params
      .then(({ id: projectId }) => {
        if (!mounted) return;

        setId(projectId);

        return load(projectId);
      })
      .catch((e) => {
        if (!mounted) return;
        setError(adminErrorMessage(e));
        setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [params]);

  async function save(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!id) return;

    setSaved(false);
    setError("");

    const form = new FormData(
      event.currentTarget,
    );

    const data: Record<string, any> =
      Object.fromEntries(form);

    for (const key of [
      "launchYear",
      "deliveryYear",
      "numberOfPhases",
      "totalUnits",
      "minBedrooms",
      "maxBedrooms",
      "totalLandArea",
      "builtUpPercentage",
      "minArea",
      "maxArea",
      "latitude",
      "longitude",
    ]) {
      if (
        data[key] === "" ||
        data[key] == null
      ) {
        delete data[key];
      } else {
        const parsed = Number(data[key]);

        if (Number.isFinite(parsed)) {
          data[key] = parsed;
        } else {
          delete data[key];
        }
      }
    }

    for (const key of [
      "finishingOptions",
      "unitTypes",
      "customerFit",
    ]) {
      data[key] = csv(form.get(key));
    }

    if (form.has("gatedCommunity")) {
      data.gatedCommunity =
        form.get("gatedCommunity") === "true";
    }

    try {
      await adminApi.patch(
        `/real-estate/projects/${id}`,
        data,
      );

      setSaved(true);

      await load(id);
    } catch (e) {
      setError(adminErrorMessage(e));
    }
  }

  async function investment(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const form = new FormData(
      event.currentTarget,
    );

    const data: Record<string, any> =
      Object.fromEntries(form);

    for (const key of [
      "suitableForLiving",
      "suitableForInvestment",
      "suitableForRental",
    ]) {
      data[key] =
        form.get(key) === "true";
    }

    for (const key of [
      "expectedRentalYieldMin",
      "expectedRentalYieldMax",
    ]) {
      if (!data[key]) {
        delete data[key];
      } else {
        data[key] = Number(data[key]);
      }
    }

    for (const key of [
      "strongestUnitTypes",
      "targetCustomers",
      "investmentAdvantages",
      "investmentRisks",
    ]) {
      data[key] = csv(form.get(key));
    }

    try {
      await adminApi.patch(
        `/real-estate/projects/${id}/investment`,
        data,
      );

      await load(id);
    } catch (e) {
      setError(adminErrorMessage(e));
    }
  }

  async function setProjectAmenities(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const ids = new FormData(
      event.currentTarget,
    )
      .getAll("amenityIds")
      .map(String);

    try {
      await adminApi.patch(
        `/real-estate/projects/${id}/amenities`,
        {
          amenityIds: ids,
        },
      );

      await load(id);
    } catch (e) {
      setError(adminErrorMessage(e));
    }
  }

  async function createAmenity() {
    const canonicalName = prompt(
      "الاسم المعتمد للمرفق",
    )?.trim();

    if (!canonicalName) return;

    const nameAr =
      prompt(
        "الاسم بالعربية (اختياري)",
      )?.trim() || undefined;

    try {
      await adminApi.post(
        "/real-estate/amenities",
        {
          canonicalName,
          nameAr,
        },
      );

      await load(id);
    } catch (e) {
      setError(adminErrorMessage(e));
    }
  }

  async function landmark(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const form = new FormData(
      event.currentTarget,
    );

    const data: Record<string, any> =
      Object.fromEntries(form);

    for (const key of [
      "distanceKm",
      "estimatedMinutes",
    ]) {
      if (!data[key]) {
        delete data[key];
      } else {
        data[key] = Number(data[key]);
      }
    }

    try {
      await adminApi.post(
        `/real-estate/projects/${id}/landmarks`,
        data,
      );

      event.currentTarget.reset();

      await load(id);
    } catch (e) {
      setError(adminErrorMessage(e));
    }
  }

  async function competitors(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const projectIds = new FormData(
      event.currentTarget,
    )
      .getAll("projectIds")
      .map(String);

    try {
      await adminApi.patch(
        `/real-estate/projects/${id}/competitors`,
        {
          projectIds,
        },
      );

      await load(id);
    } catch (e) {
      setError(adminErrorMessage(e));
    }
  }

  async function uploadMedia(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const form = new FormData(
      event.currentTarget,
    );

    form.append("projectId", id);

    try {
      await adminApi.upload(
        "/catalog/media",
        form,
      );

      event.currentTarget.reset();

      await load(id);
    } catch (e) {
      setError(adminErrorMessage(e));
    }
  }

  async function updateMedia(
    mediaId: string,
    data: Record<string, unknown>,
  ) {
    try {
      await adminApi.patch(
        `/catalog/media/${mediaId}`,
        data,
      );

      await load(id);
    } catch (e) {
      setError(adminErrorMessage(e));
    }
  }

  async function uploadDocument(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const form = new FormData(
      event.currentTarget,
    );

    form.append("projectId", id);

    try {
      await adminApi.upload(
        "/catalog/documents",
        form,
      );

      event.currentTarget.reset();

      await load(id);
    } catch (e) {
      setError(adminErrorMessage(e));
    }
  }

  async function addPaymentPlan(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const form = new FormData(
      event.currentTarget,
    );

    const data: Record<string, any> =
      Object.fromEntries(form);

    for (const key of [
      "durationMonths",
      "downPaymentAmount",
      "downPaymentPercent",
      "totalPrice",
      "totalPriceOverride",
      "discountAmount",
      "discountPercent",
      "installmentAmount",
      "maintenanceAmount",
      "maintenancePercent",
    ]) {
      if (
        data[key] === "" ||
        data[key] == null
      ) {
        delete data[key];
      } else {
        data[key] = Number(data[key]);
      }
    }

    for (const key of [
      "validFrom",
      "validTo",
    ]) {
      if (!data[key]) {
        delete data[key];
      }
    }

    try {
      await adminApi.post(
        `/catalog/projects/${id}/payment-plans`,
        data,
      );

      event.currentTarget.reset();

      await load(id);
    } catch (e) {
      setError(adminErrorMessage(e));
    }
  }

  if (loading && !item) {
    return (
      <main
        className="p-8"
        dir="rtl"
      >
        جارٍ تحميل المشروع…
      </main>
    );
  }

  if (!item) {
    return (
      <main
        className="p-8"
        dir="rtl"
      >
        <div className="rounded-2xl border bg-white p-6">
          <h1 className="text-xl font-bold">
            تعذر فتح المشروع
          </h1>

          <p className="mt-2 text-sm text-red-700">
            {error ||
              "المشروع غير موجود أو تعذر تحميل بياناته."}
          </p>

          <a
            href="/admin/projects"
            className="mt-4 inline-block rounded-xl border px-4 py-2 font-bold"
          >
            العودة للمشروعات
          </a>
        </div>
      </main>
    );
  }

  const projectAmenities =
    safeArray(item.amenities);

  const projectLandmarks =
    safeArray(item.landmarks);

  const projectCompetitors =
    safeArray(item.competitorsFrom);

  const projectMedia =
    safeArray(item.media);

  const projectDocuments =
    safeArray(item.documents);

  const paymentPlans =
    safeArray(item.paymentPlans);

  const fields: Array<
    [string, string]
  > = [
    [
      "canonicalName",
      "الاسم المعتمد",
    ],
    ["nameAr", "الاسم بالعربية"],
    ["nameEn", "الاسم بالإنجليزية"],
    [
      "officialWebsite",
      "الموقع الرسمي",
    ],
    [
      "formattedAddress",
      "العنوان المنسق",
    ],
    [
      "googlePlaceId",
      "Google Place ID",
    ],
    ["projectType", "نوع المشروع"],
    ["projectStatus", "حالة المشروع"],
    [
      "deliveryStatus",
      "حالة التسليم",
    ],
  ];

  return (
    <main
      className="mx-auto max-w-7xl p-4 sm:p-8"
      dir="rtl"
    >
      <a
        href="/admin/projects"
        className="text-sm text-forest"
      >
        ← المشروعات
      </a>

      <div className="mt-3 flex flex-wrap justify-between gap-3">
        <div>
          <h1
            className="text-2xl font-bold"
            dir="auto"
          >
            {item.nameAr ||
              item.name ||
              item.nameEn ||
              "مشروع بدون اسم"}
          </h1>

          <p
            className="mt-1 text-sm text-[#68756f]"
            dir="auto"
          >
            {displayDeveloper(
              item.developer,
            )}
            {" · "}
            {displayLocation(item.location)}
          </p>

          {readiness && (
            <p
              className={`mt-2 text-xs font-bold ${
                readiness.ready
                  ? "text-green-700"
                  : "text-amber-700"
              }`}
            >
              {readiness.ready
                ? "جاهز للعرض للعملاء"
                : readiness.missing.length
                  ? `غير مكتمل: ${readiness.missing.join("، ")}`
                  : "المشروع يحتاج مراجعة قبل عرضه للعملاء"}
            </p>
          )}
        </div>

        <a
          href={`/admin/projects/${id}/knowledge`}
          className="rounded-xl border px-4 py-2 text-sm font-bold"
        >
          معرفة المشروع (
          {item._count?.knowledgeItems ??
            0}
          )
        </a>
      </div>

      {error && (
        <div className="mt-4 rounded-xl bg-red-50 p-4 text-red-800">
          {error}
        </div>
      )}

      <form
        onSubmit={save}
        className="mt-6 space-y-5"
      >
        <section className="rounded-2xl border bg-white p-5">
          <div className="flex flex-wrap justify-between gap-3">
            <h2 className="font-bold">
              البيانات الأساسية والموقع
            </h2>

            <select
              name="adminStatus"
              defaultValue={
                item.adminStatus ??
                "DRAFT"
              }
              className="rounded-lg border px-2 text-sm"
            >
              <option value="DRAFT">
                مسودة
              </option>

              <option value="READY_FOR_CUSTOMER">
                جاهز للعملاء
              </option>

              <option value="ARCHIVED">
                مؤرشف
              </option>
            </select>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {fields.map(
              ([key, label]) => (
                <label
                  key={key}
                  className="text-sm"
                >
                  {label}

                  <input
                    name={key}
                    defaultValue={
                      item[key] ?? ""
                    }
                    className="mt-1 h-11 w-full rounded-xl border px-3"
                    dir="auto"
                  />
                </label>
              ),
            )}

            {[
              [
                "launchYear",
                "سنة الإطلاق",
              ],
              [
                "deliveryYear",
                "سنة التسليم",
              ],
              ["latitude", "خط العرض"],
              [
                "longitude",
                "خط الطول",
              ],
            ].map(([key, label]) => (
              <label
                key={key}
                className="text-sm"
              >
                {label}

                <input
                  name={key}
                  type="number"
                  step="any"
                  defaultValue={
                    item[key] ?? ""
                  }
                  className="mt-1 h-11 w-full rounded-xl border px-3"
                />
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-5">
          <h2 className="font-bold">
            الوصف والتسليم
          </h2>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              [
                "shortDescriptionAr",
                "نبذة عربية",
              ],
              [
                "shortDescriptionEn",
                "نبذة إنجليزية",
              ],
              [
                "fullDescriptionAr",
                "وصف عربي كامل",
              ],
              [
                "fullDescriptionEn",
                "وصف إنجليزي كامل",
              ],
              [
                "deliveryInformation",
                "تفاصيل التسليم",
              ],
              [
                "densityDescription",
                "وصف الكثافة",
              ],
            ].map(([key, label]) => (
              <label
                key={key}
                className="text-sm"
              >
                {label}

                <textarea
                  name={key}
                  defaultValue={
                    item[key] ?? ""
                  }
                  className="mt-1 min-h-24 w-full rounded-xl border p-3"
                  dir="auto"
                />
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-5">
          <h2 className="font-bold">
            المخطط ونطاق الوحدات
          </h2>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              [
                "totalLandArea",
                "مساحة الأرض",
              ],
              [
                "builtUpPercentage",
                "نسبة البناء",
              ],
              [
                "numberOfPhases",
                "عدد المراحل",
              ],
              [
                "totalUnits",
                "إجمالي الوحدات",
              ],
              [
                "minArea",
                "أقل مساحة",
              ],
              [
                "maxArea",
                "أكبر مساحة",
              ],
              [
                "minBedrooms",
                "أقل غرف",
              ],
              [
                "maxBedrooms",
                "أكبر غرف",
              ],
            ].map(([key, label]) => (
              <label
                key={key}
                className="text-sm"
              >
                {label}

                <input
                  type="number"
                  step="any"
                  name={key}
                  defaultValue={
                    item[key] ?? ""
                  }
                  className="mt-1 h-11 w-full rounded-xl border px-3"
                />
              </label>
            ))}
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              أنواع الوحدات

              <input
                name="unitTypes"
                defaultValue={safeArray(
                  item.unitTypes,
                ).join(", ")}
                className="mt-1 h-11 w-full rounded-xl border px-3"
              />
            </label>

            <label className="text-sm">
              خيارات التشطيب

              <input
                name="finishingOptions"
                defaultValue={safeArray(
                  item.finishingOptions,
                ).join(", ")}
                className="mt-1 h-11 w-full rounded-xl border px-3"
              />
            </label>

            <label className="text-sm">
              ملاءمة العملاء

              <input
                name="customerFit"
                defaultValue={safeArray(
                  item.customerFit,
                ).join(", ")}
                className="mt-1 h-11 w-full rounded-xl border px-3"
              />
            </label>
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-5">
          <h2 className="font-bold">
            الملخص التجاري
          </h2>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              [
                "priceSummary",
                "ملخص الأسعار",
              ],
              [
                "paymentSummary",
                "ملخص السداد",
              ],
              [
                "maintenanceSummary",
                "ملخص الصيانة",
              ],
              [
                "clubFeesSummary",
                "ملخص رسوم النادي",
              ],
            ].map(([key, label]) => (
              <label
                key={key}
                className="text-sm"
              >
                {label}

                <textarea
                  name={key}
                  defaultValue={
                    item[key] ?? ""
                  }
                  className="mt-1 min-h-20 w-full rounded-xl border p-3"
                />
              </label>
            ))}
          </div>
        </section>

        <button className="h-11 rounded-xl bg-forest px-6 font-bold text-white">
          حفظ المشروع
        </button>

        {saved && (
          <span className="mr-3 text-sm text-green-700">
            تم الحفظ
          </span>
        )}
      </form>

      <form
        onSubmit={investment}
        className="mt-6 rounded-2xl border bg-white p-5"
      >
        <h2 className="font-bold">
          الاستثمار وإعادة البيع والإيجار
        </h2>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            [
              "suitableForLiving",
              "مناسب للسكن",
            ],
            [
              "suitableForInvestment",
              "مناسب للاستثمار",
            ],
            [
              "suitableForRental",
              "مناسب للإيجار",
            ],
          ].map(([key, label]) => (
            <label
              key={key}
              className="text-sm"
            >
              {label}

              <select
                name={key}
                defaultValue={String(
                  item.investmentProfile?.[
                    key
                  ] ?? false,
                )}
                className="mt-1 h-11 w-full rounded-xl border px-3"
              >
                <option value="true">
                  نعم
                </option>
                <option value="false">
                  لا
                </option>
              </select>
            </label>
          ))}

          {[
            [
              "resaleDemand",
              "طلب إعادة البيع",
            ],
            [
              "rentalDemand",
              "الطلب الإيجاري",
            ],
          ].map(([key, label]) => (
            <label
              key={key}
              className="text-sm"
            >
              {label}

              <select
                name={key}
                defaultValue={
                  item
                    .investmentProfile?.[
                    key
                  ] || "UNKNOWN"
                }
                className="mt-1 h-11 w-full rounded-xl border px-3"
              >
                <option value="UNKNOWN">
                  غير معروف
                </option>

                <option value="LOW">
                  منخفض
                </option>

                <option value="MEDIUM">
                  متوسط
                </option>

                <option value="HIGH">
                  مرتفع
                </option>
              </select>
            </label>
          ))}

          <label className="text-sm">
            عائد إيجاري أدنى

            <input
              name="expectedRentalYieldMin"
              type="number"
              step="any"
              defaultValue={
                item.investmentProfile
                  ?.expectedRentalYieldMin ??
                ""
              }
              className="mt-1 h-11 w-full rounded-xl border px-3"
            />
          </label>

          <label className="text-sm">
            عائد إيجاري أقصى

            <input
              name="expectedRentalYieldMax"
              type="number"
              step="any"
              defaultValue={
                item.investmentProfile
                  ?.expectedRentalYieldMax ??
                ""
              }
              className="mt-1 h-11 w-full rounded-xl border px-3"
            />
          </label>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {[
            [
              "strongestUnitTypes",
              "أقوى أنواع الوحدات",
            ],
            [
              "targetCustomers",
              "العملاء المستهدفون",
            ],
            [
              "investmentAdvantages",
              "مزايا الاستثمار",
            ],
            [
              "investmentRisks",
              "المخاطر",
            ],
          ].map(([key, label]) => (
            <label
              key={key}
              className="text-sm"
            >
              {label}

              <input
                name={key}
                defaultValue={safeArray(
                  item.investmentProfile?.[
                    key
                  ],
                ).join(", ")}
                className="mt-1 h-11 w-full rounded-xl border px-3"
              />
            </label>
          ))}
        </div>

        <button className="mt-4 h-11 rounded-xl border border-forest px-5 font-bold text-forest">
          حفظ التحليل الموثق
        </button>
      </form>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <form
          onSubmit={setProjectAmenities}
          className="rounded-2xl border bg-white p-5"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-bold">
              الخدمات والمرافق
            </h2>

            <button
              type="button"
              onClick={createAmenity}
              className="rounded-lg border px-3 py-1 text-xs font-bold"
            >
              إضافة مرفق
            </button>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {amenities.map((amenity) => (
              <label
                key={amenity.id}
                className="flex items-center gap-2 rounded-lg border p-2 text-sm"
              >
                <input
                  type="checkbox"
                  name="amenityIds"
                  value={amenity.id}
                  defaultChecked={projectAmenities.some(
                    (x) =>
                      x.amenityId ===
                      amenity.id,
                  )}
                />

                <span dir="auto">
                  {amenity.nameAr ||
                    amenity.canonicalName}
                </span>
              </label>
            ))}
          </div>

          <button className="mt-4 h-10 rounded-xl border px-4 font-bold">
            حفظ المرافق
          </button>
        </form>

        <form
          onSubmit={competitors}
          className="rounded-2xl border bg-white p-5"
        >
          <h2 className="font-bold">
            المشروعات المنافسة
          </h2>

          <div className="mt-4 grid gap-2">
            {projects
              .filter(
                (project) =>
                  project.id !== id,
              )
              .map((project) => (
                <label
                  key={project.id}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    name="projectIds"
                    value={project.id}
                    defaultChecked={projectCompetitors.some(
                      (relation) =>
                        relation
                          .competitorProject
                          ?.id ===
                        project.id,
                    )}
                  />

                  <span dir="auto">
                    {project.name}
                  </span>
                </label>
              ))}
          </div>

          <button className="mt-4 h-10 rounded-xl border px-4 font-bold">
            حفظ المنافسين
          </button>
        </form>
      </div>

      <section className="mt-6 rounded-2xl border bg-white p-5">
        <h2 className="font-bold">
          المعالم القريبة والمسافات
        </h2>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {projectLandmarks.map(
            (landmark: any) => (
              <div
                key={landmark.id}
                className="rounded-xl border p-3"
              >
                <p
                  className="font-bold"
                  dir="auto"
                >
                  {landmark.name ||
                    "معلم بدون اسم"}
                </p>

                <p className="text-xs text-[#68756f]">
                  {landmark.distanceKm
                    ? `${landmark.distanceKm} كم`
                    : ""}

                  {landmark.estimatedMinutes
                    ? ` · ${landmark.estimatedMinutes} دقيقة`
                    : ""}

                  {landmark.distanceType
                    ? ` · ${landmark.distanceType}`
                    : ""}
                </p>
              </div>
            ),
          )}
        </div>

        <form
          onSubmit={landmark}
          className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-3"
        >
          <input
            required
            name="name"
            placeholder="اسم المعلم"
            className="h-11 rounded-xl border px-3"
          />

          <input
            name="category"
            placeholder="الفئة: جامعة، طريق..."
            className="h-11 rounded-xl border px-3"
          />

          <input
            name="distanceKm"
            type="number"
            step="any"
            placeholder="المسافة كم"
            className="h-11 rounded-xl border px-3"
          />

          <input
            name="estimatedMinutes"
            type="number"
            placeholder="المدة بالدقائق"
            className="h-11 rounded-xl border px-3"
          />

          <select
            name="distanceType"
            className="h-11 rounded-xl border px-3"
          >
            <option value="ADMIN_VERIFIED">
              موثق من الإدارة
            </option>

            <option value="GOOGLE_ROUTES">
              Google Routes
            </option>

            <option value="APPROXIMATE">
              تقريبي
            </option>
          </select>

          <button className="h-11 rounded-xl border border-forest font-bold text-forest">
            إضافة معلم
          </button>
        </form>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border bg-white p-5">
          <h2 className="font-bold">
            صور المشروع العامة
          </h2>
          <p className="mt-1 text-xs text-[#68756f]">صور الكمباوند والـ Master Plan والخريطة فقط. صور ومخططات كل وحدة تُرفع من صفحة المخزون على الوحدة نفسها.</p>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {projectMedia.map(
              (media: any) => (
                <div
                  key={media.id}
                  className="rounded-xl border p-3"
                >
                  {media.url ? (
                    <img
                      src={media.url}
                      alt={
                        media.altTextAr ||
                        media.altText ||
                        ""
                      }
                      className="h-28 w-full rounded-lg object-cover"
                    />
                  ) : (
                    <div className="flex h-28 items-center justify-center rounded-lg bg-gray-100 text-xs text-gray-500">
                      لا توجد صورة
                    </div>
                  )}

                  <p
                    className="mt-2 text-xs"
                    dir="auto"
                  >
                    {media.altTextAr ||
                      media.altTextEn ||
                      media.type ||
                      "وسائط"}
                  </p>

                  <div className="mt-2 flex gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        updateMedia(
                          media.id,
                          {
                            isCover: true,
                          },
                        )
                      }
                      className={`rounded-lg border px-2 py-1 text-[11px] ${
                        media.isCover
                          ? "bg-forest text-white"
                          : ""
                      }`}
                    >
                      غلاف
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        updateMedia(
                          media.id,
                          {
                            sortOrder:
                              Math.max(
                                0,
                                (media.sortOrder ||
                                  0) - 1,
                              ),
                          },
                        )
                      }
                      className="rounded-lg border px-2 py-1 text-[11px]"
                    >
                      أعلى
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        updateMedia(
                          media.id,
                          {
                            sortOrder:
                              (media.sortOrder ||
                                0) + 1,
                          },
                        )
                      }
                      className="rounded-lg border px-2 py-1 text-[11px]"
                    >
                      أسفل
                    </button>
                  </div>
                </div>
              ),
            )}
          </div>

          <form
            onSubmit={uploadMedia}
            className="mt-4 grid gap-2 border-t pt-4 sm:grid-cols-2"
          >
            <input
              required
              type="file"
              name="file"
              accept="image/*"
              className="rounded-xl border p-2 text-sm"
            />

            <select
              name="type"
              className="h-11 rounded-xl border px-3"
            >
              <option value="IMAGE">
                صورة
              </option>
              <option value="MASTER_PLAN">
                Master plan
              </option>
              <option value="MAP">
                خريطة
              </option>
            </select>

            <input
              name="altTextAr"
              placeholder="وصف الصورة بالعربية"
              className="h-11 rounded-xl border px-3"
            />

            <input
              name="altTextEn"
              placeholder="Alt text in English"
              className="h-11 rounded-xl border px-3"
            />

            <button className="h-11 rounded-xl border border-forest font-bold text-forest">
              رفع الوسائط
            </button>
          </form>
        </div>

        <div className="rounded-2xl border bg-white p-5">
          <h2 className="font-bold">
            المستندات
          </h2>

          <div className="mt-4 space-y-2">
            {projectDocuments.map(
              (document: any) => (
                <a
                  key={document.id}
                  href={document.url || "#"}
                  target={
                    document.url
                      ? "_blank"
                      : undefined
                  }
                  rel="noreferrer"
                  className="block rounded-xl border p-3 text-sm"
                  dir="auto"
                >
                  {document.name ||
                    "مستند"}
                  {document.type
                    ? ` · ${document.type}`
                    : ""}
                </a>
              ),
            )}
          </div>

          <form
            onSubmit={uploadDocument}
            className="mt-4 grid gap-2 border-t pt-4"
          >
            <input
              required
              type="file"
              name="file"
              accept=".pdf,.docx,.txt"
              className="rounded-xl border p-2 text-sm"
            />

            <select
              name="type"
              className="h-11 rounded-xl border px-3"
            >
              <option value="BROCHURE">
                بروشور
              </option>

              <option value="PAYMENT_PLAN">
                خطة سداد
              </option>

              <option value="KNOWLEDGE_SOURCE">
                مصدر معرفة
              </option>

              <option value="OTHER">
                أخرى
              </option>
            </select>

            <div className="grid grid-cols-2 gap-2">
              <input
                name="language"
                placeholder="اللغة"
                className="h-11 rounded-xl border px-3"
              />

              <input
                name="source"
                placeholder="المصدر"
                className="h-11 rounded-xl border px-3"
              />
            </div>

            <button className="h-11 rounded-xl border border-forest font-bold text-forest">
              رفع المستند
            </button>
          </form>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border bg-white p-5">
        <h2 className="font-bold">
          خطط السداد اليدوية
        </h2>

        <p className="mt-1 text-sm text-[#68756f]">
          اكتب سعر الوحدة الأساسي مرة واحدة في المخزون، ثم عرّف لكل مدة سداد المقدم والخصم أو السعر النهائي فقط. الخطة تُطبّق على كل وحدات المشروع ما لم توجد خطة خاصة بالوحدة.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {paymentPlans.map(
            (plan: any) => (
              <div
                key={plan.id}
                className="rounded-xl border p-3"
              >
                <p
                  className="font-bold"
                  dir="auto"
                >
                  {plan.name ||
                    "خطة سداد"}
                </p>

                <p className="mt-1 text-xs text-[#68756f]">
                  {plan.durationMonths ? `${plan.durationMonths} شهر` : "مدة غير محددة"}
                  {" · "}{plan.currency || "EGP"}
                </p>
                {(plan.discountPercent || plan.discountAmount || plan.totalPriceOverride || plan.totalPrice) && (
                  <p className="mt-2 rounded-lg bg-[#f5f4ef] p-2 text-xs">
                    {plan.discountPercent ? `خصم ${Number(plan.discountPercent)}% من سعر الوحدة` : plan.discountAmount ? `خصم ${Number(plan.discountAmount).toLocaleString("en")} ${plan.currency || "EGP"}` : plan.totalPriceOverride || plan.totalPrice ? `سعر نهائي ثابت ${Number(plan.totalPriceOverride || plan.totalPrice).toLocaleString("en")} ${plan.currency || "EGP"}` : ""}
                  </p>
                )}
              </div>
            ),
          )}
        </div>

        <form
          onSubmit={addPaymentPlan}
          className="mt-5 grid gap-3 border-t pt-5 sm:grid-cols-2 lg:grid-cols-4"
        >
          <input
            required
            name="name"
            placeholder="اسم الخطة"
            className="h-11 rounded-xl border px-3"
          />

          <input
            name="durationMonths"
            type="number"
            min="18"
            max="180"
            placeholder="المدة بالشهور"
            className="h-11 rounded-xl border px-3"
          />

          <input
            name="downPaymentAmount"
            type="number"
            min="0"
            step="any"
            placeholder="مبلغ المقدم"
            className="h-11 rounded-xl border px-3"
          />

          <input
            name="downPaymentPercent"
            type="number"
            min="0"
            max="100"
            step="any"
            placeholder="نسبة المقدم"
            className="h-11 rounded-xl border px-3"
          />

          <input
            name="totalPriceOverride"
            type="number"
            min="0"
            step="any"
            placeholder="سعر نهائي ثابت للخطة (اختياري)"
            className="h-11 rounded-xl border px-3"
          />

          <input
            name="discountPercent"
            type="number"
            min="0"
            max="100"
            step="any"
            placeholder="خصم % من سعر الوحدة"
            className="h-11 rounded-xl border px-3"
          />

          <input
            name="discountAmount"
            type="number"
            min="0"
            step="any"
            placeholder="خصم مبلغ ثابت"
            className="h-11 rounded-xl border px-3"
          />

          <input
            name="installmentAmount"
            type="number"
            min="0"
            step="any"
            placeholder="قيمة القسط"
            className="h-11 rounded-xl border px-3"
          />

          <select
            name="installmentFrequency"
            className="h-11 rounded-xl border px-3"
          >
            <option value="">
              دورية القسط
            </option>

            <option value="MONTHLY">
              شهري
            </option>

            <option value="QUARTERLY">
              ربع سنوي
            </option>

            <option value="SEMI_ANNUAL">
              نصف سنوي
            </option>

            <option value="ANNUAL">
              سنوي
            </option>

            <option value="CUSTOM">
              مخصص
            </option>
          </select>

          <select
            name="currency"
            defaultValue="EGP"
            className="h-11 rounded-xl border px-3"
          >
            <option value="EGP">
              EGP
            </option>
            <option value="USD">
              USD
            </option>
            <option value="EUR">
              EUR
            </option>
            <option value="AED">
              AED
            </option>
            <option value="SAR">
              SAR
            </option>
            <option value="GBP">
              GBP
            </option>
          </select>

          <input
            name="maintenanceAmount"
            type="number"
            min="0"
            step="any"
            placeholder="مبلغ الصيانة"
            className="h-11 rounded-xl border px-3"
          />

          <input
            name="maintenancePercent"
            type="number"
            min="0"
            max="100"
            step="any"
            placeholder="نسبة الصيانة"
            className="h-11 rounded-xl border px-3"
          />

          <label className="text-xs">
            صالح من

            <input
              name="validFrom"
              type="date"
              className="mt-1 h-11 w-full rounded-xl border px-3"
            />
          </label>

          <label className="text-xs">
            صالح حتى

            <input
              name="validTo"
              type="date"
              className="mt-1 h-11 w-full rounded-xl border px-3"
            />
          </label>

          <textarea
            name="notes"
            placeholder="ملاحظات أو وصف قاعدة السعر"
            className="min-h-20 rounded-xl border p-3 sm:col-span-2 lg:col-span-3"
          />

          <button className="h-11 rounded-xl bg-forest px-5 font-bold text-white">
            إضافة خطة
          </button>
        </form>
      </section>

      <ProjectSpatialEditor projectId={id} media={projectMedia as any[]} />
    </main>
  );
}