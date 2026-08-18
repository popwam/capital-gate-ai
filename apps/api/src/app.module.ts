import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { DatabaseModule } from "./database/database.module";
import { AuthModule } from "./auth/auth.module";
import { HealthController } from "./health.controller";
import { ConversationsController } from "./conversations.controller";
import { LocationsController } from "./admin/locations.controller";
import { CatalogController } from "./admin/catalog.controller";
import { ImportsController } from "./imports/imports.controller";
import { KnowledgeController } from "./knowledge/knowledge.controller";
import { MapsController } from "./admin/maps.controller";
import { StorageController } from "./storage/storage.controller";
import { ChatService } from "./chat.service";
import { ConversationsService } from "./conversations.service";
import { DevicesService } from "./devices.service";
import { PropertySearchService } from "./property-search.service";
import { ImporterService } from "./imports/importer.service";
import { KnowledgeService } from "./knowledge/knowledge.service";
import { StorageService } from "./storage/storage.service";
import { AuditService } from "./audit.service";
import { DemoAIProvider } from "./providers/demo.provider";
import { CloudflareWorkersAIProvider } from "./providers/cloudflare-workers-ai.provider";
import { GroqProvider } from "./providers/groq.provider";
import { OpenAIProvider } from "./providers/openai.provider";
import { HybridAIProvider } from "./providers/hybrid.provider";
import { AIUsageService } from "./providers/ai-usage.service";
import { createAIProvider } from "./providers/ai-provider.factory";
import { MapsService } from "./maps.service";
import {
  AdminConversationsController,
  LeadCrmController,
} from "./admin/lead-crm.controller";
import { LeadCrmService } from "./admin/lead-crm.service";
import { SystemController } from "./admin/system.controller";
import { RealEstateController } from "./admin/real-estate.controller";
import { ProjectStructureController } from "./admin/project-structure.controller";
import { ApplicationCache } from "./cache/application-cache";
import { CustomerTrustService } from "./customer-trust.service";

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
  ],
  controllers: [
    HealthController,
    ConversationsController,
    LocationsController,
    CatalogController,
    ImportsController,
    KnowledgeController,
    MapsController,
    StorageController,
    LeadCrmController,
    AdminConversationsController,
    SystemController,
    RealEstateController,
    ProjectStructureController,
  ],
  providers: [
    ChatService,
    ConversationsService,
    DevicesService,
    PropertySearchService,
    ApplicationCache,
    CustomerTrustService,
    ImporterService,
    KnowledgeService,
    StorageService,
    MapsService,
    AuditService,
    LeadCrmService,
    DemoAIProvider,
    CloudflareWorkersAIProvider,
    GroqProvider,
    OpenAIProvider,
    HybridAIProvider,
    AIUsageService,
    {
      provide: "AI_PROVIDER",
      inject: [HybridAIProvider, DemoAIProvider],
      useFactory: createAIProvider,
    },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
