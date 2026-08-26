import { Injectable } from "@nestjs/common";
import { ExecutedAction, ProposedAction } from "../domain/nadim-action";
import { CurrentSearchQueryTarget, StateOperation } from "../domain/nadim-intent";
import { NadimState } from "../domain/nadim-state";
import { GrammaticalAddress, NadimLanguageStyle } from "./language-style.types";

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

  addressChanged(style: NadimLanguageStyle) {
    return this.pick(style, {
      AR_EGYPTIAN: "تمام، هكمل بالطريقة دي.",
      AR_GULF: "أكيد، بكمل بالطريقة هذي.",
      AR_FORMAL: "بالتأكيد، سأتابع بهذه الصيغة.",
      EN_US: "Sure — I’ll use that form of address.",
      FRANCO_ARABIC: "tamam, hankamel bel segha di.",
      MIXED_AR_EN: "تمام، هكمل بنفس الـaddress style.",
    });
  }

  clarification(style: NadimLanguageStyle, reason: string) {
    if (reason === "SEARCH_CHANGE_AMOUNT_REQUIRED") return this.pick(style, {
      AR_EGYPTIAN: "عايز تزودها لكام تحديدًا؟",
      AR_GULF: "تبغى ترفعها إلى كم تحديدًا؟",
      AR_FORMAL: "إلى أي قيمة تريد زيادتها تحديدًا؟",
      EN_US: "What exact value should I raise it to?",
      FRANCO_ARABIC: "3ayez tezawedha le kam belzabt?",
      MIXED_AR_EN: "عايز تزودها لـكام بالضبط؟",
    });
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
      AR_FORMAL: "حسنًا، بدأنا بحثًا جديدًا وتركنا تفاصيل البحث السابق.",
      EN_US: "Got it — we’re starting a fresh search and leaving the old request behind.",
      FRANCO_ARABIC: "tamam, bada2na search gedid w sebna el talab el adeem.",
      MIXED_AR_EN: "تمام، بدأنا search جديد وسيبنا الطلب القديم.",
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

  noMatch(style: NadimLanguageStyle, context: { change?: string; previousAssistantWording?: string } = {}) {
    const primary = this.pick(style, {
      AR_EGYPTIAN: "مش ظاهر معايا حاجة مناسبة بالمواصفات دي دلوقتي. ممكن نجرب نزود الميزانية شوية أو نغيّر حاجة بسيطة في الطلب.",
      AR_GULF: "ما ظهر لي شيء مناسب بالمواصفات هذي حاليًا. نقدر نوسّع أحد الخيارات شوي ونشوف.",
      AR_FORMAL: "لا تظهر لدي حاليًا وحدة مناسبة بهذه المواصفات. يمكننا تعديل الميزانية قليلًا أو تغيير إحدى المواصفات ثم البحث مجددًا.",
      EN_US: "Nothing suitable is showing up with those preferences right now. We could bump the budget a little or adjust one preference.",
      FRANCO_ARABIC: "Msh zaherly 7aga monaseba bel specs di delwa2ty. Momken nwassa3 el budget shwaya aw nghayar tafseela baseeta.",
      MIXED_AR_EN: "مش ظاهر معايا option مناسب بالـpreferences دي دلوقتي. ممكن نوسّع الـbudget شوية أو نعدّل detail بسيطة.",
    });
    const alternate = this.pick(style, {
      AR_EGYPTIAN: "لحد دلوقتي مفيش اختيار مناسب للطلب ده. نقدر نجرب مساحة أوسع شوية في الميزانية أو المواصفات.",
      AR_GULF: "حاليًا ما عندي خيار مناسب للطلب هذا. ممكن نوسّع الميزانية أو نخفف إحدى المواصفات شوي.",
      AR_FORMAL: "لا يوجد حاليًا خيار مناسب للطلب. يمكننا توسيع الميزانية أو تخفيف إحدى المواصفات قليلًا.",
      EN_US: "I’m not seeing a suitable option for that request right now. We can widen the budget or relax one preference a little.",
      FRANCO_ARABIC: "Delwa2ty msh shayef option monaseb lel talab da. Momken nwassa3 el budget aw n5afef tafseela shwaya.",
      MIXED_AR_EN: "حاليًا مش شايف option مناسب للطلب ده. نقدر نوسّع الـbudget أو نخفف preference بسيطة.",
    });
    const response = context.previousAssistantWording?.includes(primary.split(/[.!؟]/u)[0]) ? alternate : primary;
    return [context.change, response].filter(Boolean).join(" ");
  }

  searchResults(style: NadimLanguageStyle, units: any[], change?: string, address: GrammaticalAddress = "NEUTRAL") {
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
      AR_EGYPTIAN: address === "FEMININE" ? "لو حابة، أقارنلك الاتنين بسرعة." : address === "MASCULINE" ? "لو حابب، أقارنلك الاتنين بسرعة." : "ممكن أقارنلك الاتنين بسرعة.",
      AR_GULF: "إذا ودك، أقارن لك بينهم بسرعة.",
      AR_FORMAL: "يمكنني مقارنة الخيارين باختصار.",
      EN_US: "I can compare the two side by side if useful.",
      FRANCO_ARABIC: address === "FEMININE" ? "momken a2arenhomlak besor3a law 7aba." : address === "MASCULINE" ? "momken a2arenhomlak besor3a law 7abeb." : "momken a2arenhomlak besor3a.",
      MIXED_AR_EN: address === "FEMININE" ? "لو حابة، أعملك quick comparison بينهم." : address === "MASCULINE" ? "لو حابب، أعملك quick comparison بينهم." : "ممكن أعملك quick comparison بينهم.",
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

  clarifyUnknown(style: NadimLanguageStyle) {
    return this.pick(style, {
      AR_EGYPTIAN: "مش فاهم قصدك هنا، ممكن توضحهالي؟",
      AR_GULF: "ما فهمت قصدك هنا، ممكن توضح لي؟",
      AR_FORMAL: "لم أفهم المقصود هنا. هل يمكنك توضيحه؟",
      EN_US: "I didn’t catch that. What did you mean?",
      FRANCO_ARABIC: "Msh fahem 2asdak, momken twada7ly?",
      MIXED_AR_EN: "مش فاهم قصدك هنا، ممكن توضح الـmeaning؟",
    });
  }

  safeFallback(style: NadimLanguageStyle) {
    return this.pick(style, {
      AR_EGYPTIAN: "تمام — نكمل منين؟",
      AR_GULF: "تمام — من وين نكمل؟",
      AR_FORMAL: "بالتأكيد. كيف نتابع؟",
      EN_US: "Sure. Where should we pick up?",
      FRANCO_ARABIC: "tamam, nkamel mn fein?",
      MIXED_AR_EN: "تمام — نكمّل منين؟",
    });
  }

  preservedSearch(style: NadimLanguageStyle) {
    return this.pick(style, {
      AR_EGYPTIAN: "تمام، هنفضل على نفس المواصفات من غير ما أغيّر حاجة.",
      AR_GULF: "تمام، نخلي المواصفات مثل ما هي بدون تغيير.",
      AR_FORMAL: "حسنًا، سأُبقي مواصفات البحث كما هي دون تغيير.",
      EN_US: "Got it — I’ll keep the search as it is.",
      FRANCO_ARABIC: "tamam, han5ally el search zay ma howa mn gheir taghyeer.",
      MIXED_AR_EN: "تمام، هنفضل على نفس الـpreferences من غير أي change.",
    });
  }

  currentSearch(style: NadimLanguageStyle, state: NadimState, target: CurrentSearchQueryTarget = "SEARCH") {
    if (target === "budgetMax") {
      const value = this.money(state.search.budgetMax, state.search.currency);
      return value ? this.pick(style, {
        AR_EGYPTIAN: `الميزانية المحددة دلوقتي لحد ${value}.`,
        AR_GULF: `الميزانية المحددة حاليًا إلى ${value}.`,
        AR_FORMAL: `الحد الأقصى للميزانية حاليًا هو ${value}.`,
        EN_US: `The current maximum budget is ${value}.`,
        FRANCO_ARABIC: `el max budget delwa2ty ${value}.`,
        MIXED_AR_EN: `الـmaximum budget دلوقتي ${value}.`,
      }) : this.pick(style, {
        AR_EGYPTIAN: "لسه ما حددناش ميزانية.",
        AR_GULF: "ما حددنا ميزانية إلى الآن.",
        AR_FORMAL: "لم نحدد ميزانية بعد.",
        EN_US: "We haven’t set a budget yet.",
        FRANCO_ARABIC: "lessa ma 7adadnash budget.",
        MIXED_AR_EN: "لسه ما حددناش budget.",
      });
    }
    if (target === "bedrooms") {
      const value = state.search.bedrooms;
      return value !== undefined ? this.pick(style, {
        AR_EGYPTIAN: `إنت طالب ${value} غرف.`,
        AR_GULF: `أنت طالب ${value} غرف.`,
        AR_FORMAL: `طلبك الحالي يتضمن ${value} غرف.`,
        EN_US: `You currently have ${value} bedrooms in the search.`,
        FRANCO_ARABIC: `enta taleb ${value} rooms.`,
        MIXED_AR_EN: `إنت طالب ${value} bedrooms.`,
      }) : this.pick(style, {
        AR_EGYPTIAN: "لسه ما حددناش عدد الغرف.", AR_GULF: "ما حددنا عدد الغرف إلى الآن.", AR_FORMAL: "لم نحدد عدد الغرف بعد.", EN_US: "We haven’t set the bedroom count yet.", FRANCO_ARABIC: "lessa ma 7adadnash 3adad el rooms.", MIXED_AR_EN: "لسه ما حددناش عدد الـbedrooms.",
      });
    }
    if (target === "locations") {
      const value = state.search.locations.join("، ");
      return value ? this.pick(style, {
        AR_EGYPTIAN: `إحنا بندور في ${value}.`, AR_GULF: `ندور حاليًا في ${value}.`, AR_FORMAL: `نبحث حاليًا في ${value}.`, EN_US: `We’re currently looking in ${value}.`, FRANCO_ARABIC: `e7na bnedawar fe ${value}.`, MIXED_AR_EN: `إحنا عاملين search في ${value}.`,
      }) : this.pick(style, {
        AR_EGYPTIAN: "لسه ما حددناش مكان معين.", AR_GULF: "ما حددنا موقع معين إلى الآن.", AR_FORMAL: "لم نحدد موقعًا بعد.", EN_US: "We haven’t set a location yet.", FRANCO_ARABIC: "lessa ma 7adadnash location.", MIXED_AR_EN: "لسه ما حددناش location.",
      });
    }

    const details = [
      state.search.propertyTypes.length ? state.search.propertyTypes.join(", ") : undefined,
      state.search.locations.length ? state.search.locations.join("، ") : undefined,
      state.search.bedrooms !== undefined ? `${state.search.bedrooms} ${style === "EN_US" || style === "FRANCO_ARABIC" ? "bedrooms" : "غرف"}` : undefined,
      this.money(state.search.budgetMax, state.search.currency),
    ].filter(Boolean);
    if (!details.length) return this.pick(style, {
      AR_EGYPTIAN: "لسه ما حددناش مواصفات للبحث.", AR_GULF: "ما حددنا مواصفات للبحث إلى الآن.", AR_FORMAL: "لم نحدد مواصفات للبحث بعد.", EN_US: "We haven’t set any search preferences yet.", FRANCO_ARABIC: "lessa ma 7adadnash search specs.", MIXED_AR_EN: "لسه ما حددناش search preferences.",
    });
    const joined = details.join(" · ");
    return this.pick(style, {
      AR_EGYPTIAN: `إحنا بندور على: ${joined}.`, AR_GULF: `ندور حاليًا على: ${joined}.`, AR_FORMAL: `مواصفات البحث الحالية: ${joined}.`, EN_US: `Your current search is: ${joined}.`, FRANCO_ARABIC: `el search delwa2ty: ${joined}.`, MIXED_AR_EN: `الـcurrent search: ${joined}.`,
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
      AR_EGYPTIAN: `خليت الميزانية لحد ${this.money(state.search.budgetMax, state.search.currency)}.`,
      AR_GULF: `خليت الميزانية إلى ${this.money(state.search.budgetMax, state.search.currency)}.`,
      AR_FORMAL: `أصبحت الميزانية حتى ${this.money(state.search.budgetMax, state.search.currency)}.`,
      EN_US: `The budget is now ${this.money(state.search.budgetMax, state.search.currency)}.`,
      FRANCO_ARABIC: `5alet el budget le7ad ${this.money(state.search.budgetMax, state.search.currency)}.`,
      MIXED_AR_EN: `خليت الـbudget لحد ${this.money(state.search.budgetMax, state.search.currency)}.`,
    });
    if (operations.some((operation) => operation.operation === "REMOVE" && operation.field === "locations")) return this.pick(style, {
      AR_EGYPTIAN: "تمام، شلت المكان من الطلب.",
      AR_GULF: "تمام، شلت الموقع من الطلب.",
      AR_FORMAL: "أزلت الموقع من الطلب.",
      EN_US: "I removed the location from the search.",
      FRANCO_ARABIC: "tamam, shelt el location mn el talab.",
      MIXED_AR_EN: "تمام، شلت الـlocation من الطلب.",
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
