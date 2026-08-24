import { Module } from "@nestjs/common";
import { CustomerIdentityService } from "./customers/customer-identity.service";
import { DatabaseModule } from "./database/database.module";
import { HealthController } from "./health/health.controller";
import { IdempotencyService } from "./idempotency/idempotency.service";
import { LeadsController } from "./leads/leads.controller";
import { LeadsService } from "./leads/leads.service";
import { AutomationSecretGuard } from "./security/automation-secret.guard";

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController, LeadsController],
  providers: [AutomationSecretGuard, CustomerIdentityService, IdempotencyService, LeadsService],
})
export class AppModule {}
