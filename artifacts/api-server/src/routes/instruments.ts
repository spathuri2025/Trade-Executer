import { Router, type IRouter } from "express";
import { db, instrumentsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { AddInstrumentBody, DeleteInstrumentParams } from "@workspace/api-zod";
import { getPlanLimits } from "../lib/planService";

const router: IRouter = Router();

router.get("/instruments", async (req, res): Promise<void> => {
  const instruments = await db
    .select()
    .from(instrumentsTable)
    .where(eq(instrumentsTable.userId, req.user!.id))
    .orderBy(instrumentsTable.addedAt);
  res.json(
    instruments.map((i) => ({
      id: i.id,
      ticker: i.ticker,
      name: i.name,
      enabled: i.enabled,
      addedAt: i.addedAt.toISOString(),
    }))
  );
});

router.post("/instruments", async (req, res): Promise<void> => {
  const parsed = AddInstrumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Plan cap. Only guards ADDING — GET and DELETE stay open so a user who
  // lands over their cap after a downgrade can still see and prune their list
  // rather than hitting a dead end.
  const { maxInstruments } = await getPlanLimits(req.user!.id);
  if (maxInstruments !== Infinity) {
    const existing = await db
      .select({ id: instrumentsTable.id })
      .from(instrumentsTable)
      .where(eq(instrumentsTable.userId, req.user!.id));
    if (existing.length >= maxInstruments) {
      res.status(402).json({
        error: `Your plan tracks up to ${maxInstruments} instruments. Remove one or upgrade to add more.`,
      });
      return;
    }
  }

  const [instrument] = await db
    .insert(instrumentsTable)
    .values({
      userId: req.user!.id,
      ticker: parsed.data.ticker.toUpperCase(),
      name: parsed.data.name,
      enabled: parsed.data.enabled ?? true,
    })
    .returning();

  res.status(201).json({
    id: instrument.id,
    ticker: instrument.ticker,
    name: instrument.name,
    enabled: instrument.enabled,
    addedAt: instrument.addedAt.toISOString(),
  });
});

router.delete("/instruments/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteInstrumentParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(instrumentsTable)
    .where(and(eq(instrumentsTable.id, params.data.id), eq(instrumentsTable.userId, req.user!.id)))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Instrument not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
