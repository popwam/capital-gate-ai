import { Injectable } from "@nestjs/common";
import { OpenAICompatibleProvider } from "./openai-compatible.provider";

@Injectable()
export class OpenAIProvider extends OpenAICompatibleProvider {
  protected readonly providerName = "openai" as const;
  protected readonly apiKey = process.env.OPENAI_API_KEY ?? "";
  protected readonly model = process.env.OPENAI_TEXT_MODEL ?? "gpt-5.4-mini";
  protected readonly endpoint = "https://api.openai.com/v1/chat/completions";
}
