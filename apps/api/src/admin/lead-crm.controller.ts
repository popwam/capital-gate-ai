import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AdminAuthGuard } from "../auth/admin-auth.guard";
import {
  AdminConversationListQueryDto,
  CreateLeadNoteDto,
  LeadListQueryDto,
  UpdateLeadDto,
} from "./lead-crm.dto";
import { LeadCrmService } from "./lead-crm.service";

@UseGuards(AdminAuthGuard)
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
@Controller("admin/conversations")
export class AdminConversationsController {
  constructor(private readonly crm: LeadCrmService) {}
  @Get() list(@Query() query: AdminConversationListQueryDto) {
    return this.crm.conversations(query);
  }
  @Get(":id") detail(@Param("id") id: string) {
    return this.crm.conversation(id);
  }
}
