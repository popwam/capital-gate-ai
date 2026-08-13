import { Body, Controller, Get, Post, Req, Res, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { IsEmail, IsString, MinLength } from "class-validator";
import type { Request, Response } from "express";
import { AdminAuthService } from "./admin-auth.service";
import { AdminAuthGuard } from "./admin-auth.guard";

class LoginDto { @IsEmail() email!: string; @IsString() @MinLength(8) password!: string; }

@Controller("admin/auth")
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}
  private cookieOptions() { return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, domain: process.env.ADMIN_COOKIE_DOMAIN || undefined, path: "/", maxAge: 8 * 60 * 60 * 1000 }; }
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("login") async login(@Body() body: LoginDto, @Res({ passthrough: true }) response: Response) { const result = await this.auth.login(body.email, body.password); response.cookie("maqar_admin_session", result.token, this.cookieOptions()); return { admin: result.admin }; }
  @Post("logout") logout(@Res({ passthrough: true }) response: Response) { response.clearCookie("maqar_admin_session", this.cookieOptions()); return { loggedOut: true }; }
  @UseGuards(AdminAuthGuard) @Get("me") me(@Req() request: Request & { admin: unknown }) { return request.admin; }
}
