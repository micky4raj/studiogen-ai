// ---------- Core domain types ----------

export type ProductNiche =
  | "Luxury Watch"
  | "Organic Skincare"
  | "Consumer Electronics"
  | "Home Decor"
  | "Apparel"
  | "Jewelry"
  | string; // allow free-text niches too

export interface BackgroundPromptSet {
  prompts: string[]; // exactly 4 creative studio-photography prompts
  niche: ProductNiche;
  generatedAt: string;
}

export interface GeneratedImage {
  id: string;
  url: string; // Supabase Storage public URL (after re-hosting from Replicate's temp URL)
  replicatePredictionId: string;
  prompt: string;
}

export interface ImageGenerationJob {
  id: string;
  userId: string;
  status: "queued" | "processing" | "completed" | "failed";
  originalImageUrl: string;
  backgroundRemovedUrl?: string;
  niche: ProductNiche;
  prompts?: string[];
  results?: GeneratedImage[];
  creditsCharged: number;
  createdAt: string;
  error?: string;
}

export interface ProductCopy {
  seoTitle: string;
  bulletPoints: string[]; // exactly 5
  descriptionHtml: string; // clean HTML, safe for Shopify/Amazon rich text fields
}

export interface CopywritingRequest {
  productName: string;
  niche: ProductNiche;
  keySpecs?: string[];
  targetKeywords?: string[];
  tone?: "premium" | "playful" | "minimal" | "technical";
}

// ---------- Credits & Billing ----------

export type CreditPack = "starter" | "growth" | "scale";
export type SubscriptionPlan = "pro" | "studio";

export interface UserCreditBalance {
  userId: string;
  credits: number;
  plan: "free" | "subscription" | "payg";
  updatedAt: string;
}

export const CREDIT_COST_PER_IMAGE_BATCH = 1; // 1 credit = 1 batch of 4 images

export interface CreditTransaction {
  id: string;
  userId: string;
  amount: number; // negative for deduction, positive for top-up
  reason: "image_generation" | "purchase" | "subscription_renewal" | "refund";
  jobId?: string;
  createdAt: string;
}
