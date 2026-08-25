import { Injectable } from "@nestjs/common";
import { configuredGroqModels } from "../../providers/conversation-model-router";
import { OpenAICompatibleDialogueProvider } from "./openai-dialogue.provider";

@Injectable()
export class GroqDialogueProvider extends OpenAICompatibleDialogueProvider {
  readonly provider = "groq";
  readonly model = configuredGroqModels().general;
  protected readonly apiKey = process.env.GROQ_API_KEY?.trim() || "";
  protected readonly endpoint = "https://api.groq.com/openai/v1/chat/completions";

  enabled() {
    return Boolean(this.apiKey);
  }
}
