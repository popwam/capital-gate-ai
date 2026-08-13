import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, Patch, Post, Res } from "@nestjs/common";
import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import type { Response } from "express";
import { ConversationsService } from "./conversations.service";
import { ChatService } from "./chat.service";

class CreateConversationDto { @IsOptional() @IsString() @MaxLength(80) title?: string; }
class RenameConversationDto { @IsString() @MinLength(1) @MaxLength(80) title!: string; }
class SendMessageDto { @IsString() @IsNotEmpty() @MaxLength(8_000) content!: string; }

@Controller("conversations")
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService, private readonly chat: ChatService) {}
  private token(value?: string) { if (!value || value.length < 20) throw new BadRequestException("A valid x-device-token header is required"); return value; }

  @Get() list(@Headers("x-device-token") token?: string) { return this.conversations.list(this.token(token)); }
  @Post() create(@Headers("x-device-token") token: string | undefined, @Body() body: CreateConversationDto) { return this.conversations.create(this.token(token), body.title); }
  @Get(":id/messages") messages(@Param("id") id: string, @Headers("x-device-token") token?: string) { return this.conversations.messages(id, this.token(token)); }
  @Patch(":id") rename(@Param("id") id: string, @Headers("x-device-token") token: string | undefined, @Body() body: RenameConversationDto) { return this.conversations.rename(id, this.token(token), body.title); }
  @Delete(":id") remove(@Param("id") id: string, @Headers("x-device-token") token?: string) { return this.conversations.remove(id, this.token(token)); }
  @Post(":id/messages") send(@Param("id") id: string, @Headers("x-device-token") token: string | undefined, @Body() body: SendMessageDto) { return this.chat.send(id, this.token(token), body.content); }
  @Post(":id/messages/stream") async stream(@Param("id") id: string, @Headers("x-device-token") token: string | undefined, @Body() body: SendMessageDto, @Res() response: Response) {
    response.status(200); response.setHeader("Content-Type", "text/event-stream; charset=utf-8"); response.setHeader("Cache-Control", "no-cache, no-transform"); response.setHeader("Connection", "keep-alive"); response.flushHeaders();
    try { for await (const item of this.chat.stream(id, this.token(token), body.content)) response.write(`event: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`); }
    catch (error) { response.write(`event: error\ndata: ${JSON.stringify({ message: error instanceof Error ? error.message : "Chat failed" })}\n\n`); }
    finally { response.end(); }
  }
}
