"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RazorpayButton } from "@/components/razorpay-button";
import { CREDIT_PACKS, SUBSCRIPTION_PLANS } from "@/lib/credits";
import type { CreditPack, SubscriptionPlan } from "@/types";

function friendlyCheckoutError(status: number, body: any): string {
  if (status === 401) return "Your session expired — please sign in again.";
  if (status === 429) return "Too many requests — please wait a moment.";
  return body?.error || "Couldn't start checkout. Please try again.";
}

export function UpgradeDialog({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [redirecting, setRedirecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout(endpoint: string, body: Record<string, string>, key: string) {
    setRedirecting(key);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), // identity comes from the session cookie server-side
      });

      if (!res.ok) {
        const respBody = await res.json().catch(() => ({}));
        setError(friendlyCheckoutError(res.status, respBody));
        return;
      }

      const { checkoutUrl } = await res.json();
      window.location.href = checkoutUrl;
    } catch (err) {
      console.error(err);
      setError("Couldn't start checkout. Please try again.");
    } finally {
      setRedirecting(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>You&apos;re out of credits</DialogTitle>
        <p className="mt-1 text-sm text-muted">Buy a pack, or subscribe for a monthly allowance.</p>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        <div className="mt-5 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">One-time packs</p>
          <div className="space-y-3">
            {(Object.keys(CREDIT_PACKS) as CreditPack[]).map((pack) => {
              const { credits, priceUsd } = CREDIT_PACKS[pack];
              return (
                <div
                  key={pack}
                  className="flex items-center justify-between rounded-sm border border-border p-3"
                >
                  <div>
                    <p className="text-sm font-medium capitalize">{pack}</p>
                    <p className="text-xs text-muted">{credits} credits · ${priceUsd}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="accent"
                      onClick={() => startCheckout("/api/credits", { pack }, pack)}
                      disabled={redirecting === pack}
                    >
                      {redirecting === pack ? "Redirecting…" : "Pay with card"}
                    </Button>
                    <RazorpayButton pack={pack} label="Pay with UPI" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-6 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Monthly subscription</p>
          <div className="space-y-3">
            {(Object.keys(SUBSCRIPTION_PLANS) as SubscriptionPlan[]).map((plan) => {
              const { creditsPerMonth, priceUsd } = SUBSCRIPTION_PLANS[plan];
              return (
                <div
                  key={plan}
                  className="flex items-center justify-between rounded-sm border border-border p-3"
                >
                  <div>
                    <p className="text-sm font-medium capitalize">{plan}</p>
                    <p className="text-xs text-muted">{creditsPerMonth} credits/mo · ${priceUsd}/mo</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => startCheckout("/api/subscribe", { plan }, plan)}
                    disabled={redirecting === plan}
                  >
                    {redirecting === plan ? "Redirecting…" : "Subscribe"}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
