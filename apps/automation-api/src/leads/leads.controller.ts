import { Body, Controller, HttpException, Post, UseGuards } from "@nestjs/common";
import { statusForCode } from "../common/automation-error";
import { AutomationSecretGuard } from "../security/automation-secret.guard";
import { UpsertLeadDto } from "./dto/upsert-lead.dto";
import { LeadsService } from "./leads.service";

@Controller("v1/leads")
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Post("upsert")
  @UseGuards(AutomationSecretGuard)
  async upsert(@Body() body: UpsertLeadDto) {
    const result = await this.leads.upsert(body);
    if (!result.ok) throw new HttpException(result, statusForCode(result.error!.code));
    return result;
  }
}
