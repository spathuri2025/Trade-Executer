import { Router, type IRouter } from "express";
import {
  getScannerStatus,
  updateScannerConfig,
  startScanner,
  stopScanner,
  runScan,
  getScannerResults,
  type ScannerConfig,
} from "../lib/scannerEngine";

/** Bounded limit parsing — invalid input is refused, never silently defaulted. */
function parseLimit(raw: unknown, fallback: number, max: number): number | null {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) return null;
  return n;
}

const router: IRouter = Router();

router.get("/scanner/status", async (req, res): Promise<void> => {
  try {
    res.json(await getScannerStatus(req.user!.id));
  } catch (err) {
    req.log.error({ err }, "Failed to read scanner status");
    res.status(500).json({ error: "Failed to read scanner status" });
  }
});

router.post("/scanner/config", async (req, res): Promise<void> => {
  try {
    const patch = req.body as Partial<ScannerConfig>;
    const status = await updateScannerConfig(req.user!.id, patch);

    if (patch.scanEnabled === true && !status.running) {
      await startScanner(req.user!.id);
    } else if (patch.scanEnabled === false && status.running) {
      await stopScanner(req.user!.id);
    }

    res.json(await getScannerStatus(req.user!.id));
  } catch (err) {
    req.log.error({ err }, "Failed to save scanner config");
    res.status(500).json({ error: "Failed to save scanner config" });
  }
});

router.post("/scanner/run", async (req, res): Promise<void> => {
  try {
    const result = await runScan(req.user!.id);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Manual scan failed");
    res.status(500).json({ error: "Scan failed" });
  }
});

router.get("/scanner/results", async (req, res): Promise<void> => {
  try {
    const limit = parseLimit(req.query["limit"], 50, 500);
    if (limit === null) {
      res.status(400).json({ error: "limit must be a whole number between 1 and 500" });
      return;
    }
    const results = await getScannerResults(req.user!.id, limit);
    res.json(results);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch scanner results");
    res.status(500).json({ error: "Failed to fetch scanner results" });
  }
});

export default router;
