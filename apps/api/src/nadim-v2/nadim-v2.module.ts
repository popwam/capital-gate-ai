import { Module } from "@nestjs/common";
import { ApplicationCache } from "../cache/application-cache";
import { DatabaseModule } from "../database/database.module";
import { PropertySearchService } from "../property-search.service";
import { AIUsageService } from "../providers/ai-usage.service";
import { AutomationActionClient } from "./actions/automation-action.client";
import { ActionPolicyService } from "./brain/action-policy.service";
import { PlannerService } from "./brain/planner.service";
import { ResponseComposerService } from "./brain/response-composer.service";
import { StateEngineService } from "./brain/state-engine.service";
import { ToolExecutorService } from "./brain/tool-executor.service";
import { UnderstandingService } from "./brain/understanding.service";
import { NadimV2Controller } from "./nadim-v2.controller";
import { NadimV2Service } from "./nadim-v2.service";
import { NadimConversationService } from "./persistence/nadim-conversation.service";
import { BedrockGlmProvider } from "./providers/bedrock-glm.provider";
import { DialogueModelService } from "./providers/dialogue-model.service";
import { GroqDialogueProvider } from "./providers/groq-dialogue.provider";
import { NadimGatewayGuard } from "./security/nadim-gateway.guard";

@Module({
  imports: [DatabaseModule],
  controllers: [NadimV2Controller],
  providers: [
    ApplicationCache,
    PropertySearchService,
    AIUsageService,
    BedrockGlmProvider,
    GroqDialogueProvider,
    DialogueModelService,
    UnderstandingService,
    StateEngineService,
    PlannerService,
    ToolExecutorService,
    AutomationActionClient,
    ActionPolicyService,
    ResponseComposerService,
    NadimConversationService,
    NadimGatewayGuard,
    NadimV2Service,
  ],
  exports: [DialogueModelService],
})
export class NadimV2Module {}
