import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { AdminAuthGuard } from "../auth/admin-auth.guard";
import {
  AdminConversationExportQueryDto,
  AdminConversationListQueryDto,
  AdminConversationModeDto,
  AdminConversationDeleteDto,
  AdminConversationHumanMessageDto,
  CreateLeadNoteDto,
  LeadListQueryDto,
  UpdateLeadDto,
  TrustAlertFeedbackDto,
} from "./lead-crm.dto";
import { LeadCrmService } from "./lead-crm.service";

@UseGuards(AdminAuthGuard)
@Throttle({ default: { limit: 5, ttl: 60_000 } })
@Controller("admin/leads")
export class LeadCrmController {
  constructor(private readonly crm: LeadCrmService) {}
  private admin(req: any) {
    return req.admin.id as string;
  }
  @Get() list(@Query() query: LeadListQueryDto) {
    return this.crm.list(query);
  }
  @Get("summary") summary() {
    return this.crm.summaryCounts();
  }
  @Get("trust-alerts") trustAlerts(@Query("limit") limit?: string) {
    return this.crm.trustAlerts(limit ? Number(limit) : 20);
  }
  @Patch("trust-alerts/:id") reviewTrustAlert(
    @Param("id") id: string,
    @Body() body: TrustAlertFeedbackDto,
    @Req() req: any,
  ) {
    return this.crm.reviewTrustAlert(id, body, this.admin(req));
  }
  @Get("options/admins") admins() {
    return this.crm.admins();
  }
  @Get("options/projects") projects() {
    return this.crm.projects();
  }
  @Get(":id") detail(@Param("id") id: string) {
    return this.crm.detail(id);
  }
  @Patch(":id") update(
    @Param("id") id: string,
    @Body() body: UpdateLeadDto,
    @Req() req: any,
  ) {
    return this.crm.update(id, body, this.admin(req));
  }
  @Post(":id/notes") note(
    @Param("id") id: string,
    @Body() body: CreateLeadNoteDto,
    @Req() req: any,
  ) {
    return this.crm.addNote(id, body, this.admin(req));
  }
  @Get(":id/events") events(@Param("id") id: string) {
    return this.crm.events(id);
  }
}

@UseGuards(AdminAuthGuard)
@Throttle({ default: { limit: 5, ttl: 60_000 } })
@Controller("admin/conversations")
export class AdminConversationsController {
  constructor(private readonly crm: LeadCrmService) {}
  private admin(req: any) {
    return req.admin.id as string;
  }
  @Get() list(@Query() query: AdminConversationListQueryDto) {
    return this.crm.conversations(query);
  }
  @Get("export") async export(
    @Query() query: AdminConversationExportQueryDto,
    @Req() req: any,
    @Res() response: Response,
  ) {
    const file = await this.crm.exportConversations(query, this.admin(req));
    response.setHeader("Content-Type", file.contentType);
    response.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
    response.setHeader("Content-Length", file.body.length);
    response.setHeader("Cache-Control", "private, no-store");
    response.send(file.body);
  }
  @Get("workflow/requirements") requirements() {
    return this.crm.requirementsWorkflow();
  }
  @Get("workflow/follow-ups") followUps() {
    return this.crm.followUpsWorkflow();
  }
  @Get(":id") detail(@Param("id") id: string) {
    return this.crm.conversation(id);
  }
  @Patch(":id/mode") mode(@Param("id") id: string, @Body() body: AdminConversationModeDto, @Req() req: any) {
    return this.crm.setConversationMode(id, body.mode, this.admin(req));
  }
  @Post(":id/share") share(@Param("id") id: string, @Req() req: any) {
    return this.crm.createConversationLink(id, "WEB_SHARE", this.admin(req));
  }
  @Post(":id/whatsapp") whatsapp(@Param("id") id: string, @Req() req: any) {
    return this.crm.createConversationLink(id, "WHATSAPP_HANDOFF", this.admin(req));
  }
  @Post(":id/messages") message(@Param("id") id: string, @Body() body: AdminConversationHumanMessageDto, @Req() req: any) {
    return this.crm.sendHumanMessage(id, body.content, this.admin(req));
  }
  @Delete(":id") remove(@Param("id") id: string, @Body() body: AdminConversationDeleteDto, @Req() req: any) {
    return this.crm.deleteConversation(id, body.confirmation, this.admin(req));
  }
}
