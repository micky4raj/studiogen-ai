"use client";

import { useEffect, useRef, useState } from "react";
import { UploadDropzone } from "@/components/upload-dropzone";
import { UpgradeDialog } from "@/components/upgrade-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import type { ImageGenerationJob, ProductCopy } from "@/types";

function StepNumber({ n }: { n: number }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-xs text-muted">
      {n}
    </span>
  );
}

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60_000;

export function DashboardClient({ userId, userEmail }: { userId: string; userEmail: string }) {
  const [imageUrl, setImageUrl] = useState("");
  const [niche, setNiche] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [job, setJob] = useState<ImageGenerationJob | null>(null);
  const [copy, setCopy] = useState<ProductCopy | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartedAt = useRef<number>(0);

  async function refreshCredits() {
    const res = await fetch("/api/credits");
    if (res.ok) {
      const { credits } = await res.json();
      setCredits(credits);
    }
  }

  useEffect(() => {
    refreshCredits();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function stopPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }

  async function pollJob(jobId: string) {
    pollStartedAt.current = Date.now();
    pollRef.current = setInterval(async () => {
      if (Date.now() - pollStartedAt.current > POLL_TIMEOUT_MS) {
        stopPolling();
        setError("This is taking longer than expected. Check back in a bit.");
        return;
      }

      const res = await fetch(`/api/jobs/${jobId}`);
      if (!res.ok) return;

      const { job }: { job: ImageGenerationJob } = await res.json();
      setJob(job);

      if (job.status === "completed") {
        stopPolling();
        refreshCredits();
        const copyRes = await fetch("/api/copywriting", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productName: job.niche, niche: job.niche }),
        });
        if (copyRes.ok) {
          const { copy } = await copyRes.json();
          setCopy(copy);
        }
      } else if (job.status === "failed") {
        stopPolling();
        refreshCredits(); // reflects the automatic refund
        setError(job.error || "Generation failed. Your credit has been refunded.");
      }
    }, POLL_INTERVAL_MS);
  }

  async function handleGenerate() {
    setSubmitting(true);
    setError(null);
    setJob(null);
    setCopy(null);

    try {
      const res = await fetch("/api/generate-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl, niche }),
      });

      if (res.status === 402) {
        setUpgradeOpen(true);
        return;
      }
      if (res.status === 429) {
        setError("Too many requests — please wait a moment and try again.");
        return;
      }
      if (!res.ok) throw new Error("Failed to start generation");

      const { jobId } = await res.json();
      setJob({ id: jobId, status: "queued" } as ImageGenerationJob);
      refreshCredits();
      pollJob(jobId);
    } catch (err) {
      console.error(err);
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const isRunning = job && (job.status === "queued" || job.status === "processing");

  return (
    <main className="mx-auto max-w-3xl space-y-10 px-6 py-12">
      <header className="flex items-center justify-between">
        <h1 className="font-display text-2xl">New shoot</h1>
        <div className="flex items-center gap-4 text-sm text-muted">
          <button
            onClick={() => setUpgradeOpen(true)}
            className="rounded-full border border-border px-3 py-1 text-foreground hover:border-accent"
          >
            {credits === null ? "…" : `${credits} credit${credits === 1 ? "" : "s"}`}
          </button>
          <span>{userEmail}</span>
          <form action="/auth/sign-out" method="post">
            <button className="underline underline-offset-4 hover:text-foreground">Sign out</button>
          </form>
        </div>
      </header>

      <section className="grid gap-8 sm:grid-cols-[1fr,1.2fr]">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <StepNumber n={1} />
            <Label>Raw product photo</Label>
          </div>
          <UploadDropzone userId={userId} onUploaded={setImageUrl} />
        </div>

        <div className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <StepNumber n={2} />
              <Label htmlFor="niche">Product niche</Label>
            </div>
            <Input
              id="niche"
              placeholder="e.g. Luxury Watch, Organic Skincare"
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <StepNumber n={3} />
              <Label>Generate</Label>
            </div>
            <Button
              variant="accent"
              className="w-full"
              onClick={handleGenerate}
              disabled={submitting || !!isRunning || !imageUrl || !niche || credits === 0}
            >
              {isRunning
                ? "Generating…"
                : submitting
                ? "Starting…"
                : credits === 0
                ? "Out of credits"
                : "Generate studio shoot — 1 credit"}
            </Button>
            {isRunning && (
              <p className="text-xs text-muted">
                Running in the background — this page will update automatically.
              </p>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
        </div>
      </section>

      {job?.status === "completed" && job.results && (
        <section className="space-y-3">
          <h2 className="font-display text-lg">Contact sheet</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {job.results.map((img, i) => (
              <figure key={img.id} className="space-y-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={img.prompt} className="aspect-square w-full rounded-sm object-cover" />
                <figcaption className="text-xs text-muted">Frame {i + 1}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      {copy && (
        <section className="space-y-3">
          <h2 className="font-display text-lg">Listing copy</h2>
          <Card>
            <CardContent className="space-y-3">
              <h3 className="font-medium">{copy.seoTitle}</h3>
              <ul className="list-inside list-disc space-y-1 text-sm text-muted">
                {copy.bulletPoints.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
              <div
                className="prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: copy.descriptionHtml }}
              />
            </CardContent>
          </Card>
        </section>
      )}

      <UpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
    </main>
  );
}
