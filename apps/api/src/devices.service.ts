import { Injectable } from "@nestjs/common";
import { createHmac } from "node:crypto";
import { PrismaService } from "./database/prisma.service";

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}
  hash(rawToken: string) {
    const secret = process.env.DEVICE_HASH_SECRET || (process.env.NODE_ENV === "production" ? "" : "development-only-device-secret");
    if (!secret) throw new Error("DEVICE_HASH_SECRET is required in production");
    return createHmac("sha256", secret).update(rawToken).digest("hex");
  }
  async resolve(rawToken: string) {
    const hashedDeviceId = this.hash(rawToken);
    return this.prisma.anonymousDevice.upsert({ where: { hashedDeviceId }, create: { hashedDeviceId }, update: { lastSeenAt: new Date() } });
  }
}
