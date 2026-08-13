import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AdminAuthController } from "./admin-auth.controller";
import { AdminAuthService } from "./admin-auth.service";
import { AdminAuthGuard } from "./admin-auth.guard";
import { AuditService } from "../audit.service";

@Module({ imports: [JwtModule.register({ secret: process.env.ADMIN_JWT_SECRET || (process.env.NODE_ENV === "production" ? undefined : "development-only-admin-secret-change-me"), signOptions: { expiresIn: "8h", issuer: "maqar-api", audience: "maqar-admin" } })], controllers: [AdminAuthController], providers: [AdminAuthService, AdminAuthGuard, AuditService], exports: [AdminAuthGuard, AdminAuthService, JwtModule] })
export class AuthModule { constructor() { if (process.env.NODE_ENV === "production" && !process.env.ADMIN_JWT_SECRET) throw new Error("ADMIN_JWT_SECRET is required in production"); } }
