import { Router, type IRouter } from "express";
import healthRouter from "./health";
import botRouter from "./bot";
import tradesRouter from "./trades";
import positionsRouter from "./positions";
import instrumentsRouter from "./instruments";
import signalsRouter from "./signals";
import scannerRouter from "./scanner";

const router: IRouter = Router();

router.use(healthRouter);
router.use(botRouter);
router.use(tradesRouter);
router.use(positionsRouter);
router.use(instrumentsRouter);
router.use(signalsRouter);
router.use(scannerRouter);

export default router;
