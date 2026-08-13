import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import type { Request, Response } from "express";

@Catch()
export class SafeHttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>(); const request = host.switchToHttp().getRequest<Request & { requestId?: string }>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const detail = exception instanceof HttpException ? exception.getResponse() : null;
    const message = status >= 500 ? "An unexpected error occurred" : typeof detail === "string" ? detail : (detail as any)?.message ?? "Request failed";
    if (status >= 500) console.error(`[${request.requestId}]`, exception);
    response.status(status).json({ statusCode: status, message, requestId: request.requestId, path: request.originalUrl, timestamp: new Date().toISOString() });
  }
}
