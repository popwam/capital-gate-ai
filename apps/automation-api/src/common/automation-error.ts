import { HttpStatus } from "@nestjs/common";

export class AutomationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = HttpStatus.BAD_REQUEST,
  ) {
    super(message);
  }
}

export function statusForCode(code: string) {
  if (["CUSTOMER_NOT_FOUND", "LEAD_NOT_FOUND", "CONVERSATION_NOT_FOUND"].includes(code)) return HttpStatus.NOT_FOUND;
  if (["CUSTOMER_IDENTITY_CONFLICT", "LEAD_CUSTOMER_CONFLICT", "IDEMPOTENCY_CONFLICT", "ACTION_IN_PROGRESS"].includes(code)) return HttpStatus.CONFLICT;
  if (code === "INTERNAL_ERROR") return HttpStatus.INTERNAL_SERVER_ERROR;
  return HttpStatus.BAD_REQUEST;
}
