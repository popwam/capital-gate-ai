import * as assert from "node:assert/strict";
import { test } from "node:test";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { LeadStatus } from "@prisma/client";
import { AdminAuthGuard } from "../auth/admin-auth.guard";
import { leadPersistenceAction } from "../chat.service";
import {
  AdminConversationsController,
  LeadCrmController,
} from "./lead-crm.controller";
import {
  AdminConversationExportQueryDto,
  LeadListQueryDto,
} from "./lead-crm.dto";
import { LeadCrmService } from "./lead-crm.service";

function fixture() {
  const calls: any[] = [];
  const lead = {
    id: "lead-1",
    name: "Customer",
    phone: "+20100",
    status: LeadStatus.NEW,
    intent: "PURCHASE",
    intentScore: 91,
    payload: {
      conversationSummary: {
        preferredLocations: ["New Cairo"],
        budget: { max: 10_000_000, currency: "EGP" },
      },
      interestedProjects: [],
      interestedUnits: [],
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    followUpAt: null,
    assignedTo: null,
    conversation: { id: "conversation-1", title: "Home search" },
    events: [],
    notes: [],
  };
  const tx: any = {
    lead: {
      update: async (args: any) => {
        calls.push(["lead.update", args]);
        return {
          id: "lead-1",
          status: args.data.status ?? LeadStatus.NEW,
          assignedToAdminId: null,
          followUpAt: null,
          updatedAt: new Date(),
        };
      },
    },
    leadEvent: {
      create: async (args: any) => {
        calls.push(["event.create", args]);
        return { id: "event-1" };
      },
    },
    leadNote: {
      create: async (args: any) => {
        calls.push(["note.create", args]);
        return {
          id: "note-1",
          content: args.data.content,
          createdAt: new Date(),
          updatedAt: new Date(),
          adminUser: { id: "admin-1", name: "Admin" },
        };
      },
    },
  };
  const prisma: any = {
    project: { findMany: async () => [] },
    unit: { findMany: async () => [] },
    adminUser: { findFirst: async () => ({ id: "admin-1" }) },
    lead: {
      count: async (args: any) => {
        calls.push(["lead.count", args]);
        return 21;
      },
      findMany: async (args: any) => {
        calls.push(["lead.findMany", args]);
        return [lead];
      },
      findUnique: async (args: any) =>
        args.select?.status
          ? {
              status: LeadStatus.NEW,
              assignedToAdminId: null,
              followUpAt: null,
            }
          : { id: "lead-1" },
    },
    conversation: {
      count: async (args: any) => {
        calls.push(["conversation.count", args]);
        return 1;
      },
      findMany: async (args: any) => {
        calls.push(["conversation.findMany", args]);
        return [
          {
            id: "conversation-1",
            title: "Home search",
            detectedLanguage: "ar",
            createdAt: new Date("2026-08-23T09:00:00.000Z"),
            updatedAt: new Date("2026-08-24T09:00:00.000Z"),
            state: { summary: {}, searchContext: {}, intentScore: 91 },
            leads: [],
            messages: [],
          },
        ];
      },
    },
    $transaction: async (arg: any) =>
      typeof arg === "function" ? arg(tx) : Promise.all(arg),
  };
  const audit: any = {
    record: async (...args: any[]) => calls.push(["audit", args]),
  };
  return { service: new LeadCrmService(prisma, audit), calls };
}

test("Admin lead list applies server pagination and returns page metadata", async () => {
  const { service, calls } = fixture();
  const query = Object.assign(new LeadListQueryDto(), { page: 2, limit: 20 });
  const result = await service.list(query);
  assert.equal(result.page, 2);
  assert.equal(result.total, 21);
  assert.equal(result.totalPages, 2);
  assert.equal(result.items.length, 1);
  const find = calls.find(([name]) => name === "lead.findMany")[1];
  assert.equal(find.skip, 20);
  assert.equal(find.take, 20);
});

test("Lead status update persists transition event and audit record", async () => {
  const { service, calls } = fixture();
  const result = await service.update(
    "lead-1",
    { status: LeadStatus.CONTACTED },
    "admin-1",
  );
  assert.equal(result.status, LeadStatus.CONTACTED);
  const event = calls.find(([name]) => name === "event.create")[1];
  assert.equal(event.data.type, "STATUS_CHANGED");
  assert.equal(event.data.payload.previousStatus, LeadStatus.NEW);
  assert.equal(event.data.payload.newStatus, LeadStatus.CONTACTED);
  assert.ok(calls.some(([name]) => name === "audit"));
});

test("Lead note creation stores author, creates timeline event, and audits", async () => {
  const { service, calls } = fixture();
  const note = await service.addNote(
    "lead-1",
    { content: "  Evening calls preferred.  " },
    "admin-1",
  );
  assert.equal(note.content, "Evening calls preferred.");
  assert.ok(calls.some(([name]) => name === "note.create"));
  assert.equal(
    calls.find(([name]) => name === "event.create")[1].data.type,
    "NOTE_ADDED",
  );
});

test("Admin lead controller is protected by AdminAuthGuard", () => {
  const guards = Reflect.getMetadata(
    GUARDS_METADATA,
    LeadCrmController,
  ) as unknown[];
  assert.ok(guards.includes(AdminAuthGuard));
  const conversationGuards = Reflect.getMetadata(
    GUARDS_METADATA,
    AdminConversationsController,
  ) as unknown[];
  assert.ok(conversationGuards.includes(AdminAuthGuard));
});

test("conversation export reuses search filters, returns the requested file, and audits access", async () => {
  const { service, calls } = fixture();
  const query = Object.assign(new AdminConversationExportQueryDto(), {
    format: "json" as const,
    search: "Home",
  });
  const result = await service.exportConversations(query, "admin-1");
  assert.equal(result.contentType, "application/json; charset=utf-8");
  assert.equal(JSON.parse(result.body.toString("utf8")).count, 1);
  const find = calls.find(([name]) => name === "conversation.findMany")[1];
  assert.equal(find.where.AND[0].OR[0].title.contains, "Home");
  const audit = calls.find(([name]) => name === "audit")[1];
  assert.equal(audit[1], "CONVERSATIONS_EXPORTED");
  assert.equal(audit[4].format, "json");
});

test("AdminAuthGuard rejects unauthorized lead access", async () => {
  const guard = new AdminAuthGuard({
    verify: async () => {
      throw new Error("invalid");
    },
  } as any);
  const context: any = {
    switchToHttp: () => ({
      getRequest: () => ({ cookies: { maqar_admin_session: "invalid" } }),
    }),
  };
  await assert.rejects(() => guard.canActivate(context), /Unauthorized/);
});

test("Lead creation conservatively updates an active conversation lead and ignores weak non-sales contact", () => {
  assert.equal(leadPersistenceAction("active-lead", "+20100", 45), "update");
  assert.equal(leadPersistenceAction(undefined, "+20100", 69), "none");
  assert.equal(leadPersistenceAction(undefined, "+20100", 80), "create");
  assert.equal(leadPersistenceAction(undefined, undefined, 95), "none");
});
