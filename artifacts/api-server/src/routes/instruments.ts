import { Router, type IRouter } from "express";
import { db, instrumentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { AddInstrumentBody, DeleteInstrumentParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/instruments", async (_req, res): Promise<void> => {
  const instruments = await db.select().from(instrumentsTable).orderBy(instrumentsTable.addedAt);
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

  const [instrument] = await db
    .insert(instrumentsTable)
    .values({
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
    .where(eq(instrumentsTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Instrument not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
