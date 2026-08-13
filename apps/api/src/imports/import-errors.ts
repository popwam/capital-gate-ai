import { HttpException, HttpStatus } from "@nestjs/common";

export type ImportErrorCode =
  | "IMPORT_FILE_REQUIRED"
  | "IMPORT_FILE_TOO_LARGE"
  | "IMPORT_UNSUPPORTED_FILE_TYPE"
  | "IMPORT_SIGNATURE_MISMATCH"
  | "IMPORT_PARSE_FAILED"
  | "IMPORT_NO_USABLE_SHEETS"
  | "IMPORT_ROW_LIMIT_EXCEEDED"
  | "IMPORT_VALIDATION_ISSUES"
  | "IMPORT_STORAGE_AUTH_FAILED"
  | "IMPORT_STORAGE_BUCKET_FAILED"
  | "IMPORT_STORAGE_NETWORK_FAILED"
  | "IMPORT_STORAGE_FAILED"
  | "IMPORT_DATABASE_FAILED"
  | "IMPORT_PREVIEW_FAILED"
  | "IMPORT_CONFIRM_FAILED";

export class ImportHttpException extends HttpException {
  constructor(
    status: HttpStatus,
    code: ImportErrorCode,
    message: string,
    stage: string,
    importId?: string,
  ) {
    super({ code, message, stage, importId, safe: true }, status);
  }
}

export function importErrorDetails(error: unknown) {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (response && typeof response === "object")
      return response as Record<string, unknown>;
  }
  return {};
}
