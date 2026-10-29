import { z } from "zod";
import { topics } from "../shared/catalog";

const item = z
  .object({ id: z.uuid(), title: z.string().max(2000), saved: z.boolean(), read: z.boolean() })
  .strict();
const schema = z
  .object({
    version: z.literal(1),
    items: z.array(item).max(1000),
    theme: z.enum(["dark", "light"]),
    company: z.string().max(80),
    topic: z.enum(topics).or(z.literal("")),
  })
  .strict();
export type Library = z.infer<typeof schema>;
export const emptyLibrary: Library = {
  version: 1,
  items: [],
  theme: "dark",
  company: "",
  topic: "",
};
const key = "radar.preferences.v1";
let cached: Library = emptyLibrary;
let rawCache: string | null | undefined;
export function parseLibrary(raw: string | null): Library {
  if (!raw || raw.length > 2_000_000) return emptyLibrary;
  try {
    return schema.parse(JSON.parse(raw) as unknown);
  } catch {
    return emptyLibrary;
  }
}
export function getLibrary(): Library {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw !== rawCache) {
      rawCache = raw;
      cached = parseLibrary(raw);
    }
    return cached;
  } catch {
    return cached;
  }
}
export function subscribeLibrary(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener("radar-library", listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("radar-library", listener);
  };
}
export function updateLibrary(update: (value: Library) => Library): boolean {
  const next = schema.parse(update(getLibrary()));
  try {
    const raw = JSON.stringify(next);
    window.localStorage.setItem(key, raw);
    rawCache = raw;
    cached = next;
    window.dispatchEvent(new Event("radar-library"));
    return true;
  } catch {
    return false;
  }
}
