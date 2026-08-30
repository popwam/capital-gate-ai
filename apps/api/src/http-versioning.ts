import { INestApplication, RequestMethod } from "@nestjs/common";

const unprefixedV2Routes = [
  { path: "v2/nadim/turn", method: RequestMethod.POST },
  { path: "v2/internal/conversations/human-activity", method: RequestMethod.POST },
  { path: "v2/internal/conversations/release-stale-human", method: RequestMethod.POST },
  { path: "v2/internal/followups/claim-due", method: RequestMethod.POST },
  { path: "v2/internal/followups/:id/sent", method: RequestMethod.POST },
  { path: "v2/internal/followups/:id/failed", method: RequestMethod.POST },
  { path: "v2/internal/conversations/:id/tokens", method: RequestMethod.POST },
  { path: "v2/internal/conversation-tokens/consume", method: RequestMethod.POST },
  { path: "v2/internal/conversations/:conversationId/tokens/:id/revoke", method: RequestMethod.POST },
] as const;

export function applyHttpVersioning(app: INestApplication) {
  app.setGlobalPrefix("v1", { exclude: [...unprefixedV2Routes] });
}
