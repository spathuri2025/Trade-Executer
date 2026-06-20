import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import engineRouter from "./engine";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(engineRouter);

export default router;
