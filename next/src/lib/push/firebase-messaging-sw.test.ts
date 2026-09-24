/**
 * The push service worker's click lifecycle.
 *
 * `public/firebase-messaging-sw.js` is a plain script — no bundler, no exports,
 * no imports — so it cannot be imported. It is loaded here, unmodified, into a
 * `node:vm` context with the handful of service-worker globals it touches
 * replaced by fakes. What is under test is the file that ships.
 *
 * What cannot be tested here is a real browser and real FCM. See
 * docs/architecture/notifications/DEVELOPER-TESTING.md for the manual part.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGIN = "https://kizunia.test";
const SW_SOURCE = readFileSync(
  path.join(process.cwd(), "public", "firebase-messaging-sw.js"),
  "utf8",
);

type Listener = (event: unknown) => void;

interface FakeClient {
  url: string;
  focus: ReturnType<typeof vi.fn>;
  navigate?: ReturnType<typeof vi.fn>;
}

interface Harness {
  showNotification: ReturnType<typeof vi.fn>;
  fetchMock: ReturnType<typeof vi.fn>;
  openWindow: ReturnType<typeof vi.fn>;
  setClients: (clients: FakeClient[]) => void;
  push: (payload: unknown) => void;
  click: (data: unknown) => Promise<{ close: ReturnType<typeof vi.fn> }>;
}

function client(url: string, options: { navigable?: boolean } = {}): FakeClient {
  const focused = { focus: vi.fn() };
  const fake: FakeClient = { url, focus: vi.fn().mockResolvedValue(undefined) };

  // Absent rather than undefined: the worker feature-detects with `in`.
  if (options.navigable !== false) {
    fake.navigate = vi.fn().mockResolvedValue(focused);
  }

  return fake;
}

function loadWorker(fetchImpl: (...args: unknown[]) => Promise<unknown>): Harness {
  const listeners = new Map<string, Listener>();
  let backgroundHandler: ((payload: unknown) => void) | null = null;
  let clientList: FakeClient[] = [];

  const showNotification = vi.fn();
  const fetchMock = vi.fn(fetchImpl);
  const openWindow = vi.fn().mockResolvedValue(undefined);

  const self: Record<string, unknown> = {
    location: new URL(
      `${ORIGIN}/firebase-messaging-sw.js?apiKey=k&authDomain=d&projectId=p&messagingSenderId=s&appId=a`,
    ),
    registration: { showNotification },
    clients: {
      matchAll: vi.fn(async () => clientList),
      openWindow,
      claim: vi.fn(),
    },
    addEventListener: (type: string, listener: Listener) => {
      listeners.set(type, listener);
    },
    skipWaiting: vi.fn(),
  };

  const sandbox = {
    self,
    importScripts: vi.fn(),
    firebase: {
      initializeApp: vi.fn(),
      messaging: () => ({
        onBackgroundMessage: (handler: (payload: unknown) => void) => {
          backgroundHandler = handler;
        },
      }),
    },
    fetch: fetchMock,
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    Promise,
    encodeURIComponent,
  };

  vm.runInNewContext(SW_SOURCE, sandbox);

  return {
    showNotification,
    fetchMock,
    openWindow,
    setClients: (clients) => {
      clientList = clients;
    },
    push: (payload) => {
      if (!backgroundHandler) throw new Error("no background handler registered");
      backgroundHandler(payload);
    },
    click: async (data) => {
      const close = vi.fn();
      const pending: Promise<unknown>[] = [];

      listeners.get("notificationclick")?.({
        notification: { close, data },
        waitUntil: (promise: Promise<unknown>) => pending.push(promise),
      });

      await Promise.all(pending);
      return { close };
    },
  };
}

const ok = () => Promise.resolve({ ok: true, status: 200 });

/** The `data` a notification was shown with, as `notificationclick` will see it. */
function shownData(harness: Harness) {
  return harness.showNotification.mock.calls[0]?.[1]?.data;
}

describe("push payload → browser notification", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = loadWorker(ok);
  });

  it("keeps the exact notification id and the link in the notification's click data", () => {
    harness.push({
      notification: { title: "Top pick", body: "Body" },
      data: { notificationId: "cmabc123", intent: "TOP_RELEVANT_COMPETITION" },
      fcmOptions: { link: "/competitions/robo-race" },
    });

    expect(harness.showNotification).toHaveBeenCalledTimes(1);
    expect(shownData(harness)).toEqual({
      notificationId: "cmabc123",
      link: "/competitions/robo-race",
    });
    // Still the collapse identity, so a duplicate push replaces the banner.
    expect(harness.showNotification.mock.calls[0]?.[1]?.tag).toBe("cmabc123");
  });

  it("records a missing link as null rather than inventing one", () => {
    harness.push({
      notification: { title: "Announcement", body: "" },
      data: { notificationId: "cmabc123" },
    });

    expect(shownData(harness)).toEqual({
      notificationId: "cmabc123",
      link: null,
    });
  });

  it("records a missing id as null and falls back to the payload's own tag", () => {
    harness.push({
      notification: { title: "t", body: "b", tag: "provider-tag" },
      data: {},
      fcmOptions: { link: "/competitions/x" },
    });

    expect(shownData(harness).notificationId).toBeNull();
    expect(harness.showNotification.mock.calls[0]?.[1]?.tag).toBe("provider-tag");
  });
});

describe("notificationclick → acknowledgement", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = loadWorker(ok);
    harness.setClients([]);
  });

  it("marks exactly that notification responded, and closes the banner", async () => {
    const { close } = await harness.click({
      notificationId: "cmabc123",
      link: "/competitions/robo-race",
    });

    expect(close).toHaveBeenCalledTimes(1);
    expect(harness.fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = harness.fetchMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(url).toBe("/api/v1/me/notifications/cmabc123/responded");
    expect(init.method).toBe("PATCH");
    // The session cookie is the only credential. Nothing here names a user.
    expect(init.credentials).toBe("same-origin");
    expect(init.body).toBe("{}");
    expect(JSON.stringify(init)).not.toMatch(/user/i);
  });

  it("marks a notification with no action of its own read, not responded", async () => {
    await harness.click({ notificationId: "cmabc123", link: null });

    expect(harness.fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/me/notifications/cmabc123/read",
    );
  });

  // The worker is deliberately unaware of intents; this pins that down. Every
  // producer's notification is just an id and a link.
  it.each([
    ["TOP_RELEVANT_COMPETITION", "/competitions/robo-race"],
    ["REGISTRATION_CLOSING", "/competitions/hack-night"],
    ["ADMIN_COMPETITION_SUGGESTION", "/admin/competition-suggestions/cmsug1"],
    ["FEATURE_ANNOUNCEMENT", "/user/notification-preferences"],
  ])("acknowledges a %s push identically", async (intent, link) => {
    harness.push({
      notification: { title: "t", body: "b" },
      data: { notificationId: "cmabc123", intent },
      fcmOptions: { link },
    });

    await harness.click(shownData(harness));

    expect(harness.fetchMock).toHaveBeenCalledTimes(1);
    expect(harness.fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/me/notifications/cmabc123/responded",
    );
    expect(harness.openWindow).toHaveBeenCalledWith(`${ORIGIN}${link}`);
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["empty", ""],
    ["a path traversal", "../../admin"],
    ["containing a slash", "a/b"],
    ["containing a query", "a?b=1"],
    ["not a string", 42],
    ["over-long", "a".repeat(200)],
  ])("sends no request for a %s id, and still navigates", async (_label, id) => {
    await harness.click({ notificationId: id, link: "/competitions/robo-race" });

    expect(harness.fetchMock).not.toHaveBeenCalled();
    expect(harness.openWindow).toHaveBeenCalledWith(
      `${ORIGIN}/competitions/robo-race`,
    );
  });

  it("tolerates a notification shown by an older worker, which carried only a link", async () => {
    await harness.click({ link: "/competitions/robo-race" });

    expect(harness.fetchMock).not.toHaveBeenCalled();
    expect(harness.openWindow).toHaveBeenCalledWith(
      `${ORIGIN}/competitions/robo-race`,
    );
  });

  it("tolerates a notification with no data at all", async () => {
    await harness.click(undefined);

    expect(harness.fetchMock).not.toHaveBeenCalled();
    expect(harness.openWindow).toHaveBeenCalledWith(`${ORIGIN}/user/notifications`);
  });

  it("sends a request per click and leaves de-duplication to the idempotent endpoint", async () => {
    const data = { notificationId: "cmabc123", link: "/competitions/robo-race" };

    await harness.click(data);
    await harness.click(data);

    expect(harness.fetchMock).toHaveBeenCalledTimes(2);
    expect(harness.fetchMock.mock.calls[1]?.[0]).toBe(
      harness.fetchMock.mock.calls[0]?.[0],
    );
  });
});

describe("notificationclick → failure isolation", () => {
  const data = { notificationId: "cmabc123", link: "/competitions/robo-race" };
  const target = `${ORIGIN}/competitions/robo-race`;

  it("still navigates when the request rejects (offline)", async () => {
    const harness = loadWorker(() => Promise.reject(new TypeError("Failed to fetch")));
    harness.setClients([]);

    await expect(harness.click(data)).resolves.toBeDefined();

    expect(harness.openWindow).toHaveBeenCalledWith(target);
  });

  it("still navigates when the server refuses (expired session, 401)", async () => {
    const harness = loadWorker(() =>
      Promise.resolve({ ok: false, status: 401 }),
    );
    harness.setClients([]);

    await harness.click(data);

    expect(harness.openWindow).toHaveBeenCalledWith(target);
  });

  it("still navigates when fetch throws synchronously", async () => {
    const harness = loadWorker(() => {
      throw new Error("boom");
    });
    harness.setClients([]);

    await harness.click(data);

    expect(harness.openWindow).toHaveBeenCalledWith(target);
  });

  describe("a request that never answers", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("does not hold navigation back, and gives up after its timeout", async () => {
      const harness = loadWorker(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            (init as { signal: AbortSignal }).signal.addEventListener("abort", () =>
              reject(new Error("aborted")),
            );
          }),
      );
      harness.setClients([]);

      let settled = false;
      const clicked = harness.click(data).then(() => {
        settled = true;
      });

      // Navigation has already happened while the request is still hanging.
      await vi.advanceTimersByTimeAsync(0);
      expect(harness.openWindow).toHaveBeenCalledWith(target);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(8000);
      await clicked;
      expect(settled).toBe(true);
    });
  });
});

describe("notificationclick → navigation", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = loadWorker(ok);
  });

  const data = { notificationId: "cmabc123", link: "/competitions/robo-race" };
  const target = `${ORIGIN}/competitions/robo-race`;

  it("focuses a tab that is already on the target", async () => {
    const onTarget = client(target);
    const other = client(`${ORIGIN}/competitions`);
    harness.setClients([other, onTarget]);

    await harness.click(data);

    expect(onTarget.focus).toHaveBeenCalledTimes(1);
    expect(other.navigate).not.toHaveBeenCalled();
    expect(harness.openWindow).not.toHaveBeenCalled();
  });

  it("navigates an existing Kizunia tab when none is on the target", async () => {
    const existing = client(`${ORIGIN}/competitions`);
    harness.setClients([existing]);

    await harness.click(data);

    expect(existing.navigate).toHaveBeenCalledWith(target);
    expect(harness.openWindow).not.toHaveBeenCalled();
  });

  it("opens a window when there is no tab it can use", async () => {
    harness.setClients([client(`${ORIGIN}/x`, { navigable: false })]);

    await harness.click(data);

    expect(harness.openWindow).toHaveBeenCalledWith(target);
  });

  it("opens the inbox when the notification carries no action", async () => {
    harness.setClients([]);

    await harness.click({ notificationId: "cmabc123", link: null });

    expect(harness.openWindow).toHaveBeenCalledWith(`${ORIGIN}/user/notifications`);
  });

  it.each([
    ["an absolute off-site URL", "https://evil.example/phish"],
    ["a protocol-relative URL", "//evil.example/phish"],
    ["a javascript: URL", "javascript:alert(1)"],
  ])("refuses %s and opens the inbox instead", async (_label, link) => {
    harness.setClients([]);

    await harness.click({ notificationId: "cmabc123", link });

    expect(harness.openWindow).toHaveBeenCalledTimes(1);
    expect(harness.openWindow).toHaveBeenCalledWith(`${ORIGIN}/user/notifications`);
  });

  it("accepts an absolute URL on its own origin", async () => {
    harness.setClients([]);

    await harness.click({ notificationId: "cmabc123", link: target });

    expect(harness.openWindow).toHaveBeenCalledWith(target);
  });
});
