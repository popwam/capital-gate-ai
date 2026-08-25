import { Injectable } from "@nestjs/common";
import { OpenAICompatibleDialogueProvider } from "./openai-dialogue.provider";

@Injectable()
export class BedrockGlmProvider extends OpenAICompatibleDialogueProvider {
  readonly provider = "bedrock-glm";
  readonly model = process.env.BEDROCK_GLM_MODEL?.trim() || "zai.glm-5";
  protected readonly apiKey = process.env.BEDROCK_API_KEY?.trim() || "";
  protected readonly endpoint = `${(process.env.BEDROCK_BASE_URL?.trim() || "https://bedrock-mantle.us-east-1.api.aws/v1").replace(/\/$/u, "")}/chat/completions`;

  enabled() {
    return process.env.BEDROCK_GLM_ENABLED === "true";
  }
}
