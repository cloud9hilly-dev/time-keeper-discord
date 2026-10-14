export const MAX_EMPLOYEES_PER_STORE = 8;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function isValidWeekStart(value: unknown): value is string {
  if (!isIsoDate(value)) return false;
  return new Date(`${value}T00:00:00Z`).getUTCDay() === 1;
}

export function normalizeHours(value: unknown): number | null {
  const hours = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(hours) || hours < 0 || hours > 168) return null;
  return Math.round(hours * 4) / 4;
}

export function cleanName(value: unknown, maxLength = 80): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= maxLength ? name : null;
}

export function cleanDiscordId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return /^\d{15,22}$/.test(id) ? id : null;
}
