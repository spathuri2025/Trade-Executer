import { Router, type IRouter } from "express";
import {
  listProfiles,
  activateProfile,
  saveCurrentIntoProfile,
  ProfileNotFoundError,
} from "../lib/tradingProfiles";
import { ScalpInstrumentLimitError } from "../lib/botEngine";

const router: IRouter = Router();

function serialize(p: Awaited<ReturnType<typeof listProfiles>>["profiles"][number]) {
  return {
    id: p.id,
    name: p.name,
    strategyMode: p.strategyMode,
    barResolution: p.barResolution,
    intervalMinutes: p.intervalMinutes,
    stopLossPercent: p.stopLossPercent,
    takeProfitPercent: p.takeProfitPercent,
    minEdgeVsSpread: p.minEdgeVsSpread,
    aiTradeMode: p.aiTradeMode,
    minAiConfidence: p.minAiConfidence,
    updatedAt: p.updatedAt.toISOString(),
  };
}

router.get("/trading-profiles", async (req, res): Promise<void> => {
  const { profiles, activeProfileId } = await listProfiles(req.user!.id);
  res.json({ profiles: profiles.map(serialize), activeProfileId });
});

router.post("/trading-profiles/:id/activate", async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid trading mode" });
    return;
  }
  try {
    const { status, profile } = await activateProfile(req.user!.id, id);
    res.json({ activeProfileId: profile.id, name: profile.name, config: status.config });
  } catch (err) {
    if (err instanceof ProfileNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    // Scalp mode refuses to start above its instrument limit; say so plainly
    // rather than letting the switch appear to work and then rate-limit.
    if (err instanceof ScalpInstrumentLimitError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

router.put("/trading-profiles/:id", async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid trading mode" });
    return;
  }
  try {
    res.json(serialize(await saveCurrentIntoProfile(req.user!.id, id)));
  } catch (err) {
    if (err instanceof ProfileNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    throw err;
  }
});

export default router;
