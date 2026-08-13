import { BadRequestException, Body, Controller, Delete, Get, Headers, Logger, Param, Patch, Post, Req, Res } from "@nestjs/common";
import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import type { Response } from "express";
import { ConversationsService } from "./conversations.service";
import { ChatService } from "./chat.service";

class CreateConversationDto { @IsOptional() @IsString() @MaxLength(80) title?: string; }
class RenameConversationDto { @IsString() @MinLength(1) @MaxLength(80) title!: string; }
class SendMessageDto { @IsString() @IsNotEmpty() @MaxLength(8_000) content!: string; }
export function upstreamErrorCategory(error: any) { const response = typeof error?.getResponse === "function" ? error.getResponse() : undefined; return response?.category ?? response?.code ?? error?.code ?? "UNKNOWN"; }

@Controller("conversations")
export class ConversationsController {
  private readonly logger = new Logger(ConversationsController.name);
  constructor(private readonly conversations: ConversationsService, private readonly chat: ChatService) {}
  private token(value?: string) { if (!value || value.length < 20) throw new BadRequestException("A valid x-device-token header is required"); return value; }

  @Get() list(@Headers("x-device-token") token?: string) { return this.conversations.list(this.token(token)); }
  @Post() create(@Headers("x-device-token") token: string | undefined, @Body() body: CreateConversationDto) { return this.conversations.create(this.token(token), body.title); }
  @Get(":id/messages") messages(@Param("id") id: string, @Headers("x-device-token") token?: string) { return this.conversations.messages(id, this.token(token)); }
  @Patch(":id") rename(@Param("id") id: string, @Headers("x-device-token") token: string | undefined, @Body() body: RenameConversationDto) { return this.conversations.rename(id, this.token(token), body.title); }
  @Delete(":id") remove(@Param("id") id: string, @Headers("x-device-token") token?: string) { return this.conversations.remove(id, this.token(token)); }
  @Post(":id/messages") send(@Param("id") id: string, @Headers("x-device-token") token: string | undefined, @Body() body: SendMessageDto, @Req() request: any) { return this.chat.send(id, this.token(token), body.content, request.requestId); }
  @Post(":id/messages/stream") async stream(@Param("id") id: string, @Headers("x-device-token") token: string | undefined, @Body() body: SendMessageDto, @Res() response: Response, @Req() request: any = {}) {
    response.status(200); response.setHeader("Content-Type", "text/event-stream; charset=utf-8"); response.setHeader("Cache-Control", "no-cache, no-transform"); response.setHeader("Connection", "keep-alive"); response.flushHeaders();
    try { for await (const item of this.chat.stream(id, this.token(token), body.content, request.requestId ?? "unknown")) response.write(`event: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`); }
    catch (error) { this.logger.error(`CustomerStreamFailure requestId=${request.requestId ?? "unknown"} conversationId=${id} stage=AI_PROVIDER errorCategory=${upstreamErrorCategory(error)}`); response.write(`event: error\ndata: ${JSON.stringify({ message: "تعذر إكمال الرد حاليًا. حاول مرة أخرى بعد قليل.", requestId: request.requestId ?? "unknown" })}\n\n`); }
    finally { response.end(); }
  }
}
