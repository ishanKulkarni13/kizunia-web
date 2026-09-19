import type { AuthorizationActor } from "@/authorization";

import type { PortfolioAuthorizationEntity } from "../repository";

export interface PortfolioContext {
  actor: AuthorizationActor;

  portfolio: PortfolioAuthorizationEntity | null;

  isOwner: boolean;
}