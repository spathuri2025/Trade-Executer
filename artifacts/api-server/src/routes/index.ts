import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import { requireAuth } from "../middlewares/requireAuth";
import botRouter from "./bot";
import brokerRouter from "./broker";
import tradesRouter from "./trades";
import positionsRouter from "./positions";
import instrumentsRouter from "./instruments";
import signalsRouter from "./signals";
import scannerRouter from "./scanner";
import newsRouter from "./news";
import assistantRouter from "./assistant";
import signalAnalystRouter from "./signalAnalyst";
import dailyMarketBriefRouter from "./dailyMarketBrief";
import backtestRouter from "./backtest";
import activityRouter from "./activity";
import candlesRouter from "./candles";
import marketNewsRouter from "./marketNews";
import marketBrainRouter from "./marketBrain";
import chartInsightRouter from "./chartInsight";
import performanceCoachRouter from "./performanceCoach";
import assistantBriefRouter from "./assistantBrief";
import tradeIntelligenceRouter from "./tradeIntelligence";

const router: IRouter = Router();

// Public — must be mounted before the auth gate below.
router.use(healthRouter);
router.use(authRouter);

// Everything else requires a logged-in session.
router.use(requireAuth);

router.use(botRouter);
router.use(brokerRouter);
router.use(tradesRouter);
router.use(positionsRouter);
router.use(instrumentsRouter);
router.use(signalsRouter);
router.use(scannerRouter);
router.use(newsRouter);
router.use(assistantRouter);
router.use(signalAnalystRouter);
router.use(dailyMarketBriefRouter);
router.use(backtestRouter);
router.use(activityRouter);
router.use(candlesRouter);
router.use(marketNewsRouter);
router.use(marketBrainRouter);
router.use(chartInsightRouter);
router.use(performanceCoachRouter);
router.use(assistantBriefRouter);
router.use(tradeIntelligenceRouter);

export default router;
