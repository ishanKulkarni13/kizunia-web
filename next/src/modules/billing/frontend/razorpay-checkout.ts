"use client";

import type { RazorpayCheckoutResponse } from "../api/billing-api";

/**
 * Razorpay Checkout (`checkout.js`) in the browser: the only Razorpay code
 * that runs client-side. It is loaded on demand from Razorpay's CDN and opened
 * with the `keyId` and subscription the server returned for this checkout —
 * there is no `NEXT_PUBLIC_RAZORPAY_*`, so the TEST/LIVE seam stays on the
 * server. Nothing it reports is trusted: the server verifies the signature
 * against its own record and an authoritative fetch decides access.
 */
export const RAZORPAY_CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

interface RazorpayCheckoutOptions {
  key: string;
  subscription_id: string;
  name: string;
  description: string;
  handler: (response: RazorpayCheckoutResponse) => void;
  modal?: { ondismiss?: () => void };
  theme?: { color?: string };
}

interface RazorpayCheckoutInstance {
  open(): void;
  on(event: "payment.failed", callback: (response: unknown) => void): void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayCheckoutInstance;
  }
}

let loading: Promise<void> | null = null;

/** Loads `checkout.js` once. Rejects if it cannot be loaded (blocked, offline). */
export function loadRazorpayCheckout(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("Checkout runs in the browser only."));
  if (window.Razorpay) return Promise.resolve();

  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");

    script.src = RAZORPAY_CHECKOUT_SRC;
    script.async = true;
    script.onload = () => (window.Razorpay ? resolve() : reject(new Error("Checkout did not initialize.")));
    script.onerror = () => {
      loading = null;
      reject(new Error("Checkout could not be loaded."));
    };
    document.body.appendChild(script);
  });

  return loading;
}

export interface OpenCheckoutInput {
  readonly keyId: string;
  readonly subscriptionId: string;
  readonly description: string;
  readonly onAuthorized: (response: RazorpayCheckoutResponse) => void;
  readonly onClosed: () => void;
}

export async function openRazorpayCheckout(input: OpenCheckoutInput): Promise<void> {
  await loadRazorpayCheckout();

  const Razorpay = window.Razorpay!;
  const checkout = new Razorpay({
    key: input.keyId,
    subscription_id: input.subscriptionId,
    name: "Kizunia",
    description: input.description,
    handler: input.onAuthorized,
    modal: { ondismiss: input.onClosed },
  });

  checkout.open();
}
