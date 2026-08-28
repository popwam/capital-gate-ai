export type DialogueMessage = { role: "system" | "user" | "assistant"; content: string };
export type DialogueHealth = {
  provider: string;
  enabled: boolean;
  configured: boolean;
  healthy: boolean;
  model: string | null;
  errorCode?: string;
  latencyMs?: number;
  priority?: "PRIMARY" | "SECONDARY";
};

export interface DialogueProvider {
  readonly provider: string;
  readonly model: string;
  enabled(): boolean;
  configured(): boolean;
  complete(messages: DialogueMessage[], jsonMode?: boolean): Promise<string>;
  stream(messages: DialogueMessage[]): AsyncIterable<string>;
  health(): Promise<DialogueHealth>;
}

export class DialogueProviderError extends Error {
  constructor(readonly provider: string, readonly code: string, readonly retryable = true) {
    super(`${provider} dialogue request failed (${code})`);
  }
}

export type DialogueProviderAttempt = {
  provider: string;
  model: string;
  latencyMs: number;
  errorCategory: string;
};

export class DialogueProviderChainError extends Error {
  constructor(readonly attempts: DialogueProviderAttempt[]) {
    super("No configured Nadim dialogue provider completed the request");
  }
}

export class DialogueStreamInterruptedError extends Error {
  constructor(readonly provider: string) {
    super(`${provider} stream failed after output started`);
  }
}
