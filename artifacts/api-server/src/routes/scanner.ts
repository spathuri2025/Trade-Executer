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

const router: IRouter = Router();

router.get("/scanner/status", (req, res): void => {
  res.json(getScannerStatus(req.user!.id));
});

router.post("/scanner/config", (req, res): void => {
  const patch = req.body as Partial<ScannerConfig>;
  const status = updateScannerConfig(req.user!.id, patch);

  if (patch.scanEnabled === true && !status.running) {
    startScanner(req.user!.id);
  } else if (patch.scanEnabled === false && status.running) {
    stopScanner(req.user!.id);
  }

  res.json(getScannerStatus(req.user!.id));
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
    const limit = req.query["limit"] ? Number(req.query["limit"]) : 50;
    const results = await getScannerResults(req.user!.id, limit);
    res.json(results);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch scanner results");
    res.status(500).json({ error: "Failed to fetch scanner results" });
  }
});

export default router;
