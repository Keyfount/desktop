/**
 * Smoke test — guarantees the frontend bundle has at least one file
 * Vitest can pick up so `npm run test:coverage` does not error out with
 * "no test files found". Real unit tests for the UI live alongside their
 * components (`*.test.tsx`) once those land.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_MEMORABLE_PROFILE, DEFAULT_RANDOM_PROFILE } from "../src/types.js";

describe("default profiles", () => {
  it("random profile default has the v1 length", () => {
    expect(DEFAULT_RANDOM_PROFILE.length).toBe(16);
    expect(DEFAULT_RANDOM_PROFILE.counter).toBe(1);
    expect(DEFAULT_RANDOM_PROFILE.lower).toBe(true);
    expect(DEFAULT_RANDOM_PROFILE.upper).toBe(true);
    expect(DEFAULT_RANDOM_PROFILE.digits).toBe(true);
    expect(DEFAULT_RANDOM_PROFILE.symbols).toBe(true);
  });

  it("memorable profile defaults to 6 words with a dot separator", () => {
    expect(DEFAULT_MEMORABLE_PROFILE.wordCount).toBe(6);
    expect(DEFAULT_MEMORABLE_PROFILE.separator).toBe(".");
    expect(DEFAULT_MEMORABLE_PROFILE.capitalise).toBe(true);
    expect(DEFAULT_MEMORABLE_PROFILE.suffix).toBe(true);
    expect(DEFAULT_MEMORABLE_PROFILE.counter).toBe(1);
  });
});
