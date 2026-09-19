import { ErrorHandler } from "@/lib/errors";
import { rateLimitHeaders } from "@/lib/rate-limit/headers";
import {
    getRateLimitDecision,
    runWithRateLimitContext,
} from "@/lib/rate-limit/response-context";

import { NextResponse } from "next/server";

export class Route {
    static async execute(
        handler: () => Promise<NextResponse>,
    ): Promise<NextResponse> {
        try {
            return await runWithRateLimitContext(async () => {
                const response = await handler();

                // If a rate-limit check ran anywhere during this request and
                // allowed it, surface the standard RateLimit-* headers on the
                // success response too — so a well-behaved API consumer can
                // throttle itself before ever hitting a 429. The rejection
                // path does not go through here: ErrorHandler attaches the
                // same headers (plus Retry-After) directly from the thrown
                // RateLimitError, independent of this context.
                const decision = getRateLimitDecision();

                if (decision) {
                    for (const [name, value] of Object.entries(
                        rateLimitHeaders(decision),
                    )) {
                        response.headers.set(name, value);
                    }
                }

                return response;
            });
        } catch (error) {
            return ErrorHandler.handle(error);
        }
    }
}
