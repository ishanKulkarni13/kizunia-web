import { HttpClient } from "@/lib/http/client";

// Type-only import from `backend/`: it erases at compile time, so no server
// code reaches the browser bundle.
import type { MyEntitlementsDTO } from "../backend/entitlements.service";

/**
 * The signed-in user's server-computed capability and quota flags. The UI
 * renders these; it never derives access from a plan name itself.
 *
 * For app-layer pages. Feature modules never import billing — they read
 * their own server flags (e.g. the projects ownership allowance).
 */
export class EntitlementsApi {
  static async getMine(): Promise<MyEntitlementsDTO> {
    const response = await HttpClient.get<MyEntitlementsDTO>("/api/v1/me/entitlements");

    return response.data;
  }
}
