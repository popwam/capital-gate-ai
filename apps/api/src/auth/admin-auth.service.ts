import { Injectable, Logger, OnModuleInit, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { compare, hash } from "bcryptjs";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit.service";

@Injectable()
export class AdminAuthService implements OnModuleInit {
  private readonly logger = new Logger(AdminAuthService.name);
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService, private readonly audit: AuditService) {}
  async onModuleInit() {
    const count = await this.prisma.adminUser.count();
    const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase(); const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
    if (!count && email && password) {
      if (password.length < 4) throw new Error("ADMIN_BOOTSTRAP_PASSWORD must be at least 12 characters");
      const admin = await this.prisma.adminUser.create({ data: { email, name: "Platform Administrator", passwordHash: await hash(password, 12) } });
      await this.audit.record(admin.id, "ADMIN_BOOTSTRAPPED", "AdminUser", admin.id);
      this.logger.warn("First administrator created. Remove ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD from the environment now.");
    } else if (!count) this.logger.warn("No administrator exists. Set one-time ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD, then redeploy.");
  }
  async login(email: string, password: string) {
    const admin = await this.prisma.adminUser.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!admin?.active || !(await compare(password, admin.passwordHash))) { await this.audit.record(admin?.id, "ADMIN_LOGIN_FAILED", "AdminUser", admin?.id, { email: email.trim().toLowerCase() }); throw new UnauthorizedException("Invalid credentials"); }
    await this.audit.record(admin.id, "ADMIN_LOGIN_SUCCEEDED", "AdminUser", admin.id);
    return { token: await this.jwt.signAsync({ sub: admin.id, role: admin.role, email: admin.email }), admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role } };
  }
  async verify(token: string) { const payload = await this.jwt.verifyAsync<{ sub: string }>(token); const admin = await this.prisma.adminUser.findUnique({ where: { id: payload.sub }, select: { id: true, email: true, name: true, role: true, active: true } }); if (!admin?.active) throw new UnauthorizedException(); return admin; }
}
