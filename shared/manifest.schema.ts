import { z } from "zod";

export const RARITY_KEYS = [
  "common",
  "rare",
  "super_rare",
  "ultra_rare",
  "holo",
  "secret",
] as const;
export type RarityKey = (typeof RARITY_KEYS)[number];

const slugSchema = z
  .string()
  .min(1)
  .max(30)
  .regex(/^[a-z0-9-]+$/, "id must be a slug: lowercase letters, digits, hyphens");

const badgeSchema = z
  .string()
  .min(1)
  .max(8)
  .regex(/^[A-Z0-9-]+$/, "badge must be uppercase, max 8 chars");

const COLOR_SYNTAX = /^color:#[0-9a-fA-F]{6}$/;

function isHttpsUrl(value: string): boolean {
  if (!value.startsWith("https://")) return false;
  return URL.canParse(value);
}

/** https URL langsung ke file gambar, atau sintetik `color:#rrggbb` (dataset dummy). */
export const imageUrlSchema = z.string().refine(
  (v) => COLOR_SYNTAX.test(v) || isHttpsUrl(v),
  "imageUrl must be an https URL or synthetic color:#rrggbb",
);

export const sourcePageUrlSchema = z
  .string()
  .refine(isHttpsUrl, "sourcePageUrl must be an https URL");

export const focusSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export const photoSchema = z.object({
  photoNo: z.number().int().min(1),
  rarity: z.enum(RARITY_KEYS),
  imageUrl: imageUrlSchema,
  sourcePageUrl: sourcePageUrlSchema,
  license: z.string().nullable(),
  author: z.string().nullable(),
  label: z.string().min(1).max(60).optional(),
  focus: focusSchema.default({ x: 0.5, y: 0.35 }),
  enabled: z.boolean().default(true),
});

export const memberSchema = z.object({
  id: slugSchema,
  name: z.string().min(1),
  fullName: z.string().min(1).optional(),
  photos: z.array(photoSchema).min(1, "member must have at least 1 photo"),
  sortOrder: z.number().int().default(0),
  enabled: z.boolean().default(true),
});

export const groupManifestSchema = z.object({
  schemaVersion: z.literal(1),
  pool: z.string().min(1),
  group: z.object({
    id: slugSchema,
    name: z.string().min(1),
    badge: badgeSchema,
  }),
  members: z.array(memberSchema).min(1, "group must have at least 1 member"),
});

export const poolSchema = z.object({
  id: slugSchema,
  name: z.string().min(1),
  emoji: z.string().min(1),
  staminaMax: z.number().int().positive(),
  regenIntervalSec: z.number().int().positive(),
  resetCooldownSec: z.number().int().positive(),
  sortOrder: z.number().int().default(0),
  hidden: z.boolean().default(false),
});

export type PoolManifest = z.infer<typeof poolSchema>;
export type GroupManifest = z.infer<typeof groupManifestSchema>;
export type MemberManifest = z.infer<typeof memberSchema>;
export type PhotoManifest = z.infer<typeof photoSchema>;
