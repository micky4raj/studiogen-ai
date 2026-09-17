import { z } from "zod";

export const generateImagesSchema = z.object({
  imageUrl: z.string().url(),
  niche: z.string().min(2).max(100),
  productDescription: z.string().max(2000).optional(),
});

export const copywritingSchema = z.object({
  productName: z.string().min(2).max(200),
  niche: z.string().min(2).max(100),
  keySpecs: z.array(z.string().max(200)).max(20).optional(),
  targetKeywords: z.array(z.string().max(100)).max(30).optional(),
  tone: z.enum(["premium", "playful", "minimal", "technical"]).optional(),
});

export const creditPackSchema = z.object({
  pack: z.enum(["starter", "growth", "scale"]),
});

/**
 * Parses a request body against a schema, returning either the typed data
 * or a formatted error string suitable for a 400 response.
 */
export function parseOrError<T>(
  schema: z.ZodSchema<T>,
  body: unknown
): { data: T; error: null } | { data: null; error: string } {
  const result = schema.safeParse(body);
  if (!result.success) {
    return { data: null, error: result.error.issues.map((i) => i.message).join(", ") };
  }
  return { data: result.data, error: null };
}
