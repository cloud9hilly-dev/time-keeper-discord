import assert from "node:assert/strict";
import test from "node:test";
import { cleanDiscordId, cleanName, isValidWeekStart, normalizeHours } from "../src/domain.ts";

test("accepts only Monday week starts", () => {
  assert.equal(isValidWeekStart("2026-10-12"), true);
  assert.equal(isValidWeekStart("2026-10-13"), false);
  assert.equal(isValidWeekStart("not-a-date"), false);
});

test("normalizes hours to quarter-hour increments", () => {
  assert.equal(normalizeHours(39.88), 40);
  assert.equal(normalizeHours("7.12"), 7);
  assert.equal(normalizeHours(169), null);
  assert.equal(normalizeHours(-1), null);
});

test("cleans names and validates Discord snowflakes", () => {
  assert.equal(cleanName("  Hillcrest   Shop "), "Hillcrest Shop");
  assert.equal(cleanName("   "), null);
  assert.equal(cleanDiscordId("123456789012345678"), "123456789012345678");
  assert.equal(cleanDiscordId("Shane"), null);
});
