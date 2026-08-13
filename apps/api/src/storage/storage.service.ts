import { Injectable, Logger } from "@nestjs/common";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export type StoredObject = { key: string; url: string; size: number; mimeType: string };
interface StorageProvider { put(input: { buffer: Buffer; fileName: string; mimeType: string; folder: string }): Promise<StoredObject>; get(key: string): Promise<Buffer>; delete(key: string): Promise<void>; }

export class StorageProviderError extends Error {
  constructor(
    readonly code: "AUTH" | "BUCKET" | "NETWORK" | "UNKNOWN",
    readonly upstreamStatus: number | undefined,
    cause: unknown,
  ) {
    super("Object storage operation failed", { cause });
    this.name = "StorageProviderError";
  }
}

function storageFailure(error: unknown) {
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode;
  const name = String((error as { name?: unknown })?.name ?? "");
  const code =
    status === 401 || status === 403
      ? "AUTH"
      : status === 404 || /NoSuchBucket/i.test(name)
        ? "BUCKET"
        : !status || status >= 500
          ? "NETWORK"
          : "UNKNOWN";
  return new StorageProviderError(code, status, error);
}

class R2Provider implements StorageProvider {
  private readonly bucket = process.env.R2_BUCKET!; private readonly publicBase = process.env.R2_PUBLIC_BASE_URL!.replace(/\/$/, "");
  private readonly client = new S3Client({ region: "auto", endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! } });
  async put(input: { buffer: Buffer; fileName: string; mimeType: string; folder: string }) { const safe = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "-"); const key = `${input.folder}/${randomUUID()}-${safe}`; try { await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: input.buffer, ContentType: input.mimeType })); } catch (error) { throw storageFailure(error); } return { key, url: `${this.publicBase}/${key}`, size: input.buffer.length, mimeType: input.mimeType }; }
  async get(key: string) { const output = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })); if (!output.Body) throw new Error("Stored object has no body"); return Buffer.from(await output.Body.transformToByteArray()); }
  async delete(key: string) { try { await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })); } catch (error) { throw storageFailure(error); } }
}
class LocalDevelopmentProvider implements StorageProvider {
  private readonly root = join(process.cwd(), ".local-storage");
  async put(input: { buffer: Buffer; fileName: string; mimeType: string; folder: string }) { const safe = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "-"); const key = `${input.folder}/${randomUUID()}-${safe}`; const path = join(this.root, key); await mkdir(dirname(path), { recursive: true }); await writeFile(path, input.buffer); return { key, url: `/v1/storage/${key}`, size: input.buffer.length, mimeType: input.mimeType }; }
  get(key: string) { return readFile(join(this.root, key)); }
  async delete(key: string) { try { await unlink(join(this.root, key)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
}

@Injectable()
export class StorageService {
  private readonly provider: StorageProvider;
  constructor() {
    const selected = (process.env.STORAGE_PROVIDER ?? (process.env.NODE_ENV === "production" ? "r2" : "local")).toLowerCase();
    if (selected === "r2") { for (const name of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_BASE_URL"]) if (!process.env[name]) throw new Error(`${name} is required when STORAGE_PROVIDER=r2`); this.provider = new R2Provider(); }
    else if (selected === "local" && process.env.NODE_ENV !== "production") { new Logger(StorageService.name).warn("Using development-only local object storage"); this.provider = new LocalDevelopmentProvider(); }
    else throw new Error(`Unsupported STORAGE_PROVIDER: ${selected}`);
  }
  put(buffer: Buffer, fileName: string, mimeType: string, folder: string) { return this.provider.put({ buffer, fileName, mimeType, folder }); }
  get(key: string) { return this.provider.get(key); }
  delete(key: string) { return this.provider.delete(key); }
}
