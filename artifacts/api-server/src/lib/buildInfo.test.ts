import { describe, it, expect } from "vitest";
import { buildInfo } from "./buildInfo";

describe("buildInfo", () => {
  it("shortens Render's commit sha to something a human can compare", () => {
    expect(buildInfo({ RENDER_GIT_COMMIT: "3ecb4e9f2a1b7c8d9e0f1a2b3c4d5e6f7a8b9c0d" } as NodeJS.ProcessEnv).commit)
      .toBe("3ecb4e9");
  });

  it("says 'unknown' rather than guessing when nothing set it", () => {
    // Local dev, or a host that doesn't publish a commit. An empty string here
    // would render as a blank field and read like a bug in the endpoint.
    expect(buildInfo({} as NodeJS.ProcessEnv).commit).toBe("unknown");
  });

  it("treats an empty variable as unset", () => {
    expect(buildInfo({ RENDER_GIT_COMMIT: "" } as NodeJS.ProcessEnv).commit).toBe("unknown");
  });

  it("falls back to the generic variables for hosts that aren't Render", () => {
    expect(buildInfo({ GIT_COMMIT: "abcdef1234" } as NodeJS.ProcessEnv).commit).toBe("abcdef1");
    expect(buildInfo({ SOURCE_VERSION: "1234567890" } as NodeJS.ProcessEnv).commit).toBe("1234567");
  });

  it("reports a start time that does not move between calls", () => {
    // It marks when the PROCESS started, so a restart is visible as a change.
    // Recomputing it per request would make every response look like a restart.
    expect(buildInfo({} as NodeJS.ProcessEnv).startedAt).toBe(buildInfo({} as NodeJS.ProcessEnv).startedAt);
    expect(new Date(buildInfo({} as NodeJS.ProcessEnv).startedAt).getTime()).toBeLessThanOrEqual(Date.now());
  });
});
