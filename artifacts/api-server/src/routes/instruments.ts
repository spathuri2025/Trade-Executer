import { Router, type IRouter } from "express";
import { db, instrumentsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { AddInstrumentBody, DeleteInstrumentParams, UpdateInstrumentBody } from "@workspace/api-zod";
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

/**
 * Enable or disable an instrument.
 *
 * Separate from DELETE on purpose. An instrument whose spread makes it
 * unprofitable — SMCI needs a 128% win rate at a 0.3% target — is worth keeping
 * in the list with its history rather than erased, so the decision can be
 * revisited when the exits change. The engine reads `enabled` every cycle, so
 * this takes effect on the next one without a restart.
 */
router.patch("/instruments/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteInstrumentParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateInstrumentBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  // Scoped to the caller's own rows, exactly as DELETE is: the id alone must
  // never be enough to touch another account's watchlist.
  const [updated] = await db
    .update(instrumentsTable)
    .set({ enabled: body.data.enabled })
    .where(and(eq(instrumentsTable.id, params.data.id), eq(instrumentsTable.userId, req.user!.id)))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Instrument not found" });
    return;
  }

  res.json({
    id: updated.id,
    ticker: updated.ticker,
    name: updated.name,
    enabled: updated.enabled,
    addedAt: updated.addedAt.toISOString(),
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
