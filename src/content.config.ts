import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const journey = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/journey" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    draft: z.boolean().default(false),
    type: z.enum(["decision", "experiment", "failure", "ship", "score", "note"]),
    clip: z.string().optional(),
    run: z.string().optional(),
    delta: z.string().optional(),
  }),
});

export const collections = { journey };
