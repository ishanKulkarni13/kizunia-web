import { describe, expect, it } from "vitest";

import { classifyHttpFailure } from "./classification";

function errorBody(code: string, description = "some description") {
  return { error: { code, description, source: "business", step: "x", reason: "y", metadata: {} } };
}

describe("classifyHttpFailure — by HTTP status", () => {
  const cases: Array<[number, string]> = [
    [401, "AUTH_FAILURE"],
    [403, "AUTH_FAILURE"],
    [404, "NOT_FOUND"],
    [429, "RATE_LIMITED"],
    [408, "TIMEOUT"],
    [500, "UNAVAILABLE"],
    [502, "UNAVAILABLE"],
    [503, "UNAVAILABLE"],
    [504, "UNAVAILABLE"],
    [599, "UNAVAILABLE"],
    [400, "REJECTED"],
    [402, "REJECTED"],
    [409, "REJECTED"],
    [422, "REJECTED"],
    [499, "REJECTED"],
    [100, "MALFORMED"],
    [301, "MALFORMED"],
    [304, "MALFORMED"],
  ];

  it.each(cases)("HTTP %i with no body is %s", (status, expected) => {
    expect(classifyHttpFailure(status, undefined).failureClass).toBe(expected);
  });

  it("does not need a parseable body to classify by status", () => {
    expect(classifyHttpFailure(503, "<html>Bad gateway</html>").failureClass).toBe("UNAVAILABLE");
    expect(classifyHttpFailure(400, null).failureClass).toBe("REJECTED");
    expect(classifyHttpFailure(429, 42).failureClass).toBe("RATE_LIMITED");
  });
});

describe("classifyHttpFailure — by provider error code", () => {
  it("classifies a 400 BAD_REQUEST_ERROR as REJECTED", () => {
    expect(classifyHttpFailure(400, errorBody("BAD_REQUEST_ERROR")).failureClass).toBe("REJECTED");
  });

  it("classifies SERVER_ERROR and GATEWAY_ERROR as UNAVAILABLE even on a 4xx status", () => {
    expect(classifyHttpFailure(400, errorBody("SERVER_ERROR")).failureClass).toBe("UNAVAILABLE");
    expect(classifyHttpFailure(400, errorBody("GATEWAY_ERROR")).failureClass).toBe("UNAVAILABLE");
    expect(classifyHttpFailure(500, errorBody("SERVER_ERROR")).failureClass).toBe("UNAVAILABLE");
  });

  it("lets the status decide when the code is one it does not know", () => {
    expect(classifyHttpFailure(400, errorBody("SOMETHING_NEW")).failureClass).toBe("REJECTED");
    expect(classifyHttpFailure(404, errorBody("SOMETHING_NEW")).failureClass).toBe("NOT_FOUND");
  });

  it("does not let a code override an auth, not-found or rate-limit status", () => {
    expect(classifyHttpFailure(401, errorBody("BAD_REQUEST_ERROR")).failureClass).toBe("AUTH_FAILURE");
    expect(classifyHttpFailure(429, errorBody("BAD_REQUEST_ERROR")).failureClass).toBe("RATE_LIMITED");
  });

  it("keeps the code and description for diagnosis", () => {
    const failure = classifyHttpFailure(400, errorBody("BAD_REQUEST_ERROR", "The id provided does not exist"));

    expect(failure.providerErrorCode).toBe("BAD_REQUEST_ERROR");
    expect(failure.providerErrorDescription).toBe("The id provided does not exist");
  });

  it("omits code and description when the body has none", () => {
    expect(classifyHttpFailure(400, {})).toEqual({ failureClass: "REJECTED" });
    expect(classifyHttpFailure(400, { error: "text, not an object" })).toEqual({ failureClass: "REJECTED" });
  });

  it("bounds a very long description", () => {
    const failure = classifyHttpFailure(400, errorBody("BAD_REQUEST_ERROR", "x".repeat(5_000)));

    expect(failure.providerErrorDescription).toHaveLength(500);
  });
});

describe("classifyHttpFailure — description text is never matched, except CONCURRENT_OPERATION", () => {
  // These descriptions are the refusals the contract observed (D8, D10). None
  // of them may change the class: they are all plain REJECTED.
  const observedRefusals = [
    "Can't update subscription immediately when card mandate is applicable",
    "Only offers can be updated for subscriptions when payment mode is domestic card.",
    "Can't update subscription when subscription is not in Authenticated or Active state",
    "Subscription is not cancellable in expired status.",
    "No Pending update for this subscription",
    "Link expire by cannot be lesser than the current time.",
    "Exceeds the maximum total_count (100) allowed for the given period and interval",
  ];

  it.each(observedRefusals)("keeps %j as REJECTED", (description) => {
    expect(classifyHttpFailure(400, errorBody("BAD_REQUEST_ERROR", description)).failureClass).toBe("REJECTED");
  });

  it("does not reclassify a description that merely sounds transient", () => {
    // Wording like this must never turn a refusal into a retry.
    for (const description of ["Please try again later", "Server is busy", "rate limit exceeded", "timeout"]) {
      expect(classifyHttpFailure(400, errorBody("BAD_REQUEST_ERROR", description)).failureClass).toBe("REJECTED");
    }
  });

  it("recognizes another operation in progress, as the one documented exception", () => {
    for (const description of [
      "Another subscription operation is in progress",
      "another subscription operation is in progress.",
      "Another operation is in progress for this subscription",
    ]) {
      expect(classifyHttpFailure(400, errorBody("BAD_REQUEST_ERROR", description)).failureClass).toBe(
        "CONCURRENT_OPERATION",
      );
    }
  });

  it("applies the exception only to a refusal, never to another status", () => {
    const text = "Another subscription operation is in progress";

    expect(classifyHttpFailure(404, errorBody("BAD_REQUEST_ERROR", text)).failureClass).toBe("NOT_FOUND");
    expect(classifyHttpFailure(429, errorBody("BAD_REQUEST_ERROR", text)).failureClass).toBe("RATE_LIMITED");
    expect(classifyHttpFailure(503, errorBody("SERVER_ERROR", text)).failureClass).toBe("UNAVAILABLE");
  });
});

// Bodies observed from the real Razorpay TEST API by the contract suite
// (2026-09-25). They pin what actually happens, which in two places differs from
// what the design first assumed.
describe("classifyHttpFailure — real responses observed against Razorpay TEST", () => {
  it("classifies an unknown subscription id as REJECTED: a 400, not the 404 the design expected", () => {
    const body = { error: { code: "BAD_REQUEST_ERROR", description: "The ID provided is invalid or could not be found." } };

    expect(classifyHttpFailure(400, body)).toMatchObject({
      failureClass: "REJECTED",
      providerErrorCode: "BAD_REQUEST_ERROR",
    });
  });

  it("classifies an unknown payment id as REJECTED", () => {
    const body = {
      error: {
        code: "BAD_REQUEST_ERROR",
        description: "The id provided does not exist",
        source: "internal",
        step: "payment_initiation",
        reason: "input_validation_failed",
        metadata: {},
      },
    };

    expect(classifyHttpFailure(400, body).failureClass).toBe("REJECTED");
  });

  it("classifies a bad key as AUTH_FAILURE although its body also says BAD_REQUEST_ERROR: status decides first", () => {
    const body = { error: { code: "BAD_REQUEST_ERROR", description: "Authentication failed" } };

    expect(classifyHttpFailure(401, body).failureClass).toBe("AUTH_FAILURE");
  });

  it("classifies a gateway routing miss (a malformed id) as NOT_FOUND, though it has no error envelope", () => {
    // The only case in which a 404 is seen: a wrong-length id never reaches a handler.
    const failure = classifyHttpFailure(404, { message: "no Route matched with those values" });

    expect(failure.failureClass).toBe("NOT_FOUND");
    expect(failure).not.toHaveProperty("providerErrorCode");
  });

  it("keeps every business refusal observed on a created subscription as REJECTED", () => {
    for (const description of [
      "Subscription cannot be cancelled since no billing cycle is going on",
      "Subscription is not cancellable in cancelled status.",
      "Can't update subscription when subscription is not in Authenticated or Active state",
      "No Pending update for this subscription",
      "Link expire by cannot be lesser than the current time.",
      "Exceeds the maximum total_count (1200) allowed for the given period and interval",
    ]) {
      expect(classifyHttpFailure(400, errorBody("BAD_REQUEST_ERROR", description)).failureClass, description).toBe(
        "REJECTED",
      );
    }
  });
});
