import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-6">
      <p className="text-sm text-muted">Product photography, automated</p>
      <h1 className="font-display text-4xl leading-tight">
        One raw photo in.<br />A full studio shoot out.
      </h1>
      <p className="text-muted">
        Upload a product photo and a niche. Get four AI-directed studio shots
        and SEO-ready listing copy, in the time it takes to make coffee.
      </p>
      <Link href="/login" className="w-fit">
        <Button variant="accent" size="lg">Start a shoot</Button>
      </Link>
    </main>
  );
}
