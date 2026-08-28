import { Injectable } from "@nestjs/common";
import { ExecutedAction, ProposedAction } from "../domain/nadim-action";
import { CurrentSearchQueryTarget, StateOperation } from "../domain/nadim-intent";
import { NadimState } from "../domain/nadim-state";
import { GrammaticalAddress, NadimLanguageStyle, NadimRegionalVariant } from "./language-style.types";

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

  languageChanged(style: NadimLanguageStyle, regionalVariant?: NadimRegionalVariant) {
    if (style === "AR_GULF" && regionalVariant === "SAUDI") return "تمام، بكمل معك بالسعودي.";
    return this.pick(style, {
      AR_EGYPTIAN: "تمام، هكمل معاك بالمصري.",
      AR_GULF: "تمام، بكمل معك بالخليجي.",
      AR_FORMAL: "بالتأكيد، سأتابع معك بالعربية.",
      EN_US: "Sure — I’ll continue in English.",
      FRANCO_ARABIC: "tamam, hankamel Franco.",
      MIXED_AR_EN: "تمام، هنكمل بنفس الـstyle ده.",
    });
  }

  assistantIdentity(style: NadimLanguageStyle) {
    return this.pick(style, {
      AR_EGYPTIAN: "أنا نديم.",
      AR_GULF: "أنا نديم.",
      AR_FORMAL: "أنا نديم.",
      EN_US: "I’m Nadim.",
      FRANCO_ARABIC: "ana Nadim.",
      MIXED_AR_EN: "أنا نديم.",
    });
  }

  assistantNature(style: NadimLanguageStyle, regionalVariant?: NadimRegionalVariant) {
    if (style === "AR_GULF" && regionalVariant === "SAUDI") {
      return "صحيح، أنا مساعد ذكاء اصطناعي اسمي نديم، ودوري أساعدك في بحثك العقاري مثل خدمة العملاء.";
    }
    return this.pick(style, {
      AR_EGYPTIAN: "أيوه، أنا مساعد ذكاء اصطناعي اسمي نديم، ودوري أتابع معاك في بحثك العقاري زي خدمة العملاء.",
      AR_GULF: "صحيح، أنا مساعد ذكاء اصطناعي اسمي نديم، ودوري أساعدك في بحثك العقاري مثل خدمة العملاء.",
      AR_FORMAL: "نعم، أنا مساعد ذكاء اصطناعي اسمي نديم، ودوري مساعدتك في بحثك العقاري بصفتي مساعد خدمة عملاء.",
      EN_US: "That’s right — I’m Nadim, an AI customer-service assistant for your property search.",
      FRANCO_ARABIC: "aywa, ana Nadim, AI customer-service assistant w dorri asa3dak fe property search beta3ak.",
      MIXED_AR_EN: "أيوه، أنا نديم، AI customer-service assistant، ودوري أساعدك في الـproperty search.",
    });
  }

  languageCapability(style: NadimLanguageStyle, userMessage: string, regionalVariant?: NadimRegionalVariant) {
    const asksEnglish = /(?:إنجليزي|انجليزي|english)/iu.test(userMessage);
    const asksSaudi = /(?:سعودي|السعودية|saudi)/iu.test(userMessage);
    const asksGulf = /(?:خليجي|gulf)/iu.test(userMessage);
    const subject = asksEnglish ? "ENGLISH" : asksSaudi ? "SAUDI" : asksGulf ? "GULF" : "ARABIC";
    if (style === "AR_GULF" && regionalVariant === "SAUDI") {
      if (subject === "ENGLISH") return "إيه، أقدر أتكلم إنجليزي. وإذا ودك أكمل فيه قل لي.";
      if (subject === "SAUDI") return "إيه، أقدر أكلمك بأسلوب سعودي طبيعي.";
      if (subject === "GULF") return "إيه، أقدر أكلمك خليجي.";
      return "إيه، أقدر أتكلم عربي.";
    }
    return this.pick(style, {
      AR_EGYPTIAN: subject === "ENGLISH" ? "أيوه، أقدر أتكلم إنجليزي. لو حابب أكمل بيه قولّي." : subject === "SAUDI" ? "أيوه، أقدر أكلمك بأسلوب سعودي طبيعي." : subject === "GULF" ? "أيوه، أقدر أكلمك خليجي." : "أيوه، أقدر أتكلم عربي.",
      AR_GULF: subject === "ENGLISH" ? "إيه، أقدر أتكلم إنجليزي. وإذا ودك أكمل فيه قل لي." : subject === "SAUDI" ? "إيه، أقدر أكلمك بأسلوب سعودي طبيعي." : subject === "GULF" ? "إيه، أقدر أكلمك خليجي." : "إيه، أقدر أتكلم عربي.",
      AR_FORMAL: subject === "ENGLISH" ? "نعم، يمكنني التحدث بالإنجليزية، وسأنتقل إليها إذا طلبت ذلك." : subject === "SAUDI" ? "نعم، يمكنني التحدث بأسلوب سعودي طبيعي." : subject === "GULF" ? "نعم، يمكنني التحدث بأسلوب خليجي." : "نعم، يمكنني التحدث بالعربية.",
      EN_US: subject === "ENGLISH" ? "Yes, I can speak English." : subject === "SAUDI" ? "Yes, I can use a natural Saudi Arabic style." : subject === "GULF" ? "Yes, I can use a Gulf Arabic style." : "Yes, I can speak Arabic. I’ll switch if you ask me to.",
      FRANCO_ARABIC: subject === "ENGLISH" ? "aywa, a2dar atkallem English. law 3ayez akammel beha 2olly." : subject === "SAUDI" ? "aywa, a2dar akallemak Saudi style tabi3y." : subject === "GULF" ? "aywa, a2dar akallemak Khaliji." : "aywa, a2dar atkallem 3arabi.",
      MIXED_AR_EN: subject === "ENGLISH" ? "أيوه، أقدر أتكلم English. لو عايزني أكمل بيه قولّي." : subject === "SAUDI" ? "أيوه، أقدر أكلمك بـSaudi style طبيعي." : subject === "GULF" ? "أيوه، أقدر أكلمك Gulf style." : "أيوه، أقدر أتكلم عربي.",
    });
  }

  assistantCapabilities(style: NadimLanguageStyle, regionalVariant?: NadimRegionalVariant) {
    if (style === "AR_GULF" && regionalVariant === "SAUDI") {
      return "أقدر أفهم احتياجك العقاري، أبحث في المتاح، أقارن الخيارات، وأوضح لك المعلومات الموثقة. وأقدر أطلب لك متابعة أو تواصل بشري إذا احتجت.";
    }
    return this.pick(style, {
      AR_EGYPTIAN: "أقدر أفهم إنت بتدور على إيه، أدور في المتاح، أقارنلك الاختيارات، وأوضحلك الأسعار والتقسيط والمعلومات الموثقة. وأقدر أطلبلك متابعة أو تواصل مع حد لو احتجت.",
      AR_GULF: "أقدر أفهم احتياجك العقاري، أبحث في المتاح، أقارن الخيارات، وأوضح لك المعلومات الموثقة. وأقدر أطلب لك متابعة أو تواصل بشري إذا احتجت.",
      AR_FORMAL: "يمكنني فهم احتياجك العقاري، والبحث في المتاح، ومقارنة الخيارات، وشرح المعلومات الموثقة. ويمكنني طلب متابعة أو تواصل بشري عند الحاجة.",
      EN_US: "I can understand what you need, search verified availability, compare options, and explain verified prices, payment plans, and availability. I can also request follow-up or a human handoff when needed.",
      FRANCO_ARABIC: "a2dar afham enta btedor 3ala eh, adawar fel available, a2aren el options, w awada7 el verified details. w a2dar atlbolak follow-up aw human handoff law e7tagt.",
      MIXED_AR_EN: "أقدر أفهم احتياجك، أعمل search في المتاح، أقارن الـoptions، وأوضحلك الـverified details. وأقدر أطلب follow-up أو human handoff لو احتجت.",
    });
  }

  smallTalk(style: NadimLanguageStyle, userMessage: string, regionalVariant?: NadimRegionalVariant) {
    const thanks = /(?:شكر[ًاا]?|متشكر|thank\s*you|thanks)/iu.test(userMessage);
    const unsure = /(?:محتار|مش\s+عارف\s+أبدأ|مش\s+عارف\s+ابدأ|don['’]?t know where to start)/iu.test(userMessage);
    const wellbeing = /(?:كيفك|عامل\s+(?:إيه|ايه|اي)|أخبارك|اخبارك|شلونك|كيف\s+الحال|how\s+are\s+you|how['’]?s\s+it\s+going)/iu.test(userMessage);
    if (wellbeing) {
      if (style === "AR_GULF" && regionalVariant === "SAUDI") return "بخير الحمد لله، كيف حالك؟";
      return this.pick(style, {
        AR_EGYPTIAN: "تمام الحمد لله، إنت أخبارك إيه؟",
        AR_GULF: "بخير الحمد لله، كيف حالك؟",
        AR_FORMAL: "بخير، شكرًا لك. كيف حالك؟",
        EN_US: "Doing good. How about you?",
        FRANCO_ARABIC: "tamam el7amdellah, enta a5barak eh?",
        MIXED_AR_EN: "تمام الحمد لله، إنت عامل إيه؟",
      });
    }
    if (thanks) return this.pick(style, {
      AR_EGYPTIAN: "العفو، أنا معاك.",
      AR_GULF: "العفو، أنا معك.",
      AR_FORMAL: "على الرحب والسعة.",
      EN_US: "You’re welcome.",
      FRANCO_ARABIC: "el 3afw, ana ma3ak.",
      MIXED_AR_EN: "العفو، أنا معاك.",
    });
    if (unsure) return this.pick(style, {
      AR_EGYPTIAN: "ولا يهمك. خلينا نبدأ من أهم حاجة: بتدور للسكن ولا للاستثمار؟",
      AR_GULF: "ولا يهمك. نبدأ من الأهم: تدور للسكن أو للاستثمار؟",
      AR_FORMAL: "لا بأس. لنبدأ بالأهم: هل تبحث للسكن أم للاستثمار؟",
      EN_US: "No problem. Let’s start with the main thing: is this for living or investment?",
      FRANCO_ARABIC: "wala yhemmak. nebda2 bel aham: btedor lel sakan wala investment?",
      MIXED_AR_EN: "ولا يهمك. نبدأ بالأهم: للسكن ولا investment؟",
    });
    return this.safeFallback(style);
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
    if (reason === "RESULT_LIST_EMPTY") return this.pick(style, {
      AR_EGYPTIAN: "لسه ما ظهرش عندنا اختيارات عشان يبقى فيه أول واحدة.",
      AR_GULF: "ما ظهرت عندنا خيارات إلى الآن عشان يكون فيه خيار أول.",
      AR_FORMAL: "لم تظهر لدينا خيارات بعد حتى يكون هناك خيار أول.",
      EN_US: "We don’t have a result list yet, so there isn’t a first option to select.",
      FRANCO_ARABIC: "lessa ma zaharsh options 3ashan yeb2a fe awel wa7da.",
      MIXED_AR_EN: "لسه ما ظهرش options عشان يبقى فيه first choice.",
    });
    if (reason === "PRICE_REFERENCE_AMBIGUOUS") return this.pick(style, {
      AR_EGYPTIAN: "تقصد الميزانية اللي كنا محددينها ولا سعر وحدة معينة؟",
      AR_GULF: "تقصد الميزانية اللي حددناها أو سعر وحدة معينة؟",
      AR_FORMAL: "هل تقصد الميزانية التي حددناها أم سعر وحدة معينة؟",
      EN_US: "Do you mean the budget we set, or the price of a specific unit?",
      FRANCO_ARABIC: "ta2sed el budget elli 7adadnaha wala se3r wa7da mo3ayana?",
      MIXED_AR_EN: "تقصد الـbudget اللي حددناه ولا price لوحدة معينة؟",
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
      AR_EGYPTIAN: "لسه ما دورتش فعليًا، فمش هقولك إن في اختيارات.",
      AR_GULF: "لسه ما بحثت فعليًا، فما أقدر أحكم على الخيارات.",
      AR_FORMAL: "لم أبحث فعليًا بعد، لذلك لا يمكنني الحكم على الخيارات.",
      EN_US: "I haven’t checked the listings yet, so I can’t judge the options.",
      FRANCO_ARABIC: "lessa ma dawartsh fe3lan, fa msh ha7kom 3al options.",
      MIXED_AR_EN: "لسه ما عملتش search فعلي، فمقدرش أحكم على الـoptions.",
    });
  }

  searchFailed(style: NadimLanguageStyle) {
    return this.pick(style, {
      AR_EGYPTIAN: "في مشكلة في البحث دلوقتي، فمش هفترض إن في اختيارات أو لأ.",
      AR_GULF: "في مشكلة في البحث حاليًا، فما راح أفترض إن فيه خيارات.",
      AR_FORMAL: "تعذر البحث حاليًا، لذلك لن أفترض وجود خيارات.",
      EN_US: "The search isn’t working right now, so I won’t guess what’s available.",
      FRANCO_ARABIC: "el search msh shaghala delwa2ty, fa msh haftared en fe options.",
      MIXED_AR_EN: "في مشكلة في الـsearch دلوقتي، فمش هفترض إن في options.",
    });
  }

  noMatch(style: NadimLanguageStyle, context: { change?: string; previousAssistantWording?: string } = {}) {
    const primary = this.pick(style, {
      AR_EGYPTIAN: "مش شايف حاجة مناسبة داخلة في الطلب ده دلوقتي.",
      AR_GULF: "ما ظهر لي شيء مناسب للطلب هذا حاليًا.",
      AR_FORMAL: "لا يظهر خيار مناسب لهذا الطلب حاليًا.",
      EN_US: "Nothing useful is showing up with that setup yet.",
      FRANCO_ARABIC: "msh shayef 7aga monaseba lel talab da delwa2ty.",
      MIXED_AR_EN: "مش ظاهر option مناسب للطلب ده دلوقتي.",
    });
    const alternate = this.pick(style, {
      AR_EGYPTIAN: "لحد دلوقتي مفيش حاجة مناسبة ظاهرة قدامي.",
      AR_GULF: "إلى الآن ما عندي خيار مناسب ظاهر.",
      AR_FORMAL: "لم يظهر خيار مناسب حتى الآن.",
      EN_US: "I’m not seeing a solid option for it right now.",
      FRANCO_ARABIC: "le7ad delwa2ty msh zaher option monaseb.",
      MIXED_AR_EN: "لحد دلوقتي مفيش option مناسب ظاهر.",
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
      const facts = [plan.name, plan.downPaymentPercent != null ? `${plan.downPaymentPercent}%` : this.money(plan.downPaymentAmount, plan.currency, style), duration, this.money(plan.installmentAmount, plan.currency, style)].filter(Boolean);
      return `${index + 1}. ${facts.join(" · ")}`;
    });
    return [intro, ...lines].join("\n");
  }

  price(style: NadimLanguageStyle, unit?: any) {
    if (unit?.price == null) return this.unknown(style);
    const id = unit.externalUnitId ?? unit.id ?? "";
    const price = this.money(unit.price, unit.currency, style);
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
      AR_EGYPTIAN: "تمام، نخليها زي ما هي.",
      AR_GULF: "تمام، نخليها مثل ما هي.",
      AR_FORMAL: "حسنًا، نبقيها كما هي.",
      EN_US: "Got it — we’ll keep it as is.",
      FRANCO_ARABIC: "tamam, nkhalyha zay ma heya.",
      MIXED_AR_EN: "تمام، نخليها as is.",
    });
  }

  currentSearch(style: NadimLanguageStyle, state: NadimState, target: CurrentSearchQueryTarget = "SEARCH") {
    if (target === "SELECTED_RESULT") {
      const ordinal = state.selectedUnitId ? state.lastResultIds.indexOf(state.selectedUnitId) + 1 : 0;
      if (ordinal > 0) return this.pick(style, {
        AR_EGYPTIAN: `كنت مختار الاختيار رقم ${ordinal}.`,
        AR_GULF: `كنت مختار الخيار رقم ${ordinal}.`,
        AR_FORMAL: `كنت قد اخترت الخيار رقم ${ordinal}.`,
        EN_US: `You selected option ${ordinal}.`,
        FRANCO_ARABIC: `enta kont me5tar option ${ordinal}.`,
        MIXED_AR_EN: `كنت مختار option ${ordinal}.`,
      });
      if (state.selectedUnitId) return this.pick(style, {
        AR_EGYPTIAN: "أيوه، فيه وحدة محددة عندي، بس مش ضمن قائمة اختيارات ظاهرة دلوقتي.",
        AR_GULF: "إيه، عندي وحدة محددة، لكنها مو ضمن قائمة خيارات ظاهرة حاليًا.",
        AR_FORMAL: "نعم، لدي وحدة محددة، لكنها ليست ضمن قائمة خيارات ظاهرة حاليًا.",
        EN_US: "Yes, there is a selected unit, but it isn’t in the current visible result list.",
        FRANCO_ARABIC: "aywa, fe wa7da mo3ayana bas mesh fe current visible options.",
        MIXED_AR_EN: "أيوه، فيه specific unit محددة، بس مش في الـcurrent list.",
      });
      return this.pick(style, {
        AR_EGYPTIAN: "لسه ما اخترناش وحدة معينة.",
        AR_GULF: "ما اخترنا وحدة معينة إلى الآن.",
        AR_FORMAL: "لم نختر وحدة معينة بعد.",
        EN_US: "We haven’t selected a specific unit yet.",
        FRANCO_ARABIC: "lessa ma e5tarnash wa7da mo3ayana.",
        MIXED_AR_EN: "لسه ما اخترناش specific unit.",
      });
    }
    if (target === "budgetMax") {
      const value = this.money(state.search.budgetMax, state.search.currency, style, style === "EN_US" || style === "MIXED_AR_EN");
      return value ? this.pick(style, {
        AR_EGYPTIAN: `${value}.`,
        AR_GULF: `${value}.`,
        AR_FORMAL: `${value}.`,
        EN_US: `You’re at ${value} right now.`,
        FRANCO_ARABIC: `${value}.`,
        MIXED_AR_EN: `إحنا على ${value} دلوقتي.`,
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
        AR_EGYPTIAN: `${value} غرف.`,
        AR_GULF: `${value} غرف.`,
        AR_FORMAL: `${value} غرف.`,
        EN_US: `${value} bedrooms.`,
        FRANCO_ARABIC: `${value} rooms.`,
        MIXED_AR_EN: `${value} bedrooms.`,
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

    const hasDetails = state.search.propertyTypes.length > 0
      || state.search.locations.length > 0
      || state.search.bedrooms !== undefined
      || state.search.budgetMax !== undefined;
    if (!hasDetails) return this.pick(style, {
      AR_EGYPTIAN: "لسه ما حددناش مواصفات للبحث.", AR_GULF: "ما حددنا مواصفات للبحث إلى الآن.", AR_FORMAL: "لم نحدد مواصفات للبحث بعد.", EN_US: "We haven’t set any search preferences yet.", FRANCO_ARABIC: "lessa ma 7adadnash search specs.", MIXED_AR_EN: "لسه ما حددناش search preferences.",
    });
    return this.searchSummary(style, state);
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
    if (budget) {
      const value = this.money(state.search.budgetMax, state.search.currency, style, style === "EN_US" || style === "MIXED_AR_EN");
      return this.pick(style, {
        AR_EGYPTIAN: `تمام، نخليها لحد ${value}.`,
        AR_GULF: `تمام، نخليها إلى ${value}.`,
        AR_FORMAL: `حسنًا، نجعلها حتى ${value}.`,
        EN_US: `Got it — we’ll make it ${value}.`,
        FRANCO_ARABIC: `tamam, nkhalyha ${value}.`,
        MIXED_AR_EN: `تمام، نخلي الـbudget ${value}.`,
      });
    }
    if (operations.some((operation) => operation.operation === "REMOVE" && operation.field === "locations")) return this.pick(style, {
      AR_EGYPTIAN: "تمام، نخلي المكان مفتوح.",
      AR_GULF: "تمام، نخلي الموقع مفتوح.",
      AR_FORMAL: "حسنًا، نترك الموقع مفتوحًا.",
      EN_US: "Got it — we’ll keep the location open.",
      FRANCO_ARABIC: "tamam, nkhaly el location maftoo7.",
      MIXED_AR_EN: "تمام، نخلي الـlocation مفتوح.",
    });
    return undefined;
  }

  money(value: unknown, currency = "EGP", style: NadimLanguageStyle = "EN_US", includeCurrency = true) {
    const number = Number(value);
    if (!Number.isFinite(number)) return undefined;
    const currencyCode = currency ?? "EGP";
    if (number >= 1_000_000) {
      const millions = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(number / 1_000_000);
      if (style === "EN_US" || style === "MIXED_AR_EN") return `${millions}M${includeCurrency ? ` ${currencyCode}` : ""}`;
      if (style === "FRANCO_ARABIC") return `${millions} million${includeCurrency ? ` ${currencyCode}` : ""}`;
      const label = currencyCode === "EGP" ? "جنيه" : currencyCode === "AED" ? "درهم" : currencyCode === "USD" ? "دولار" : currencyCode;
      return `${millions} مليون${includeCurrency ? ` ${label}` : ""}`;
    }
    const amount = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(number);
    if (!includeCurrency) return amount;
    if (["AR_EGYPTIAN", "AR_GULF", "AR_FORMAL"].includes(style)) {
      const label = currencyCode === "EGP" ? "جنيه" : currencyCode === "AED" ? "درهم" : currencyCode === "USD" ? "دولار" : currencyCode;
      return `${amount} ${label}`;
    }
    return `${amount} ${currencyCode}`;
  }

  private searchSummary(style: NadimLanguageStyle, state: NadimState) {
    const separator = style === "EN_US" || style === "FRANCO_ARABIC" ? " or " : " أو ";
    const property = state.search.propertyTypes.map((value) => this.propertyLabel(style, value)).join(separator);
    const bedrooms = state.search.bedrooms;
    const subject = style === "EN_US"
      ? [bedrooms !== undefined ? `${bedrooms}-bedroom` : undefined, property].filter(Boolean).join(" ")
      : [property || undefined, bedrooms !== undefined ? `${bedrooms} ${style === "FRANCO_ARABIC" ? "rooms" : style === "MIXED_AR_EN" ? "bedrooms" : "غرف"}` : undefined].filter(Boolean).join(" ");
    const location = state.search.locations.join(style === "EN_US" || style === "FRANCO_ARABIC" ? ", " : "، ");
    const budget = this.money(state.search.budgetMax, state.search.currency, style, style === "EN_US" || style === "MIXED_AR_EN");

    if (style === "EN_US") {
      const first = [subject || undefined, location ? `in ${location}` : undefined].filter(Boolean).join(" ");
      const budgetPart = budget ? `up to ${budget}` : undefined;
      return `${[first || undefined, budgetPart].filter(Boolean).join(", ")}.${location ? "" : " Location is open."}`;
    }
    if (style === "FRANCO_ARABIC") {
      const first = [subject || undefined, location ? `fe ${location}` : undefined].filter(Boolean).join(" ");
      const budgetPart = budget ? `le7ad ${budget}` : undefined;
      return `${[first || undefined, budgetPart].filter(Boolean).join(", ")}.${location ? "" : " wel location maftoo7."}`;
    }
    if (style === "MIXED_AR_EN") {
      const first = [subject || undefined, location ? `في ${location}` : undefined].filter(Boolean).join(" ");
      const budgetPart = budget ? `والـbudget لحد ${budget}` : undefined;
      return `${[first || undefined, budgetPart].filter(Boolean).join("، ")}.${location ? "" : " والـlocation مفتوح."}`;
    }
    const first = [subject || undefined, location ? `في ${location}` : undefined].filter(Boolean).join(" ");
    const budgetPart = budget ? `${style === "AR_FORMAL" ? "والميزانية حتى" : "والميزانية لحد"} ${budget}` : undefined;
    const openLocation = location ? "" : style === "AR_FORMAL" ? " والموقع مفتوح." : " والمكان مفتوح.";
    return `${[first || undefined, budgetPart].filter(Boolean).join("، ")}.${openLocation}`;
  }

  private propertyLabel(style: NadimLanguageStyle, value: string) {
    const key = value.toLowerCase().replace(/[\s_-]/gu, "");
    const arabic: Record<string, string> = {
      apartment: "شقة", flat: "شقة", villa: "فيلا", townhouse: "تاون هاوس", twinhouse: "توين هاوس",
      duplex: "دوبلكس", penthouse: "بنتهاوس", chalet: "شاليه", studio: "استوديو", office: "مكتب", retail: "محل", clinic: "عيادة", land: "أرض",
    };
    const english: Record<string, string> = {
      apartment: "apartment", flat: "apartment", villa: "villa", townhouse: "townhouse", twinhouse: "twin house",
      duplex: "duplex", penthouse: "penthouse", chalet: "chalet", studio: "studio", office: "office", retail: "retail space", clinic: "clinic", land: "land",
    };
    if (["AR_EGYPTIAN", "AR_GULF", "AR_FORMAL"].includes(style)) return arabic[key] ?? "عقار";
    return english[key] ?? (style === "FRANCO_ARABIC" ? "property" : "property");
  }

  private unitLine(style: NadimLanguageStyle, unit: any, index: number) {
    const id = unit.externalUnitId ?? unit.id;
    const isEnglish = style === "EN_US";
    const isFranco = style === "FRANCO_ARABIC";
    const facts = [
      unit.unitType ? this.propertyLabel(style, unit.unitType) : undefined,
      unit.bedrooms != null ? `${unit.bedrooms} ${isEnglish ? "bedrooms" : isFranco ? "rooms" : "غرف"}` : undefined,
      unit.bathrooms != null ? `${unit.bathrooms} ${isEnglish ? "bathrooms" : isFranco ? "bathrooms" : "حمام"}` : undefined,
      unit.builtUpArea != null ? `${unit.builtUpArea} m²` : undefined,
      this.money(unit.price, unit.currency, style),
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
