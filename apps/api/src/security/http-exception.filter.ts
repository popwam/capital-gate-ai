import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Request, Response } from "express";

type ErrorBody = {
  code?: string;
  message?: string | string[];
  safe?: boolean;
  stage?: string;
  importId?: string;
};

function multerError(exception: unknown) {
  const code = (exception as { code?: unknown })?.code;
  if (code === "LIMIT_FILE_SIZE")
    return {
      status: HttpStatus.PAYLOAD_TOO_LARGE,
      body: {
        code: "IMPORT_FILE_TOO_LARGE",
        message: "The file exceeds the 20 MB upload limit.",
        safe: true,
        stage: "multipart",
      } satisfies ErrorBody,
    };
  if (code === "LIMIT_UNEXPECTED_FILE" || code === "LIMIT_FILE_COUNT")
    return {
      status: HttpStatus.BAD_REQUEST,
      body: {
        code: "IMPORT_MULTIPART_INVALID",
        message: "Upload one inventory file using the file field.",
        safe: true,
        stage: "multipart",
      } satisfies ErrorBody,
    };
  return undefined;
}

function safeLogText(value: unknown) {
  const text = value instanceof Error ? value.message : String(value ?? "");
  return text
    .replace(/([?&]key=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(authorization|cookie|secret|password)(["':=\s]+)[^,\s}]+/gi, "$1$2[REDACTED]")
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[DATABASE_URL_REDACTED]")
    .slice(0, 500);
}

@Catch()
export class SafeHttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host
      .switchToHttp()
      .getRequest<Request & { requestId?: string }>();
    const multer = multerError(exception);
    const status = multer
      ? multer.status
      : exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const rawDetail = multer
      ? multer.body
      : exception instanceof HttpException
        ? exception.getResponse()
        : null;
    const detail: ErrorBody =
      typeof rawDetail === "string"
        ? { message: rawDetail }
        : rawDetail && typeof rawDetail === "object"
          ? (rawDetail as ErrorBody)
          : {};
    const safeServerMessage = status < 500 || detail.safe === true;
    const rawMessage = Array.isArray(detail.message)
      ? detail.message[0]
      : detail.message;
    const message =
      status === HttpStatus.PAYLOAD_TOO_LARGE
        ? "The file exceeds the 20 MB upload limit."
        : safeServerMessage
          ? rawMessage || "Request failed"
          : "An unexpected error occurred.";
    const code =
      detail.code ||
      (status === HttpStatus.PAYLOAD_TOO_LARGE
        ? "IMPORT_FILE_TOO_LARGE"
        : status === 401
        ? "UNAUTHENTICATED"
        : status === 403
          ? "FORBIDDEN"
          : status >= 500
            ? "INTERNAL_ERROR"
            : "REQUEST_FAILED");

    if (status >= 500) {
      console.error(
        `RequestFailure requestId=${request.requestId ?? "unknown"} method=${request.method} path=${request.originalUrl} status=${status} code=${code} error=${JSON.stringify(safeLogText(exception))}`,
      );
    }
    response.status(status).json({
      statusCode: status,
      code,
      message,
      requestId: request.requestId,
      path: request.originalUrl,
      timestamp: new Date().toISOString(),
      ...(detail.stage ? { stage: detail.stage } : {}),
      ...(detail.importId ? { importId: detail.importId } : {}),
    });
  }
}
