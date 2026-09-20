/**
 * Regression coverage for `getPushProvider()`'s provider resolution.
 *
 * No database, no network: `FcmPushProvider`'s constructor only calls
 * `firebase-admin/app`'s `initializeApp`/`cert`, which does not contact
 * Google until a message is actually sent.
 */
import { generateKeyPairSync } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
  getPushProvider,
  isPushConfigured,
  resetPushProviderCache,
} from "./push-provider.factory";

// A syntactically real PKCS8 PEM, so `firebase-admin`'s credential parsing
// has something valid to parse. Its cryptographic validity past that point is
// irrelevant — nothing here ever calls `.send()`, so the key is never used to
// sign anything.
const FAKE_PRIVATE_KEY = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;

function setFirebaseEnv(): void {
  process.env.FIREBASE_PROJECT_ID = "kizunia-test-project";
  process.env.FIREBASE_CLIENT_EMAIL =
    "test@kizunia-test-project.iam.gserviceaccount.com";
  // Mirrors how the real value survives an environment variable: newlines
  // escaped as `\n`, unescaped by `readFirebaseConfig()` at load.
  process.env.FIREBASE_PRIVATE_KEY = FAKE_PRIVATE_KEY.replace(/\n/g, "\\n");
}

function clearFirebaseEnv(): void {
  delete process.env.FIREBASE_PROJECT_ID;
  delete process.env.FIREBASE_CLIENT_EMAIL;
  delete process.env.FIREBASE_PRIVATE_KEY;
}

describe("getPushProvider", () => {
  afterEach(() => {
    clearFirebaseEnv();
    resetPushProviderCache();
  });

  it("falls back to the fake provider when Firebase credentials are absent", async () => {
    clearFirebaseEnv();
    resetPushProviderCache();

    expect(isPushConfigured()).toBe(false);

    const provider = await getPushProvider();

    expect(provider.id).toBe("FAKE");
    expect(provider.canDeliver).toBe(false);
  });

  it("resolves a real, constructible FcmPushProvider when credentials are present", async () => {
    // Regression test. `getPushProvider()` used to load `fcm-push-provider.ts`
    // with a lazy `require()`. Under Next.js's server runtime that file is
    // part of the same ESM graph, and `require()`-ing it returned the module
    // record rather than unwrapping the named export — `new FcmPushProvider(...)`
    // threw `TypeError: FcmPushProvider is not a constructor`. The delivery
    // handler caught nothing (the throw happened building the `deliver()`
    // input, before `DeliveryService` ever runs), so the job just retried and
    // eventually exhausted its attempts — every push, for every intent,
    // silently failed this way while every in-app delivery kept working. An
    // `import()` does not have this failure mode; if it regresses, this
    // assertion throws the same `TypeError` this test exists to catch.
    setFirebaseEnv();
    resetPushProviderCache();

    expect(isPushConfigured()).toBe(true);

    const provider = await getPushProvider();

    expect(provider.id).toBe("FCM");
    expect(provider.canDeliver).toBe(true);
    expect(typeof provider.send).toBe("function");
  });

  it("caches the resolved provider across calls", async () => {
    setFirebaseEnv();
    resetPushProviderCache();

    const first = await getPushProvider();
    const second = await getPushProvider();

    expect(first).toBe(second);
  });
});
