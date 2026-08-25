import { Injectable } from "@nestjs/common";
import { ExecutedAction, ProposedAction } from "../domain/nadim-action";
import { StateOperation } from "../domain/nadim-intent";
import { NadimState } from "../domain/nadim-state";
import { NadimLanguageStyle } from "./language-style.types";

type Copy = Record<Exclude<NadimLanguageStyle, "UNKNOWN">, string> & { UNKNOWN?: string };

@Injectable()
export class ResponseStyleService {
  style(state: NadimState): NadimLanguageStyle {
    const preferred = state.languageStyle?.preferredResponseStyle;
    return preferred && preferred !== "UNKNOWN" ? preferred : state.locale.toLowerCase().startsWith("en") ? "EN_US" : "AR_FORMAL";
  }

  greeting(style: NadimLanguageStyle, firstTurn: boolean, userMessage: string) {
    const salam = /السلام\s+عليكم/iu.test(userMessage);
    if (!firstTurn) return this.pick(style, {
      AR_EGYPTIAN: salam ? "وعليكم السلام، اتفضل." : "أهلًا، اتفضل.",
      AR_GULF: salam ? "وعليكم السلام، تفضل." : "هلا، تفضل.",
      AR_FORMAL: salam ? "وعليكم السلام، تفضل." : "مرحبًا، تفضل.",
      EN_US: "Hey — how can I help?",
      FRANCO_ARABIC: "ahlan, etfaddal.",
      MIXED_AR_EN: "أهلًا، اتفضل.",
    });
    return this.pick(style, {
      AR_EGYPTIAN: salam ? "وعليكم السلام، أنا نديم. قولّي بتدور على إيه وأنا أساعدك." : "أهلًا، أنا نديم. قولّي بتدور على إيه.",
      AR_GULF: salam ? "وعليكم السلام، أنا نديم. وش تدور عليه؟" : "هلا والله، أنا نديم. وش تدور عليه؟",
      AR_FORMAL: salam ? "وعليكم السلام، أنا نديم. أخبرني عمّا تبحث وسأساعدك." : "مرحبًا، أنا نديم. ما الذي تبحث عنه؟",
      EN_US: "Hey, I’m Nadim. What are you looking for?",
      FRANCO_ARABIC: "ahlan, ana Nadim. 2olly btedor 3ala eh.",
      MIXED_AR_EN: "أهلًا، أنا نديم. قولّي بتدور على إيه.",
    });
  }

  languageChanged(style: NadimLanguageStyle) {
    return this.pick(style, {
      AR_EGYPTIAN: "تمام، هكمل معاك بالمصري.",
      AR_GULF: "تمام، بكمل معك بالخليجي.",
      AR_FORMAL: "بالتأكيد، سأتابع معك بالعربية.",
      EN_US: "Sure — I’ll continue in English.",
      FRANCO_ARABIC: "tamam, hankamel Franco.",
      MIXED_AR_EN: "تمام، هنكمل بنفس الـstyle ده.",
    });
  }

  clarification(style: NadimLanguageStyle, reason: string) {
    if (reason === "RESULT_REFERENCE_NOT_FOUND") return this.pick(style, {
      AR_EGYPTIAN: "مش قادر أحدد أنهي اختيار تقصد. قولّي الرقم اللي ظاهر عندك.",
      AR_GULF: "ما قدرت أحدد أي خيار تقصد. قل لي الرقم الظاهر عندك.",
      AR_FORMAL: "لم أتمكن من تحديد الخيار المقصود. اذكر رقمه الظاهر لديك.",
      EN_US: "I couldn’t resolve that option. Tell me the number you see.",
      FRANCO_ARABIC: "mesh 2ader a7aded anhy option. 2olly el rakam el zaher 3andak.",
      MIXED_AR_EN: "مش قادر أحدد أنهي option. قولّي الرقم اللي ظاهر عندك.",
    });
    if (reason === "COMPARISON_SELECTION_REQUIRED") return this.pick(style, {
      AR_EGYPTIAN: "اختار وحدتين من اللي ظهروا عشان أقارنهم بسرعة.",
      AR_GULF: "اختر وحدتين من الخيارات عشان أقارن لك بينهم.",
      AR_FORMAL: "اختر وحدتين على الأقل لأقارن بينهما.",
      EN_US: "Pick at least two units and I’ll compare them side by side.",
      FRANCO_ARABIC: "e5tar wa7deten 3ashan a2arenhomlak.",
      MIXED_AR_EN: "اختار اتنين options وأنا أقارنهم بسرعة.",
    });
    return this.pick(style, {
      AR_EGYPTIAN: "حدد الوحدة اللي تقصدها، زي مثلًا: التانية.",
      AR_GULF: "حدد الوحدة اللي تقصدها، مثل: الخيار الثاني.",
      AR_FORMAL: "حدد الوحدة المقصودة، مثلًا: الخيار الثاني.",
      EN_US: "Tell me which unit you mean, for example, the second one.",
      FRANCO_ARABIC: "2olly anhy wa7da, masalan el tanya.",
      MIXED_AR_EN: "حدد أنهي unit تقصد، مثلًا التانية.",
    });
  }

  reset(style: NadimLanguageStyle) {
    return this.pick(style, {
      AR_EGYPTIAN: "تمام، بدأنا بحث جديد وسيبت الطلب القديم ورا.",
      AR_GULF: "تمام، بدأنا بحث جديد وتركنا الطلب السابق.",
      AR_FORMAL: "حسنًا، بدأنا بحثًا جديدًا وأزلنا شروط البحث السابقة.",
      EN_US: "Got it — we’re starting a fresh search and leaving the old filters behind.",
      FRANCO_ARABIC: "tamam, bada2na search gedid w sebna el filters el adeema.",
      MIXED_AR_EN: "تمام، بدأنا search جديد وشلنا الـfilters القديمة.",
    });
  }

  searchNotRun(style: NadimLanguageStyle) {
    return this.pick(style, {
      AR_EGYPTIAN: "لسه مدورتش في المخزون، فمقدرش أحكم على الاختيارات.",
      AR_GULF: "ما بحثت في المخزون إلى الآن، فما أقدر أحكم على الخيارات.",
      AR_FORMAL: "لم يُنفذ البحث بعد، لذلك لا يمكنني الحكم على الخيارات.",
      EN_US: "I haven’t run the inventory search yet, so I can’t judge the options.",
      FRANCO_ARABIC: "lessa ma 3amaltsh search fel inventory, fa mesh ha7kom 3al options.",
      MIXED_AR_EN: "لسه ما عملتش search في الـinventory، فمقدرش أحكم على الـoptions.",
    });
  }

  searchFailed(style: NadimLanguageStyle) {
    return this.pick(style, {
      AR_EGYPTIAN: "البحث في البيانات الموثقة متعطل دلوقتي، فمش هفترض حالة المخزون.",
      AR_GULF: "البحث في البيانات الموثقة متعطل حاليًا، فما راح أفترض حالة المخزون.",
      AR_FORMAL: "تعذر البحث في البيانات الموثقة حاليًا، لذلك لن أفترض حالة المخزون.",
      EN_US: "The verified inventory search is unavailable right now, so I won’t infer inventory status.",
      FRANCO_ARABIC: "el verified search mesh shaghala delwa2ti, fa mesh haftared 7alet el inventory.",
      MIXED_AR_EN: "الـverified search متعطل دلوقتي، فمش هفترض حالة الـinventory.",
    });
  }

  noMatch(style: NadimLanguageStyle, blocker?: string, change?: string) {
    const prefix = change ? `${change} ` : "";
    const blockerText = blocker ? this.pick(style, {
      AR_EGYPTIAN: `الظاهر إن ${blocker} مقلل الاختيارات.`,
      AR_GULF: `يبدو إن ${blocker} مقلل الخيارات.`,
      AR_FORMAL: `يبدو أن ${blocker} هو القيد الأبرز.`,
      EN_US: `${blocker} looks like the main blocker.`,
      FRANCO_ARABIC: `bayen en ${blocker} howa akbar constraint.`,
      MIXED_AR_EN: `واضح إن ${blocker} هو الـmain blocker.`,
    }) : "";
    return prefix + this.pick(style, {
      AR_EGYPTIAN: `ملقتش حاجة مطابقة 100% للشروط دي دلوقتي. ${blockerText} تحب نغيّر قيد واحد؟`,
      AR_GULF: `ما لقيت خيار مطابق 100% للشروط حاليًا. ${blockerText} تبيني نغيّر شرط واحد؟`,
      AR_FORMAL: `لم أجد خيارًا مطابقًا تمامًا لهذه الشروط حاليًا. ${blockerText} هل نعدّل شرطًا واحدًا؟`,
      EN_US: `I didn’t find an exact match with those filters. ${blockerText} Want to loosen one filter?`,
      FRANCO_ARABIC: `mala2etsh match 100% bel shoroot di. ${blockerText}`,
      MIXED_AR_EN: `ملقتش match 100% بالـfilters دي. ${blockerText} نغيّر filter واحد؟`,
    }).replace(/\s+/gu, " ").trim();
  }

  searchBlocker(style: NadimLanguageStyle, state: NadimState) {
    if (state.search.budgetMax != null) {
      const value = this.money(state.search.budgetMax, state.search.currency);
      return this.pick(style, {
        AR_EGYPTIAN: `سقف الميزانية ${value}`,
        AR_GULF: `حد الميزانية ${value}`,
        AR_FORMAL: `الميزانية القصوى ${value}`,
        EN_US: `the ${value} budget cap`,
        FRANCO_ARABIC: `budget cap ${value}`,
        MIXED_AR_EN: `الـbudget cap ${value}`,
      });
    }
    if (state.search.locations.length) {
      const locations = state.search.locations.join(style === "EN_US" || style === "FRANCO_ARABIC" ? ", " : "، ");
      return this.pick(style, {
        AR_EGYPTIAN: `المكان (${locations})`,
        AR_GULF: `الموقع (${locations})`,
        AR_FORMAL: `الموقع (${locations})`,
        EN_US: `the location (${locations})`,
        FRANCO_ARABIC: `location (${locations})`,
        MIXED_AR_EN: `الـlocation (${locations})`,
      });
    }
    return undefined;
  }

  searchResults(style: NadimLanguageStyle, units: any[], change?: string) {
    const intro = this.pick(style, {
      AR_EGYPTIAN: `لقيتلك ${units.length} ${units.length === 1 ? "اختيار مناسب" : "اختيارات مناسبين"}.`,
      AR_GULF: `لقيت لك ${units.length} ${units.length === 1 ? "خيار مناسب" : "خيارات مناسبة"}.`,
      AR_FORMAL: `وجدت ${units.length} ${units.length === 1 ? "خيار مناسب" : "خيارات مناسبة"}.`,
      EN_US: `I found ${units.length} ${units.length === 1 ? "solid match" : "solid matches"}.`,
      FRANCO_ARABIC: `la2etlak ${units.length} ${units.length === 1 ? "option monaseb" : "options monasbeen"}.`,
      MIXED_AR_EN: `لقيتلك ${units.length} ${units.length === 1 ? "option مناسب" : "options مناسبين"}.`,
    });
    const lines = units.slice(0, 5).map((unit, index) => this.unitLine(style, unit, index));
    const insight = this.resultInsight(style, units);
    const next = units.length === 2 ? this.pick(style, {
      AR_EGYPTIAN: "لو حابب، أقارنلك الاتنين بسرعة.",
      AR_GULF: "إذا ودك، أقارن لك بينهم بسرعة.",
      AR_FORMAL: "يمكنني مقارنة الخيارين باختصار.",
      EN_US: "I can compare the two side by side if useful.",
      FRANCO_ARABIC: "momken a2arenhomlak besor3a law 7abeb.",
      MIXED_AR_EN: "لو حابب، أعملك quick comparison بينهم.",
    }) : "";
    return [change, intro, insight, ...lines, next].filter(Boolean).join("\n");
  }

  comparison(style: NadimLanguageStyle, units: any[]) {
    if (!units.length) return this.unknown(style);
    const intro = this.pick(style, {
      AR_EGYPTIAN: "دي أهم الفروق بين الاختيارات:",
      AR_GULF: "هذه أهم الفروقات بين الخيارات:",
      AR_FORMAL: "هذه أبرز الفروق بين الخيارات:",
      EN_US: "Here are the key differences:",
      FRANCO_ARABIC: "di aham el foro2 ben el options:",
      MIXED_AR_EN: "دي أهم الـdifferences بين الـoptions:",
    });
    return [intro, ...units.map((unit, index) => this.unitLine(style, unit, index))].join("\n");
  }

  media(style: NadimLanguageStyle, count: number, verified: boolean) {
    if (!verified) return this.unknown(style);
    if (!count) return this.pick(style, {
      AR_EGYPTIAN: "مش ظاهر عندي صور موثقة للوحدة دي دلوقتي.",
      AR_GULF: "ما عندي صور موثقة للوحدة هذي حاليًا.",
      AR_FORMAL: "لا توجد لدي صور موثقة لهذه الوحدة حاليًا.",
      EN_US: "I don’t have verified media for that unit right now.",
      FRANCO_ARABIC: "mesh zaher 3andy sowar mota2akda lel wa7da di delwa2ti.",
      MIXED_AR_EN: "مش ظاهر عندي verified media للـunit دي دلوقتي.",
    });
    return this.pick(style, {
      AR_EGYPTIAN: `عندي ${count} ملفات صور موثقة للوحدة دي.`,
      AR_GULF: `عندي ${count} ملفات موثقة للوحدة هذي.`,
      AR_FORMAL: `تتوفر ${count} ملفات وسائط موثقة لهذه الوحدة.`,
      EN_US: `I have ${count} verified media items for that unit.`,
      FRANCO_ARABIC: `3andy ${count} verified media lel wa7da di.`,
      MIXED_AR_EN: `عندي ${count} verified media للـunit دي.`,
    });
  }

  paymentPlans(style: NadimLanguageStyle, plans: any[], verified: boolean) {
    if (!verified) return this.unknown(style);
    if (!plans.length) return this.pick(style, {
      AR_EGYPTIAN: "مش ظاهر عندي نظام تقسيط موثّق للوحدة دي، فمش هخمن.",
      AR_GULF: "ما عندي خطة دفع موثقة للوحدة هذي، فما راح أخمن.",
      AR_FORMAL: "لا توجد لدي خطة دفع موثقة لهذه الوحدة، لذلك لن أخمّن.",
      EN_US: "I don’t have a verified payment plan for that unit, so I won’t guess.",
      FRANCO_ARABIC: "mesh zaher 3andy payment plan mota2aked lel wa7da di, fa mesh hakhamen.",
      MIXED_AR_EN: "مش ظاهر عندي verified payment plan للـunit دي، فمش هخمن.",
    });
    const intro = this.pick(style, {
      AR_EGYPTIAN: `عندي ${plans.length} ${plans.length === 1 ? "نظام سداد موثّق" : "أنظمة سداد موثّقة"}:`,
      AR_GULF: `عندي ${plans.length} ${plans.length === 1 ? "خطة دفع موثقة" : "خطط دفع موثقة"}:`,
      AR_FORMAL: `تتوفر ${plans.length} ${plans.length === 1 ? "خطة دفع موثقة" : "خطط دفع موثقة"}:`,
      EN_US: `I found ${plans.length} verified payment ${plans.length === 1 ? "plan" : "plans"}:`,
      FRANCO_ARABIC: `3andy ${plans.length} verified payment ${plans.length === 1 ? "plan" : "plans"}:`,
      MIXED_AR_EN: `عندي ${plans.length} verified payment ${plans.length === 1 ? "plan" : "plans"}:`,
    });
    const lines = plans.slice(0, 3).map((plan, index) => {
      const duration = plan.durationMonths == null ? undefined : this.pick(style, {
        AR_EGYPTIAN: `${plan.durationMonths} شهر`,
        AR_GULF: `${plan.durationMonths} شهر`,
        AR_FORMAL: `${plan.durationMonths} شهرًا`,
        EN_US: `${plan.durationMonths} months`,
        FRANCO_ARABIC: `${plan.durationMonths} months`,
        MIXED_AR_EN: `${plan.durationMonths} months`,
      });
      const facts = [plan.name, plan.downPaymentPercent != null ? `${plan.downPaymentPercent}%` : this.money(plan.downPaymentAmount, plan.currency), duration, this.money(plan.installmentAmount, plan.currency)].filter(Boolean);
      return `${index + 1}. ${facts.join(" · ")}`;
    });
    return [intro, ...lines].join("\n");
  }

  price(style: NadimLanguageStyle, unit?: any) {
    if (unit?.price == null) return this.unknown(style);
    const id = unit.externalUnitId ?? unit.id ?? "";
    const price = this.money(unit.price, unit.currency);
    return this.pick(style, {
      AR_EGYPTIAN: `سعر الوحدة ${id} هو ${price}.`,
      AR_GULF: `سعر الوحدة ${id} هو ${price}.`,
      AR_FORMAL: `سعر الوحدة ${id} هو ${price}.`,
      EN_US: `Unit ${id} is priced at ${price}.`,
      FRANCO_ARABIC: `se3r el wa7da ${id} howa ${price}.`,
      MIXED_AR_EN: `سعر الـunit ${id} هو ${price}.`,
    });
  }

  availability(style: NadimLanguageStyle, value?: any) {
    if (!value?.status) return this.unknown(style);
    const id = value.externalUnitId ?? value.unitId ?? "";
    return this.pick(style, {
      AR_EGYPTIAN: `حالة الوحدة ${id}: ${value.status}.`,
      AR_GULF: `حالة الوحدة ${id}: ${value.status}.`,
      AR_FORMAL: `حالة الوحدة ${id}: ${value.status}.`,
      EN_US: `Unit ${id} is currently ${value.status}.`,
      FRANCO_ARABIC: `7alet el wa7da ${id}: ${value.status}.`,
      MIXED_AR_EN: `حالة الـunit ${id}: ${value.status}.`,
    });
  }

  unknown(style: NadimLanguageStyle) {
    return this.pick(style, {
      AR_EGYPTIAN: "المعلومة دي مش موثقة عندي دلوقتي، فمش هخمن.",
      AR_GULF: "المعلومة هذي مو موثقة عندي حاليًا، فما راح أخمن.",
      AR_FORMAL: "هذه المعلومة غير موثقة لدي حاليًا، لذلك لن أخمّن.",
      EN_US: "I don’t have a verified value for that, so I won’t guess.",
      FRANCO_ARABIC: "el ma3looma di mesh mota2akda 3andy, fa mesh hakhamen.",
      MIXED_AR_EN: "المعلومة دي مش verified عندي، فمش هخمن.",
    });
  }

  safeFallback(style: NadimLanguageStyle) {
    return this.pick(style, {
      AR_EGYPTIAN: "قولّي تفصيلة واحدة زيادة وأنا أمشي معاك في أنسب اتجاه.",
      AR_GULF: "قل لي تفصيلة واحدة زيادة وبمشي معك في أنسب اتجاه.",
      AR_FORMAL: "أخبرني بتفصيل إضافي واحد لأساعدك بدقة.",
      EN_US: "Give me one more detail and I’ll point you in the right direction.",
      FRANCO_ARABIC: "2olly tafseela wa7da zeyada w hasa3dak beda2a.",
      MIXED_AR_EN: "قولّي detail واحدة زيادة وأنا أساعدك بدقة.",
    });
  }

  proposedAction(style: NadimLanguageStyle, action: ProposedAction) {
    const viewing = action.type === "CREATE_VIEWING_REQUEST";
    const reservation = action.type === "CREATE_RESERVATION_REQUEST";
    return this.pick(style, {
      AR_EGYPTIAN: viewing ? "أقدر أجهزلك طلب معاينة، بس لسه ما اتأكدش." : reservation ? "أقدر أجهز طلب الحجز، بس ده لسه مش تأكيد حجز." : "أقدر أجهزلك طلب تواصل، بس لسه ما اتسجلش.",
      AR_GULF: viewing ? "أقدر أجهز لك طلب معاينة، لكنه غير مؤكد إلى الآن." : reservation ? "أقدر أجهز طلب الحجز، لكنه مو تأكيد حجز." : "أقدر أجهز لك طلب تواصل، لكنه ما تسجل إلى الآن.",
      AR_FORMAL: viewing ? "يمكنني تجهيز طلب معاينة، لكنه لم يُؤكد بعد." : reservation ? "يمكنني تجهيز طلب الحجز، لكنه ليس تأكيدًا للحجز." : "يمكنني تجهيز طلب تواصل، لكنه لم يُسجل بعد.",
      EN_US: viewing ? "I can prepare a viewing request, but it hasn’t been confirmed yet." : reservation ? "I can prepare a reservation request, but that is not a confirmed reservation." : "I can prepare a contact request, but it hasn’t been recorded yet.",
      FRANCO_ARABIC: viewing ? "a2dar agahez viewing request, bas lessa ma et2akadsh." : reservation ? "a2dar agahez reservation request, bas da mesh confirmed booking." : "a2dar agahez contact request, bas lessa ma etsegelsh.",
      MIXED_AR_EN: viewing ? "أقدر أجهزلك viewing request، بس لسه مش confirmed." : reservation ? "أقدر أجهز reservation request، بس ده مش confirmed booking." : "أقدر أجهز contact request، بس لسه ما اتسجلش.",
    });
  }

  actionResult(style: NadimLanguageStyle, action: ExecutedAction) {
    if (action.status !== "SUCCEEDED") {
      const pending = action.status === "NOT_EXECUTED";
      return this.pick(style, {
        AR_EGYPTIAN: pending ? "الطلب لسه ما اتنفذش، فمش هقولك إنه اتأكد." : "محصلش تأكيد للطلب، فمش هقولك إنه اتسجل.",
        AR_GULF: pending ? "الطلب ما تنفذ إلى الآن، فما راح أقول إنه تأكد." : "ما حصل تأكيد للطلب، فما راح أقول إنه تسجل.",
        AR_FORMAL: pending ? "لم يُنفذ الطلب بعد، لذلك لن أقول إنه تأكد." : "لم يصل تأكيد للطلب، لذلك لن أقول إنه سُجل.",
        EN_US: pending ? "The request hasn’t been executed, so I won’t say it’s confirmed." : "The request wasn’t confirmed, so I won’t say it was recorded.",
        FRANCO_ARABIC: pending ? "el request lessa ma etnafazsh, fa mesh ha2ool enno confirmed." : "ma7asalsh confirmation, fa mesh ha2ool en el request etsegel.",
        MIXED_AR_EN: pending ? "الـrequest لسه ما اتنفذش، فمش هقول إنه confirmed." : "محصلش confirmation، فمش هقول إن الـrequest اتسجل.",
      });
    }
    if (action.type === "CREATE_VIEWING_REQUEST") return this.pick(style, {
      AR_EGYPTIAN: "تمام، طلب المعاينة اتسجل.", AR_GULF: "تمام، تسجل طلب المعاينة.", AR_FORMAL: "تم تسجيل طلب المعاينة.", EN_US: "Your viewing request is recorded.", FRANCO_ARABIC: "tamam, viewing request etsegel.", MIXED_AR_EN: "تمام، الـviewing request اتسجل.",
    });
    if (action.type === "CREATE_RESERVATION_REQUEST") return this.pick(style, {
      AR_EGYPTIAN: "تمام، طلب الحجز اتسجل للمتابعة، بس ده مش تأكيد حجز للوحدة.", AR_GULF: "تمام، تسجل طلب الحجز للمتابعة، لكنه مو تأكيد حجز للوحدة.", AR_FORMAL: "سُجل طلب الحجز للمتابعة، لكنه لا يؤكد حجز الوحدة.", EN_US: "The reservation request is recorded for follow-up, but the unit is not confirmed as reserved.", FRANCO_ARABIC: "tamam, reservation request etsegel lel follow-up, bas da mesh confirmed booking.", MIXED_AR_EN: "تمام، الـreservation request اتسجل للـfollow-up، بس ده مش confirmed booking.",
    });
    return this.pick(style, {
      AR_EGYPTIAN: "تمام، طلب التواصل اتسجل.", AR_GULF: "تمام، تسجل طلب التواصل.", AR_FORMAL: "تم تسجيل طلب التواصل.", EN_US: "Your contact request is recorded.", FRANCO_ARABIC: "tamam, contact request etsegel.", MIXED_AR_EN: "تمام، الـcontact request اتسجل.",
    });
  }

  operationSummary(style: NadimLanguageStyle, operations: StateOperation[], state: NadimState) {
    const budget = operations.find((operation) => operation.operation === "SET" && operation.field === "budgetMax");
    if (budget) return this.pick(style, {
      AR_EGYPTIAN: `خليت الميزانية ${this.money(state.search.budgetMax, state.search.currency)} وسيبت باقي المواصفات زي ما هي.`,
      AR_GULF: `عدلت الميزانية إلى ${this.money(state.search.budgetMax, state.search.currency)} وخليت باقي المواصفات مثل ما هي.`,
      AR_FORMAL: `عدّلت الميزانية إلى ${this.money(state.search.budgetMax, state.search.currency)} وأبقيت بقية المواصفات كما هي.`,
      EN_US: `I updated the budget to ${this.money(state.search.budgetMax, state.search.currency)} and kept the other preferences unchanged.`,
      FRANCO_ARABIC: `5alet el budget ${this.money(state.search.budgetMax, state.search.currency)} w sebt ba2y el preferences zay ma hya.`,
      MIXED_AR_EN: `خليت الـbudget ${this.money(state.search.budgetMax, state.search.currency)} وسيبت باقي الـpreferences زي ما هي.`,
    });
    if (operations.some((operation) => operation.operation === "REMOVE" && operation.field === "locations")) return this.pick(style, {
      AR_EGYPTIAN: "تمام، شلت شرط المكان. باقي طلبك زي ما هو.",
      AR_GULF: "تمام، شلت شرط الموقع وخليت باقي طلبك مثل ما هو.",
      AR_FORMAL: "أزلت شرط الموقع وأبقيت بقية الطلب كما هو.",
      EN_US: "I removed the location filter and kept everything else unchanged.",
      FRANCO_ARABIC: "tamam, shelt location filter w sebt ba2y el request zay ma howa.",
      MIXED_AR_EN: "تمام، شلت الـlocation filter وسيبت باقي الـrequest زي ما هو.",
    });
    return undefined;
  }

  money(value: unknown, currency = "EGP") {
    const number = Number(value);
    return Number.isFinite(number) ? `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(number)} ${currency ?? "EGP"}` : undefined;
  }

  private unitLine(style: NadimLanguageStyle, unit: any, index: number) {
    const id = unit.externalUnitId ?? unit.id;
    const isEnglish = style === "EN_US";
    const isFranco = style === "FRANCO_ARABIC";
    const facts = [
      unit.unitType,
      unit.bedrooms != null ? `${unit.bedrooms} ${isEnglish ? "bedrooms" : isFranco ? "rooms" : "غرف"}` : undefined,
      unit.bathrooms != null ? `${unit.bathrooms} ${isEnglish ? "bathrooms" : isFranco ? "bathrooms" : "حمام"}` : undefined,
      unit.builtUpArea != null ? `${unit.builtUpArea} m²` : undefined,
      this.money(unit.price, unit.currency),
      unit.project?.name,
    ].filter(Boolean);
    const label = style === "EN_US" || style === "FRANCO_ARABIC" ? `Option ${index + 1}` : style === "MIXED_AR_EN" ? `Option ${index + 1}` : `الاختيار ${index + 1}`;
    return `${label} — ${id}: ${facts.join(" · ")}`;
  }

  private resultInsight(style: NadimLanguageStyle, units: any[]) {
    if (units.length < 2) return undefined;
    const firstPrice = Number(units[0]?.price);
    const secondPrice = Number(units[1]?.price);
    const firstArea = Number(units[0]?.builtUpArea);
    const secondArea = Number(units[1]?.builtUpArea);
    const cheaper = Number.isFinite(firstPrice) && Number.isFinite(secondPrice) && firstPrice !== secondPrice
      ? (firstPrice < secondPrice ? 1 : 2)
      : undefined;
    const larger = Number.isFinite(firstArea) && Number.isFinite(secondArea) && firstArea !== secondArea
      ? (firstArea > secondArea ? 1 : 2)
      : undefined;
    if (!cheaper && !larger) return undefined;
    const ordinal = (value: number, first: string, second: string) => value === 1 ? first : second;
    const clauses = {
      AR_EGYPTIAN: [cheaper ? `${ordinal(cheaper, "الأول", "التاني")} سعره أقل` : undefined, larger ? `${ordinal(larger, "الأول", "التاني")} مساحته أكبر` : undefined],
      AR_GULF: [cheaper ? `${ordinal(cheaper, "الأول", "الثاني")} سعره أقل` : undefined, larger ? `${ordinal(larger, "الأول", "الثاني")} مساحته أكبر` : undefined],
      AR_FORMAL: [cheaper ? `${ordinal(cheaper, "الأول", "الثاني")} أقل سعرًا` : undefined, larger ? `${ordinal(larger, "الأول", "الثاني")} أكبر مساحة` : undefined],
      EN_US: [cheaper ? `the ${ordinal(cheaper, "first", "second")} is cheaper` : undefined, larger ? `the ${ordinal(larger, "first", "second")} gives you more space` : undefined],
      FRANCO_ARABIC: [cheaper ? `el ${ordinal(cheaper, "awel", "tany")} ar5as` : undefined, larger ? `el ${ordinal(larger, "awel", "tany")} msa7to akbar` : undefined],
      MIXED_AR_EN: [cheaper ? `${ordinal(cheaper, "الأول", "التاني")} cheaper` : undefined, larger ? `${ordinal(larger, "الأول", "التاني")} مساحته أكبر` : undefined],
      UNKNOWN: [],
    }[style].filter(Boolean);
    if (!clauses.length) return undefined;
    const separator = style === "EN_US" ? ", while " : style === "FRANCO_ARABIC" ? ", bas " : "، و";
    const prefix = style === "EN_US" ? "The main difference: " : style === "FRANCO_ARABIC" ? "aham far2: " : style === "AR_FORMAL" ? "الفرق الأبرز: " : "الفرق الأساسي: ";
    return `${prefix}${clauses.join(separator)}.`;
  }

  private pick(style: NadimLanguageStyle, copy: Copy) {
    return copy[style] ?? copy.AR_FORMAL;
  }
}
