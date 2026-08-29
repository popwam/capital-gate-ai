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
import { ConversationControlService } from "./brain/conversation-control.service";
import { ToolExecutorService } from "./brain/tool-executor.service";
import { ToolLoopService } from "./brain/tool-loop.service";
import { DeterministicTimeService } from "./brain/deterministic-time.service";
import { UnderstandingService } from "./brain/understanding.service";
import { NadimV2Controller } from "./nadim-v2.controller";
import { NadimV2Service } from "./nadim-v2.service";
import { NadimConversationService } from "./persistence/nadim-conversation.service";
import { LanguageStyleDetectorService } from "./personality/language-style-detector.service";
import { ResponseStyleService } from "./personality/response-style.service";
import { BedrockGlmProvider } from "./providers/bedrock-glm.provider";
import { DialogueModelService } from "./providers/dialogue-model.service";
import { GroqDialogueProvider } from "./providers/groq-dialogue.provider";
import { NadimGatewayGuard } from "./security/nadim-gateway.guard";
import { CustomerLifecycleController } from "./product/customer-lifecycle.controller";
import { CustomerLifecycleService } from "./product/customer-lifecycle.service";

@Module({
  imports: [DatabaseModule],
  controllers: [NadimV2Controller, CustomerLifecycleController],
  providers: [
    ApplicationCache,
    PropertySearchService,
    AIUsageService,
    BedrockGlmProvider,
    GroqDialogueProvider,
    DialogueModelService,
    UnderstandingService,
    StateEngineService,
    ConversationControlService,
    PlannerService,
    ToolExecutorService,
    ToolLoopService,
    DeterministicTimeService,
    AutomationActionClient,
    ActionPolicyService,
    ResponseComposerService,
    LanguageStyleDetectorService,
    ResponseStyleService,
    NadimConversationService,
    NadimGatewayGuard,
    CustomerLifecycleService,
    NadimV2Service,
  ],
  exports: [DialogueModelService, CustomerLifecycleService],
})
export class NadimV2Module {}
