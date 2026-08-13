import * as assert from "node:assert/strict";
import { test } from "node:test";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { AdminAuthGuard } from "../auth/admin-auth.guard";
import { ImportsController } from "./imports.controller";

const request = {
  requestId: "request-1",
  admin: { id: "admin-1" },
};

function file(name: string, bytes: number[], mimetype = "application/octet-stream") {
  const buffer = Buffer.from(bytes);
  return { originalname: name, buffer, size: buffer.length, mimetype } as Express.Multer.File;
}

test("import routes remain protected by AdminAuthGuard", () => {
  const guards = Reflect.getMetadata(GUARDS_METADATA, ImportsController) as unknown[];
  assert.ok(guards.includes(AdminAuthGuard));
});

test("upload accepts browser-variable MIME when XLSX signature is valid", async () => {
  let received: any;
  const controller = new ImportsController(
    {
      analyze: async (...args: any[]) => {
        received = args;
        return { id: "import-1" };
      },
    } as any,
    { record: async () => undefined } as any,
  );
  const result: any = await controller.upload(
    file("inventory.xlsx", [0x50, 0x4b, 0x03, 0x04]),
    {},
    request,
  );
  assert.equal(result.id, "import-1");
  assert.equal(received[2].requestId, "request-1");
});

test("unsupported extensions and renamed files return 415 codes", async () => {
  const controller = new ImportsController({} as any, {} as any);
  await assert.rejects(
    () => controller.upload(file("inventory.txt", [1, 2]), {}, request),
    (error: any) => {
      assert.equal(error.getStatus(), 415);
      assert.equal(error.getResponse().code, "IMPORT_UNSUPPORTED_FILE_TYPE");
      return true;
    },
  );
  await assert.rejects(
    () => controller.upload(file("renamed.xlsx", [1, 2]), {}, request),
    (error: any) => {
      assert.equal(error.getStatus(), 415);
      assert.equal(error.getResponse().code, "IMPORT_SIGNATURE_MISMATCH");
      return true;
    },
  );
});
