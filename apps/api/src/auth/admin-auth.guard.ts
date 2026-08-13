import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { AdminAuthService } from "./admin-auth.service";

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly auth: AdminAuthService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest(); const token = request.cookies?.maqar_admin_session;
    if (!token) throw new UnauthorizedException();
    try { request.admin = await this.auth.verify(token); return true; } catch { throw new UnauthorizedException(); }
  }
}
