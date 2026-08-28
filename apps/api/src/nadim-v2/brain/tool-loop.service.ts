import { Injectable } from "@nestjs/common";
import { NadimBrainDecision } from "../domain/nadim-brain-decision";
import { NADIM_TOOLS, NadimPlan, NadimToolName, NadimToolResult } from "../domain/nadim-plan";
import { NadimState } from "../domain/nadim-state";
import { DialogueModelService } from "../providers/dialogue-model.service";
import { DialogueProviderChainError } from "../providers/dialogue-provider";
import { ToolExecutorService } from "./tool-executor.service";

type Trace = { conversationId?: string; requestId?: string };

export type ToolLoopResult = {
  results: NadimToolResult[];
  iterations: number;
  finalDecision?: NadimBrainDecision;
  model?: { provider: string; model: string; fallbackUsed: boolean; latencyMs: number };
  providerLatencyMs: number;
  providerErrorCategory?: string;
};

@Injectable()
export class ToolLoopService {
  private readonly maxIterations = 2;

  constructor(
    private readonly tools: ToolExecutorService,
    private readonly dialogue: DialogueModelService,
  ) {}

  async run(plan: NadimPlan, state: NadimState, decision: NadimBrainDecision | undefined, trace: Trace): Promise<ToolLoopResult> {
    const queue = [...plan.steps].slice(0, this.maxIterations);
    const results: NadimToolResult[] = [];
    const executed = new Set<string>();
    let iterations = 0;
    let finalDecision = decision;
    let model: ToolLoopResult["model"];
    let providerLatencyMs = 0;
    let providerErrorCategory: string | undefined;

    while (queue.length && iterations < this.maxIterations) {
      const step = queue.shift()!;
      const signature = JSON.stringify([step.tool, step.arguments]);
      if (executed.has(signature)) continue;
      executed.add(signature);
      const [result] = await this.tools.execute({ goal: plan.goal, steps: [step] }, state);
      if (result) results.push(result);
      iterations += 1;

      if (!decision || !this.dialogue.available() || iterations >= this.maxIterations) continue;
      try {
        const continuation = await this.dialogue.continueAfterTools({
          originalDecision: finalDecision,
          deterministicState: state,
          executedToolCalls: [...executed],
          verifiedToolResults: results,
          remainingIterationBudget: this.maxIterations - iterations,
        }, trace);
        finalDecision = continuation.value;
        model = { provider: continuation.provider, model: continuation.model, fallbackUsed: continuation.fallbackUsed, latencyMs: continuation.latencyMs };
        providerLatencyMs += continuation.latencyMs + continuation.attempts.reduce((sum, attempt) => sum + attempt.latencyMs, 0);
        providerErrorCategory = continuation.attempts.at(-1)?.errorCategory;
        for (const proposed of continuation.value.proposedToolCalls) {
          if (!(NADIM_TOOLS as readonly string[]).includes(proposed.tool)) continue;
          const next = { tool: proposed.tool as NadimToolName, arguments: proposed.arguments };
          if (!executed.has(JSON.stringify([next.tool, next.arguments]))) queue.push(next);
        }
      } catch (error) {
        if (error instanceof DialogueProviderChainError) {
          providerLatencyMs += error.attempts.reduce((sum, attempt) => sum + attempt.latencyMs, 0);
          providerErrorCategory = error.attempts.at(-1)?.errorCategory;
        } else {
          providerErrorCategory = "TOOL_CONTINUATION_FAILED";
        }
      }
    }

    return { results, iterations, finalDecision, model, providerLatencyMs, providerErrorCategory };
  }
}
