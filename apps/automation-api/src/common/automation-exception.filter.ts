import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import type { Response } from "express";
import { AutomationError } from "./automation-error";

@Catch()
export class AutomationExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AutomationError) {
      if (exception.status >= 500) {
        console.error(
          `AutomationRequestFailure status=${exception.status} code=${exception.code}`,
        );
      }

      return response.status(exception.status).json({
        ok: false,
        action: "LEAD_UPSERT",
        error: {
          code: exception.code,
          message:
            exception.status >= 500
              ? "An unexpected error occurred"
              : exception.message,
        },
      });
    }

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const raw =
      exception instanceof HttpException
        ? exception.getResponse()
        : undefined;

    const body =
      raw && typeof raw === "object"
        ? (raw as Record<string, unknown>)
        : {};

    if (body.ok === false) {
      return response.status(status).json(body);
    }

    const nested =
      body.error && typeof body.error === "object"
        ? (body.error as Record<string, unknown>)
        : undefined;

    const code =
      typeof body.code === "string"
        ? body.code
        : typeof nested?.code === "string"
          ? nested.code
          : status === 500
            ? "INTERNAL_ERROR"
            : "REQUEST_INVALID";

    const rawMessage = body.message;

    const message =
      status >= 500
        ? "An unexpected error occurred"
        : Array.isArray(rawMessage)
          ? String(rawMessage[0])
          : typeof rawMessage === "string"
            ? rawMessage
            : "Request failed";

    if (status >= 500) {
      console.error(
        `AutomationRequestFailure status=${status} code=${code}`,
      );
    }

    return response.status(status).json({
      ok: false,
      action: "LEAD_UPSERT",
      error: {
        code,
        message,
      },
    });
  }
} 