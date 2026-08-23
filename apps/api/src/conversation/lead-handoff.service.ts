import { Injectable } from "@nestjs/common";
import { LeadStatus } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { StructuredIntent } from "../providers/ai-provider";
import { CustomerTrustService } from "../customer-trust.service";
import { ConversationFormatterService } from "./conversation-formatter.service";
import { nextPresentation, UIAction } from "../customer-turn-planner";
import { PaymentPresenterService } from "./payment-presenter.service";
import { PropertyPresenterService } from "./property-presenter.service";

export function leadPersistenceAction(
  existingLeadId: string | undefined,
  phone: string | undefined,
  intentScore = 0,
): "update" | "create" | "none" {
  if (!phone) return "none";
  if (existingLeadId) return "update";
  return intentScore >= 70 ? "create" : "none";
}

export type LeadHandoffResult = {
  lead: any | null;
  payload?: {
    type: "lead_prompt" | "lead_created";
    leadId?: string;
    uiActions: UIAction[];
  };
  directAnswer?: string;
  trustTrace?: Record<string, unknown>;
};

/**
 * Manages lead capture, validation, and handoff to sales.
 * Extracted from ChatService for domain separation.
 */
@Injectable()
export class LeadHandoffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trust: CustomerTrustService,
    private readonly formatter: ConversationFormatterService,
    private readonly paymentPresenter: PaymentPresenterService,
    private readonly propertyPresenter: PropertyPresenterService,
  ) {}

  async handleLeadCapture(params: {
    conversationId: string;
    content: string;
    state: StructuredIntent;
    previous: StructuredIntent;
    plan: { intent: string; exactUnitId?: string };
    handoffUnit: any | null;
    priorHandoffStage: string | undefined;
    priorPresentation: any;
    priorUnitIds: string[];
  }): Promise<LeadHandoffResult> {
    const { conversationId, content, state, previous, plan, handoffUnit, priorHandoffStage, priorPresentation, priorUnitIds } = params;
    const ar = state.language?.startsWith("ar") ?? true;
    const handoffUnitLabel = this.formatter.humanUnitLabel(handoffUnit, ar);
    const leadIntentTurn = ["VIEWING_REQUEST", "CONTACT_REQUEST"].includes(plan.intent);
    const shouldHandleLead = leadIntentTurn || ["PAYMENT", "IDENTITY", "CONFIRMATION", "CONTACT_PREFERENCES"].includes(String(priorHandoffStage ?? ""));

    if (!shouldHandleLead) return { lead: null };

    let existingLead = await this.prisma.lead.findFirst({
      where: { conversationId, status: { notIn: [LeadStatus.WON, LeadStatus.LOST] } },
      orderBy: { createdAt: "desc" },
    });
    let trustTrace: Record<string, unknown> | undefined;

    if (existingLead) {
      state.contactName ||= existingLead.name;
      state.contactPhone ||= existingLead.phone;
      state.preferredContactChannel ||= (existingLead.preferredContactChannel as StructuredIntent["preferredContactChannel"]) ?? undefined;
      state.preferredConfirmationChannel ||= (existingLead.preferredConfirmationChannel as StructuredIntent["preferredConfirmationChannel"]) ?? undefined;
      state.preferredVisitDayPart ||= (existingLead.preferredVisitDayPart as StructuredIntent["preferredVisitDayPart"]) ?? undefined;
      state.preferredVisitTiming ||= (existingLead.preferredVisitTiming as StructuredIntent["preferredVisitTiming"]) ?? undefined;
      const existingPayload = existingLead.payload && typeof existingLead.payload === "object" && !Array.isArray(existingLead.payload)
        ? existingLead.payload as Record<string, any>
        : {};
      state.preferredPaymentMode ||= existingPayload?.requirements?.preferredPaymentMode ?? existingPayload?.conversationSummary?.preferredPaymentMode ?? undefined;
    }

    const selectedUnitId = state.presentation?.selectedUnitId ?? priorPresentation.selectedUnitId;
    // SMS/email confirmation redirect
    if (priorHandoffStage === "CONFIRMATION" && /(?:sms|رساله|رسالة|ايميل|إيميل|email|mail)/iu.test(content) && !state.preferredConfirmationChannel) {
      return {
        lead: existingLead,
        payload: { type: existingLead ? "lead_created" : "lead_prompt", leadId: existingLead?.id, uiActions: [{ type: "CONTACT_REQUEST", payload: { stage: "CONFIRMATION", needsConfirmationChannel: true, unitLabel: handoffUnitLabel } }] },
        directAnswer: ar
          ? "المتاح عندي لتأكيد الموعد حاليًا **مكالمة** أو **واتساب** فقط. اختار الأنسب لك."
          : "Appointment confirmation is currently available by **call** or **WhatsApp** only. Pick whichever suits you.",
      };
    }

    // Generic viewing request without unit selection
    if (plan.intent === "VIEWING_REQUEST" && !selectedUnitId && !plan.exactUnitId) {
      state.presentation = nextPresentation(state.presentation ?? priorPresentation, {
        lastOfferedAction: priorPresentation.searchCandidateIds?.length ? "PROPERTY_CARDS" : undefined,
        awaitingConfirmation: Boolean(priorPresentation.searchCandidateIds?.length),
      });
      return {
        lead: null,
        payload: { type: "lead_prompt", uiActions: [] },
        directAnswer: ar
          ? "تمام، بس قبل المعاينة لازم نحدد الوحدة نفسها. اختار وحدة من الكروت اللي ظهرت، أو قولي مواصفات الوحدة اللي عايزها وأنا أوصلها لك."
          : "Sure, but we need to identify the exact unit before a viewing. Pick one of the shown cards, or tell me the unit requirements and I'll narrow it down.",
      };
    }

    // A verified payment route is a required decision before identity capture.
    if (handoffUnit) {
      const choices = this.paymentPresenter.paymentChoices(handoffUnit);
      const hasPaymentChoice = choices.hasCash || choices.hasInstallment;
      if (!state.preferredPaymentMode && hasPaymentChoice) {
        if (choices.hasCash && !choices.hasInstallment) state.preferredPaymentMode = "CASH";
        else if (!choices.hasCash && choices.hasInstallment) state.preferredPaymentMode = "INSTALLMENT";
        else {
          state.presentation = nextPresentation(state.presentation ?? priorPresentation, {
            lastOfferedAction: "CONTACT_REQUEST",
            awaitingConfirmation: true,
            leadHandoffStage: "PAYMENT",
          });
          return {
            lead: existingLead,
            payload: {
              type: "lead_prompt",
              uiActions: [{
                type: "PAYMENT_CHOICES",
                payload: { unit: this.propertyPresenter.cardProperty(handoffUnit), choices: JSON.parse(JSON.stringify(choices)), unitLabel: handoffUnitLabel },
              }],
            },
          };
        }
      }
    }

    const waitingForPayment = state.presentation?.leadHandoffStage === "PAYMENT" && !state.preferredPaymentMode;
    if (waitingForPayment) return { lead: existingLead };
    if (state.preferredPaymentMode && priorHandoffStage === "PAYMENT") {
      state.presentation = nextPresentation(state.presentation ?? priorPresentation, {
        lastOfferedAction: "CONTACT_REQUEST",
        awaitingConfirmation: true,
        leadHandoffStage: "IDENTITY",
      });
    }

    const contactCandidateInTurn = Boolean(
      (state.contactName && state.contactName !== previous.contactName) ||
      (state.contactPhone && state.contactPhone !== previous.contactPhone) ||
      /(?:\+?\d[\d\s().-]{3,}\d)/u.test(content),
    );
    const identityStage = priorHandoffStage === "IDENTITY" || (state.presentation?.leadHandoffStage === "IDENTITY" && priorHandoffStage !== "PAYMENT");

    // Contact validation
    if ((!existingLead || contactCandidateInTurn) && (identityStage || (leadIntentTurn && Boolean(selectedUnitId || plan.intent === "CONTACT_REQUEST")))) {
      const assessment = await this.trust.assessContact({
        conversationId,
        content,
        state,
        contactExpected: identityStage || Boolean(state.contactName || state.contactPhone),
      });
      trustTrace = { level: assessment.level, score: assessment.score, reasons: assessment.reasons, learnedFromFeedback: assessment.learnedFromFeedback };

      if (assessment.candidateName) state.contactName = assessment.candidateName;
      if (assessment.normalizedPhone) state.contactPhone = assessment.normalizedPhone;
      if (assessment.preferredVisitDayPart) state.preferredVisitDayPart = assessment.preferredVisitDayPart;
      if (assessment.preferredVisitTiming) state.preferredVisitTiming = assessment.preferredVisitTiming;

      if ((identityStage || contactCandidateInTurn) && !assessment.canCreateLead) {
        await this.trust.recordAlert({ conversationId, leadId: existingLead?.id, assessment, content });
        if (!existingLead) {
          if (!assessment.normalizedPhone) delete state.contactPhone;
          if (assessment.reasons.some((reason) => ["placeholder_name", "unit_code_as_name", "implausible_name", "repeated_name_token", "missing_name"].includes(reason))) delete state.contactName;
        } else {
          state.contactName = existingLead.name;
          state.contactPhone = existingLead.phone;
        }
        state.presentation = nextPresentation(state.presentation ?? priorPresentation, {
          lastOfferedAction: "CONTACT_REQUEST",
          awaitingConfirmation: true,
          leadHandoffStage: "IDENTITY",
        });
        return {
          lead: existingLead,
          payload: { type: "lead_prompt", uiActions: [{ type: "CONTACT_REQUEST", payload: { stage: "VERIFY_CONTACT", trustLevel: assessment.level, reasons: assessment.reasons, unitLabel: handoffUnitLabel } }] },
          directAnswer: this.trust.customerCorrectionMessage(assessment, ar),
          trustTrace,
        };
      }
    }

    // Prompt for contact if high intent
    if (!existingLead && (state.purchaseIntent ?? 0) >= 80 && (!state.contactPhone || !state.contactName) && Boolean(selectedUnitId || plan.intent === "CONTACT_REQUEST")) {
      state.presentation = nextPresentation(state.presentation ?? priorPresentation, {
        lastOfferedAction: "CONTACT_REQUEST",
        awaitingConfirmation: true,
        leadHandoffStage: "IDENTITY",
      });
      return {
        lead: null,
        payload: { type: "lead_prompt", uiActions: [{ type: "CONTACT_REQUEST", payload: { reason: plan.intent, stage: "IDENTITY", unitLabel: handoffUnitLabel } }] },
        trustTrace,
      };
    }

    // Create/update lead
    if (state.contactPhone && state.contactName) {
      const persistence = leadPersistenceAction(existingLead?.id, state.contactPhone, state.purchaseIntent ?? 0);
      if (persistence !== "none") {
        const selectedNow = state.presentation?.selectedUnitId ? [state.presentation.selectedUnitId] : [];
        const interestedUnits = [...new Set(selectedNow)];
        const unitProjects = interestedUnits.length
          ? (await this.prisma.unit.findMany({ where: { id: { in: interestedUnits } }, select: { projectId: true } })).map((item) => item.projectId)
          : [];
        const interestedProjects = [...new Set([
          ...unitProjects,
          ...(state.presentation?.selectedProjectId ? [state.presentation.selectedProjectId] : []),
        ])];

        const conversationSummary = {
          customerGoal: state.purpose,
          budget: { min: state.budgetMin, max: state.budgetMax, currency: state.currency },
          preferredLocations: state.locations ?? [],
          propertyTypes: state.propertyTypes ?? [],
          bedrooms: state.bedrooms,
          bathrooms: state.bathrooms,
          preferredPhase: state.preferredPhase,
          preferredBuilding: state.preferredBuilding,
          preferredPaymentMode: state.preferredPaymentMode ?? null,
          preferredPaymentDurationMonths: state.preferredPaymentDurationMonths,
          maxDownPayment: state.maxDownPayment,
          hardRequirements: state.hardRequirements ?? [],
          softPreferences: state.softPreferences ?? [],
          intentScore: state.purchaseIntent ?? 80,
          selectedUnitCode: state.externalUnitId ?? null,
          selectedUnitLabel: handoffUnitLabel,
          preferredConfirmationChannel: state.preferredConfirmationChannel ?? null,
          preferredVisitDayPart: state.preferredVisitDayPart ?? null,
          preferredVisitTiming: state.preferredVisitTiming ?? null,
        };

        const existingPayload = existingLead?.payload && typeof existingLead.payload === "object" && !Array.isArray(existingLead.payload)
          ? existingLead.payload as Record<string, any>
          : {};
        const leadPayload = JSON.parse(JSON.stringify({
          ...existingPayload,
          requirements: state,
          explicitInterestedUnits: interestedUnits,
          interestedUnits,
          interestedProjects,
          conversationSummary,
          trust: existingLead?.trustStatus === "ADMIN_CONFIRMED_REAL" || existingLead?.trustStatus === "ADMIN_CONFIRMED_FAKE"
            ? { status: existingLead.trustStatus, score: existingLead.trustScore, reasons: existingLead.trustReasons }
            : { status: "CONTACT_VALID", score: 100, reasons: [] },
        }));

        const adminLockedTrust = existingLead?.trustStatus === "ADMIN_CONFIRMED_REAL" || existingLead?.trustStatus === "ADMIN_CONFIRMED_FAKE";
        const commonLeadData = {
          name: state.contactName,
          phone: state.contactPhone,
          intentScore: state.purchaseIntent ?? 80,
          payload: leadPayload,
          trustStatus: adminLockedTrust ? existingLead!.trustStatus : "CONTACT_VALID",
          trustScore: adminLockedTrust ? existingLead!.trustScore : 100,
          trustReasons: adminLockedTrust ? existingLead!.trustReasons : [] as string[],
          preferredContactChannel: state.preferredConfirmationChannel ?? state.preferredContactChannel ?? null,
          preferredConfirmationChannel: state.preferredConfirmationChannel ?? null,
          preferredVisitDayPart: state.preferredVisitDayPart ?? null,
          preferredVisitTiming: state.preferredVisitTiming ?? null,
          contactValidatedAt: new Date(),
        };

        const lead = persistence === "update" && existingLead
          ? await this.prisma.lead.update({
              where: { id: existingLead.id },
              data: { ...commonLeadData, events: { create: { type: "LEAD_UPDATED", payload: { channel: "WEB", handoff: true } } } },
            })
          : await this.prisma.lead.create({
              data: { conversationId, ...commonLeadData, intent: "PURCHASE", source: "WEB_AI", events: { create: { type: "LEAD_CREATED", payload: { channel: "WEB", handoff: true } } } },
            });

        await this.trust.resolveOpenAlerts(conversationId, lead.id);

        const needsConfirmation = !state.preferredConfirmationChannel;
        const nextHandoffStage = needsConfirmation ? "CONFIRMATION" : "COMPLETE";
        if (!needsConfirmation) state.preferredContactChannel = state.preferredConfirmationChannel;
        state.presentation = nextPresentation(state.presentation ?? priorPresentation, {
          lastOfferedAction: nextHandoffStage === "COMPLETE" ? undefined : "CONTACT_REQUEST",
          awaitingConfirmation: nextHandoffStage !== "COMPLETE",
          leadHandoffStage: nextHandoffStage,
        });

        await this.prisma.conversationState.upsert({
          where: { conversationId },
          create: {
            conversationId,
            searchContext: JSON.parse(JSON.stringify(state)),
            suggestedUnitIds: interestedUnits.length ? interestedUnits : priorUnitIds,
            rejectedUnitIds: [],
            likedUnitIds: [],
            intentScore: state.purchaseIntent ?? 80,
            summary: JSON.parse(JSON.stringify(conversationSummary)),
          },
          update: { searchContext: JSON.parse(JSON.stringify(state)), summary: JSON.parse(JSON.stringify(conversationSummary)) },
        });

        return {
          lead,
          payload: {
            type: "lead_created",
            leadId: lead.id,
            uiActions: nextHandoffStage === "CONFIRMATION"
              ? [{ type: "CONTACT_REQUEST", payload: { stage: "CONFIRMATION", needsConfirmationChannel: true, unitLabel: handoffUnitLabel } }]
              : [{ type: "CONTACT_REQUEST", payload: { stage: "COMPLETE", unitLabel: handoffUnitLabel } }],
          },
          trustTrace,
        };
      }
    }

    return { lead: existingLead, trustTrace };
  }

  directLeadAnswer(state: StructuredIntent, uiActions: UIAction[], leadId?: string): string | undefined {
    const ar = state.language?.startsWith("ar");
    const contactAction = uiActions.find((item) => item.type === "CONTACT_REQUEST");
    if (!contactAction) return undefined;

    const stage = String(contactAction.payload?.stage ?? "COMPLETE");
    const unitLabel = String(contactAction.payload?.unitLabel ?? (ar ? "الوحدة المختارة" : "the selected unit"));
    const firstName = state.contactName?.trim().split(/\s+/)[0];
    const name = firstName ? ` يا ${firstName}` : "";
    const confirmLabel = state.preferredConfirmationChannel === "WHATSAPP" ? (ar ? "واتساب" : "WhatsApp") : state.preferredConfirmationChannel === "CALL" ? (ar ? "مكالمة" : "a call") : null;
    const timing = [state.preferredVisitDayPart === "AFTERNOON" ? (ar ? "العصر" : "afternoon") : state.preferredVisitDayPart === "MORNING" ? (ar ? "الصبح" : "morning") : state.preferredVisitDayPart === "EVENING" ? (ar ? "المساء" : "evening") : null, state.preferredVisitTiming === "MIDWEEK" ? (ar ? "في نص الأسبوع" : "midweek") : state.preferredVisitTiming === "WEEKEND" ? (ar ? "في نهاية الأسبوع" : "on the weekend") : state.preferredVisitTiming === "WEEKDAY" ? (ar ? "في يوم عمل" : "on a weekday") : null].filter(Boolean).join(ar ? " و" : " ");

    if (stage === "IDENTITY" || stage === "VERIFY_CONTACT") {
      return ar
        ? `تمام، نقدر نكمل المعاينة على ${unitLabel}.\n\n**البيانات الأساسية**\nابعتلي اسمك ورقم موبايل صحيح للتواصل، وبعدها هخليك تختار التأكيد **مكالمة أو واتساب**.`
        : `We can continue the viewing for ${unitLabel}.\n\n**Basic details**\nSend your name and a valid mobile number. After that, you can choose confirmation by **call or WhatsApp**.`;
    }

    if (stage === "CONFIRMATION") {
      return ar
        ? `تمام${name}، بياناتك وصلت صح للطلب على ${unitLabel}.${timing ? ` وسجلت إنك تفضل ${timing}.` : ""}\n\n**التأكيد**\nتحب فريق المبيعات يأكد معاك الموعد عن طريق **مكالمة** ولا **واتساب**؟`
        : `Thanks${firstName ? `, ${firstName}` : ""}. Your details are attached to ${unitLabel}.${timing ? ` I also saved your preference for ${timing}.` : ""}\n\n**Confirmation**\nWould you like the sales team to confirm the appointment by **call** or **WhatsApp**?`;
    }

    if (leadId) {
      return ar
        ? `تمام${name}، كده سجلتلك طلب المعاينة على ${unitLabel}${state.preferredPaymentMode ? ` بنظام ${state.preferredPaymentMode === "CASH" ? "كاش" : "تقسيط"}` : ""}. حد من قسم المبيعات هيكلمك وينسق معاك${confirmLabel ? ` والتأكيد هيكون عن طريق ${confirmLabel}` : ""}.`
        : `All set${firstName ? `, ${firstName}` : ""}. I saved the viewing request for ${unitLabel}${state.preferredPaymentMode ? ` using ${state.preferredPaymentMode === "CASH" ? "cash" : "installments"}` : ""}. A sales advisor will contact you to coordinate it${confirmLabel ? `, with confirmation by ${confirmLabel}` : ""}.`;
    }

    return undefined;
  }
}
