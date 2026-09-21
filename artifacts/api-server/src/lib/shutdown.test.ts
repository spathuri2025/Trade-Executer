import { describe, it, expect, vi } from "vitest";
import { gracefulShutdown, type ShutdownDeps } from "./shutdown";

/** Deps with a controllable clock and in-flight count, recording call order. */
function harness(inFlightSequence: number[]) {
  const order: string[] = [];
  let clock = 0;
  let i = 0;
  const deps: ShutdownDeps = {
    stopAdopting: () => order.push("stopAdopting"),
    standDownEngines: async () => {
      order.push("standDown");
      return 1;
    },
    stopServer: () => order.push("stopServer"),
    inFlight: () => inFlightSequence[Math.min(i, inFlightSequence.length - 1)],
    releaseLeases: vi.fn(async () => {
      order.push("release");
    }),
    log: () => {},
    sleep: async (ms) => {
      clock += ms;
      i += 1;
    },
    now: () => clock,
  };
  return { deps, order };
}

describe("gracefulShutdown", () => {
  it("stops new work, waits for the running cycle, then releases — in that order", async () => {
    const { deps, order } = harness([1, 1, 0]); // a cycle finishes after two polls
    const result = await gracefulShutdown(deps);

    expect(result).toEqual({ drained: true, released: true, engines: 1 });
    expect(order).toEqual(["stopAdopting", "standDown", "stopServer", "release"]);
  });

  it("releases straight away when nothing is running", async () => {
    const { deps } = harness([0]);
    expect((await gracefulShutdown(deps)).released).toBe(true);
  });

  it("KEEPS the leases if a cycle is still running at the deadline", async () => {
    // Releasing here would let the incoming instance trade the same account
    // while this one may still be placing an order. Kept leases expire after
    // Render's force-kill, so the handover is slower but can never overlap.
    const { deps } = harness([1]); // never finishes
    const result = await gracefulShutdown(deps, 1_000);

    expect(result).toEqual({ drained: false, released: false, engines: 1 });
    expect(deps.releaseLeases).not.toHaveBeenCalled();
  });

  it("never starts waiting before new cycles are stopped", async () => {
    // Otherwise the timer could keep launching cycles and the drain never ends.
    const { deps, order } = harness([0]);
    await gracefulShutdown(deps);
    expect(order.indexOf("standDown")).toBeLessThan(order.indexOf("release"));
    expect(order[0]).toBe("stopAdopting");
  });
});
