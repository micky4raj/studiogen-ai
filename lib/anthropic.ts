import Anthropic from "@anthropic-ai/sdk";
import sanitizeHtml from "sanitize-html";
import type { CopywritingRequest, ProductCopy, ProductNiche } from "@/types";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022";

/**
 * Strips markdown code fences if the model wraps JSON in ```json ... ```
 */
function extractJson<T>(text: string): T {
  const cleaned = text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned) as T;
}

/**
 * Step 1 of the image pipeline: given a product niche, ask Claude for
 * 4 distinct, commercially-viable studio photography background prompts.
 * These prompts get passed to Replicate along with the bg-removed image.
 */
export async function generateBackgroundPrompts(
  niche: ProductNiche,
  productDescription?: string
): Promise<string[]> {
  const system = `You are an expert commercial product photographer and art director.
Given a product niche, generate exactly 4 distinct background/scene prompts
suitable for AI-generated studio product photography (e.g. for Flux/Stable Diffusion inpainting).
Each prompt should:
- Describe lighting, surface, and mood (not the product itself, since the product is inpainted in)
- Be diverse in style (e.g. one minimal studio, one lifestyle context, one luxury, one bold color)
- Be 1-2 sentences, written as an image generation prompt
Respond ONLY with a JSON array of 4 strings. No preamble, no markdown.`;

  const userMessage = productDescription
    ? `Niche: ${niche}\nProduct details: ${productDescription}`
    : `Niche: ${niche}`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1000,
    system,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Anthropic returned no text content for prompt generation");
  }

  const prompts = extractJson<string[]>(textBlock.text);

  if (!Array.isArray(prompts) || prompts.length !== 4) {
    throw new Error("Expected exactly 4 background prompts from Claude");
  }

  return prompts;
}

/**
 * Step 2: E-commerce copywriting engine.
 * Produces SEO title, 5 bullet points, and an HTML product description.
 */
export async function generateProductCopy(
  request: CopywritingRequest
): Promise<ProductCopy> {
  const system = `You are an expert e-commerce SEO copywriter for Amazon and Shopify listings.
Given product details, produce:
1. "seoTitle": a keyword-rich, high-converting product title (under 200 characters)
2. "bulletPoints": exactly 5 persuasive, benefit-driven bullet points
3. "descriptionHtml": an engaging product description formatted as clean semantic HTML
   (use <p>, <ul>, <strong> tags only — no <script>, no inline styles, no full HTML document wrapper)
Respond ONLY with a JSON object matching this shape:
{ "seoTitle": string, "bulletPoints": string[5], "descriptionHtml": string }
No preamble, no markdown fences.`;

  const userMessage = JSON.stringify(request, null, 2);

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Anthropic returned no text content for copywriting");
  }

  const copy = extractJson<ProductCopy>(textBlock.text);

  if (!copy.seoTitle || !copy.descriptionHtml || copy.bulletPoints?.length !== 5) {
    throw new Error("Malformed copywriting response from Claude");
  }

  // The model is instructed to return plain <p>/<ul>/<strong> HTML, but it's
  // still model output being rendered with dangerouslySetInnerHTML on the
  // frontend — sanitize defensively rather than trusting the prompt held.
  copy.descriptionHtml = sanitizeHtml(copy.descriptionHtml, {
    allowedTags: ["p", "ul", "ol", "li", "strong", "em", "br"],
    allowedAttributes: {},
  });

  return copy;
}
