import * as assert from "node:assert/strict";
import { test } from "node:test";
import { ConversationsController, upstreamErrorCategory } from "../conversations.controller";
import { ServiceUnavailableException } from "@nestjs/common";
import { ConversationsService } from "../conversations.service";
import { decodeUtf8 } from "./unicode";

const arabic = "عاوز شقة 3 غرف في القاهرة الجديدة";
const mixed = "عاوز apartment 3 bedrooms في New Cairo";

test("UTF-8 decoding preserves Arabic and mixed-language text", () => {
  assert.equal(decodeUtf8(Buffer.from(arabic, "utf8")), arabic);
  assert.equal(decodeUtf8(Buffer.from(mixed, "utf8")), mixed);
});

test("conversation persistence passes Arabic Unicode through unchanged", async () => {
  let createdTitle = "";
  const prisma: any = {
    conversation: {
      create: async ({ data }: any) => {
        createdTitle = data.title;
        return data;
      },
      findFirst: async () => ({ id: "conversation-1" }),
    },
    message: { findMany: async () => [{ role: "USER", content: arabic }] },
  };
  const service = new ConversationsService(prisma, {
    resolve: async () => ({ id: "device-1" }),
  } as any, {
    nextVariant: async () => "control",
  } as any);

  await service.create("a-valid-device-token-123", arabic);
  assert.equal(createdTitle, arabic);
  assert.equal(
    (await service.messages("conversation-1", "a-valid-device-token-123"))[0].content,
    arabic,
  );
});

test("SSE declares UTF-8 and streams Arabic without corruption", async () => {
  const headers: Record<string, string> = {};
  const chunks: string[] = [];
  const response: any = {
    status: () => response,
    setHeader: (name: string, value: string) => { headers[name.toLowerCase()] = value; },
    flushHeaders: () => undefined,
    write: (chunk: string) => chunks.push(chunk),
    end: () => undefined,
  };
  const chat: any = {
    async *stream() {
      yield { event: "token", data: { text: mixed } };
      yield { event: "complete", data: { message: { content: arabic } } };
    },
  };
  const controller = new ConversationsController({} as any, chat);

  await controller.stream("conversation-1", "a-valid-device-token-123", { content: arabic }, response);

  assert.equal(headers["content-type"], "text/event-stream; charset=utf-8");
  const wireText = Buffer.from(chunks.join(""), "utf8").toString("utf8");
  assert.match(wireText, new RegExp(arabic));
  assert.match(wireText, new RegExp(mixed));
});

test("a provider failure after HTTP 200 emits a valid error event with request ID", async () => {
  const chunks: string[] = [];
  const response: any = { status: () => response, setHeader: () => undefined, flushHeaders: () => undefined, write: (chunk: string) => chunks.push(chunk), end: () => undefined };
  const chat: any = { async *stream() { yield { event: "token", data: { text: "جزء" } }; const error: any = new Error("upstream failed"); error.code = "OPENAI_FALLBACK"; throw error; } };
  const controller = new ConversationsController({} as any, chat);
  await controller.stream("conversation-1", "a-valid-device-token-123", { content: arabic }, response, { requestId: "request-safe-1" });
  const wire = chunks.join("");
  assert.match(wire, /event: token/);
  assert.match(wire, /event: error/);
  assert.match(wire, /request-safe-1/);
  assert.doesNotMatch(wire, /upstream failed/);
});

test("SSE diagnostics preserve the terminal provider category",()=>{const error=new ServiceUnavailableException({code:"AI_TEMPORARILY_UNAVAILABLE",provider:"workers",category:"HTTP_503",safe:true});assert.equal(upstreamErrorCategory(error),"HTTP_503");});
