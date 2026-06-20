import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import healthRouter from "./routes/health";
import authRouter from "./routes/auth";
import { requireSession } from "./middlewares/auth";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Public endpoints (no session required).
app.use("/api", healthRouter); // /api/healthz deploy liveness probe
app.use("/api", authRouter); // /api/auth/login | logout | me

// Everything else under /api requires a valid dashboard session cookie.
app.use("/api", requireSession);
app.use("/api", router);

export default app;
