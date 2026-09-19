import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function normalizeName(name: string) {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^a-zA-Z\s'-]/g, "")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export const IS_VALID_DOMAIN = (domain: string): boolean => {
  const VALID_DOMAINS = ["gmail.com", "yahoo.com", "outlook.com"];

  if (process.env.NODE_ENV === "development") {
    VALID_DOMAINS.push("example.com");
  }

  if(VALID_DOMAINS.includes(domain.toLowerCase())) {
    return true;
  }
  return false;
};

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getInitials(
  text: string,
  minLength = 1,
  maxLength = 3,
): string {
  if (!text.trim()) return "?";

  const words = text
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  // Single word -> take first N characters
  if (words.length === 1) {
    return words[0]
      .slice(0, maxLength)
      .toUpperCase();
  }

  // Multiple words -> first letter of each word
  return words
    .slice(0, maxLength)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}