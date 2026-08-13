if (!process.env.GEMINI_API_KEY && process.loadEnvFile) {
  try {
    process.loadEnvFile(".env");
  } catch {
    // Railway and CI normally provide environment variables directly.
  }
}

const { GeminiProvider } = await import(
  "../apps/api/dist/providers/gemini.provider.js"
);
const provider = new GeminiProvider();
const baseInput = {
  messages: [{ role: "user", content: "Hello" }],
  intent: { language: "en" },
  verifiedFacts: [],
  approvedKnowledge: [],
};

async function check(name, operation) {
  try {
    await operation();
    console.log(`${name}=PASS`);
    return true;
  } catch (error) {
    const response =
      typeof error?.getResponse === "function" ? error.getResponse() : {};
    console.log(
      `${name}=FAIL status=${response.upstreamStatus ?? "NETWORK"} category=${response.category ?? "UNKNOWN"}`,
    );
    return false;
  }
}

const results = [];
results.push(await check("SIMPLE_GENERATION", () => provider.composeAnswer(baseInput)));
results.push(await check("STREAMING", async () => {
  let received = false;
  for await (const chunk of provider.streamAnswer(baseInput)) received ||= !!chunk;
  if (!received) throw new Error("No stream chunks received");
}));
results.push(await check("ARABIC_INTENT", () =>
  provider.extractIntent(
    [{ role: "user", content: "عاوز شقة 3 غرف في القاهرة الجديدة" }],
    { language: "ar-EG" },
  ),
));
results.push(await check("ENGLISH_INTENT", () =>
  provider.extractIntent(
    [{ role: "user", content: "I need a 3 bedroom apartment in New Cairo" }],
    { language: "en" },
  ),
));
results.push(await check("MIXED_INTENT", () =>
  provider.extractIntent(
    [{ role: "user", content: "عاوز apartment 3 bedrooms في New Cairo" }],
    { language: "ar-EG" },
  ),
));
results.push(await check("KNOWLEDGE_EXTRACTION", () =>
  provider.extractKnowledge(
    "مشروع سكني في القاهرة الجديدة ويضم حدائق ونادياً اجتماعياً.",
  ),
));
if (results.some((result) => !result)) process.exitCode = 1;
