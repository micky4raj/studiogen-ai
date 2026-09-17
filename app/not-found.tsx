import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm text-muted">404</p>
      <h1 className="font-display text-2xl">This frame's empty</h1>
      <p className="text-sm text-muted">The page you're looking for doesn't exist.</p>
      <Link href="/">
        <Button variant="accent">Back to StudioGen AI</Button>
      </Link>
    </main>
  );
}
