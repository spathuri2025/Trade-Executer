import { describe, it, expect } from "vitest";
import { briefStatus } from "./briefStatus";

describe("briefStatus", () => {
  it("marks last week's brief as stale", () => {
    // The 5 Oct 2026 case: a 28 Sep brief quoting £4,963 against a real £4,521.
    expect(briefStatus("2026-09-28", "2026-10-05", true)).toEqual({ stale: true, generating: true });
  });

  it("does not mark today's brief as stale", () => {
    expect(briefStatus("2026-10-05", "2026-10-05", false)).toEqual({ stale: false, generating: false });
  });

  it("treats yesterday as stale — a day is enough for a balance to move", () => {
    expect(briefStatus("2026-10-04", "2026-10-05", false).stale).toBe(true);
  });

  it("is not stale when there is no brief at all", () => {
    // Nothing on screen cannot mislead; the UI shows a waiting state instead.
    expect(briefStatus(null, "2026-10-05", true)).toEqual({ stale: false, generating: true });
    expect(briefStatus(undefined, "2026-10-05", false)).toEqual({ stale: false, generating: false });
  });

  it("reports generating independently of staleness", () => {
    expect(briefStatus("2026-10-05", "2026-10-05", true)).toEqual({ stale: false, generating: true });
  });
});
