"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { CreditPack } from "@/types";

declare global {
  interface Window {
    Razorpay: any;
  }
}

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export function RazorpayButton({ pack, label }: { pack: CreditPack; label: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePay() {
    setLoading(true);
    setError(null);

    try {
      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded) throw new Error("Razorpay SDK failed to load. Check your connection.");

      const res = await fetch("/api/credits/razorpay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 401) throw new Error("Your session expired — please sign in again.");
        if (res.status === 429) throw new Error("Too many requests — please wait a moment.");
        throw new Error(body.error || "Couldn't start checkout.");
      }

      const order = await res.json();

      const rzp = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: "StudioGen AI",
        description: `${pack} credit pack`,
        // Signature verification + crediting the account happens server-side
        // in /api/webhooks/razorpay once Razorpay confirms payment.captured.
        handler: function () {
          window.location.href = "/dashboard?checkout=success";
        },
      });

      // The Checkout modal itself can also fail/be dismissed with an error —
      // surface that instead of leaving the button silently reset.
      rzp.on("payment.failed", (response: any) => {
        setError(response?.error?.description || "Payment failed. Please try again.");
      });

      rzp.open();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" size="sm" onClick={handlePay} disabled={loading}>
        {loading ? "Loading…" : label}
      </Button>
      {error && <p className="max-w-[10rem] text-right text-xs text-red-600">{error}</p>}
    </div>
  );
}
