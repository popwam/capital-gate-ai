import { Injectable } from "@nestjs/common";
import { OpenAICompatibleProvider } from "./openai-compatible.provider";

@Injectable()
export class GroqProvider extends OpenAICompatibleProvider {
  protected readonly providerName = "groq" as const;
  protected readonly apiKey = process.env.GROQ_API_KEY ?? "";
  protected readonly model = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
  protected readonly endpoint = "https://api.groq.com/openai/v1/chat/completions";
}
