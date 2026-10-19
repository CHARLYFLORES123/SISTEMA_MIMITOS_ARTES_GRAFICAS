import { Router } from "express";
import {
  db, customerPointsTable, pointsTransactionsTable,
  businessSettingsTable, customersTable, salesTable,
  TIER_CONFIG, getTierForLifetime,
} from "@workspace/db";
import { eq, desc, asc, and, ne, isNotNull, sql } from "drizzle-orm";
import { verifyToken, AuthRequest } from "../middlewares/auth";
import { issueTierCoupon } from "./coupons";

const router = Router();
router.use(verifyToken);

// ── helpers ───────────────────────────────────────────────────────────────────

export async function getSettings() {
  const [s] = await db.select().from(businessSettingsTable).limit(1);
  return s ?? null;
}

export async function getOrCreateBalance(tx: any, customerId: number) {
  const [row] = await tx
    .select()
    .from(customerPointsTable)
    .where(eq(customerPointsTable.customerId, customerId))
    .limit(1);
  if (row) return row;
  const [created] = await tx
    .insert(customerPointsTable)
    .values({ customerId, points: 0, lifetimeEarned: 0, lifetimeRedeemed: 0, tier: "bronze" })
    .returning();
  return created;
}

function buildTierInfo(tier: string, lifetimeEarned: number) {
  const t = TIER_CONFIG[tier as keyof typeof TIER_CONFIG] ?? TIER_CONFIG.bronze;
  const next =
    tier === "bronze" ? TIER_CONFIG.silver :
    tier === "silver" ? TIER_CONFIG.gold   : null;

  return {
    tier,
    tierLabel: t.label,
    tierMultiplier: t.multiplier,
    tierColor: t.color,
    nextTier: next ? { name: tier === "bronze" ? "silver" : "gold", label: next.label, min: next.min } : null,
    progressToNext: next ? Math.min(100, Math.floor((lifetimeEarned / next.min) * 100)) : 100,
    pointsToNext: next ? Math.max(0, next.min - lifetimeEarned) : 0,
  };
}

// ── Award points (called internally from sales route or sync) ───────────────────
export async function awardPointsForSale(
  customerId: number,
  saleId: number,
  totalAmount: number,
  pointsPerUnit: number
) {
  return await db.transaction(async (tx) => {
    // Nota: un cliente con balance 0 (canjeó todos sus descuentos) SÍ vuelve a
    // acumular puntos en su próxima compra sin canje — su tier fue reiniciado a
    // bronce al momento del canje total.

    // Idempotency: don't award twice for the same sale
    const [existingTx] = await tx
      .select()
      .from(pointsTransactionsTable)
      .where(
        and(
          eq(pointsTransactionsTable.saleId, saleId),
          eq(pointsTransactionsTable.type, "earned")
        )
      )
      .limit(1);
    if (existingTx) {
      return { earned: existingTx.delta, tieredUp: false, newTier: "bronze", couponCode: null };
    }

    const bal = await getOrCreateBalance(tx, customerId);
    const currentTier = (bal.tier as keyof typeof TIER_CONFIG) ?? "bronze";

    // Sin multiplicador de nivel: los puntos asignados son exactamente el total
    // de la venta (redondeado) × pointsPerUnit.
    const earned = Math.max(0, Math.round(totalAmount * pointsPerUnit));
    if (earned <= 0) {
      return { earned: 0, tieredUp: false, newTier: currentTier, couponCode: null };
    }

    const newLifetime = bal.lifetimeEarned + earned;
    const newTier = getTierForLifetime(newLifetime);
    const tieredUp = newTier !== currentTier;

    await tx
      .update(customerPointsTable)
      .set({
        points: bal.points + earned,
        lifetimeEarned: newLifetime,
        tier: newTier,
      })
      .where(eq(customerPointsTable.customerId, customerId));

    const noteBase = `Puntos ganados por venta #${String(saleId).padStart(6, "0")}`;
    await tx.insert(pointsTransactionsTable).values({
      customerId,
      delta: earned,
      type: "earned",
      saleId,
      notes: noteBase,
    });

    let couponCode: string | null = null;
    if (tieredUp) {
      await tx.insert(pointsTransactionsTable).values({
        customerId,
        delta: 0,
        type: "tier_up",
        notes: `¡Nivel alcanzado: ${TIER_CONFIG[newTier].label}! Multiplicador ×${TIER_CONFIG[newTier].multiplier}`,
      });
      // Auto-issue a coupon for silver/gold upgrades
      if (newTier === "silver" || newTier === "gold") {
        const coupon = await issueTierCoupon(tx, customerId, newTier);
        couponCode = coupon.code;
        await tx.insert(pointsTransactionsTable).values({
          customerId,
          delta: 0,
          type: "coupon",
          notes: `¡Cupón generado: ${coupon.code} — ${newTier === "gold" ? "10" : "5"}% de descuento!`,
        });
      }
    }

    return { earned, tieredUp, newTier, couponCode };
  });
}

// ── Sincronizar puntos de ventas existentes de clientes ────────────────────────
export async function syncCustomerLoyaltyPoints() {
  const settings = await getSettings();
  if (!settings?.loyaltyEnabled) return { processed: 0, totalSales: 0 };

  const pointsPerUnit = Number(settings.pointsPerUnit ?? 1);

  // 1. Obtener todas las ventas completadas asociadas a clientes registrados
  const sales = await db
    .select({
      id: salesTable.id,
      customerId: salesTable.customerId,
      total: salesTable.total,
      discount: salesTable.discount,
      status: salesTable.status,
      createdAt: salesTable.createdAt,
    })
    .from(salesTable)
    .where(
      and(
        isNotNull(salesTable.customerId),
        ne(salesTable.status, "cancelada")
      )
    )
    .orderBy(asc(salesTable.createdAt));

  let processed = 0;

  for (const sale of sales) {
    if (!sale.customerId) continue;

    // No re-otorgar puntos si la venta incluyó canje de descuento
    const [redemptionTx] = await db
      .select({ id: pointsTransactionsTable.id })
      .from(pointsTransactionsTable)
      .where(
        and(
          eq(pointsTransactionsTable.saleId, sale.id),
          eq(pointsTransactionsTable.type, "redeemed")
        )
      )
      .limit(1);
    if (redemptionTx) continue;

    // No otorgar puntos en ventas que aplicaron descuento (canje o cupon)
    if (Number(sale.discount ?? 0) > 0) continue;

    const [existingTx] = await db
      .select({ id: pointsTransactionsTable.id })
      .from(pointsTransactionsTable)
      .where(
        and(
          eq(pointsTransactionsTable.saleId, sale.id),
          eq(pointsTransactionsTable.type, "earned")
        )
      )
      .limit(1);

    if (!existingTx) {
      await awardPointsForSale(sale.customerId, sale.id, Number(sale.total), pointsPerUnit);
      processed++;
    }
  }

  // 2. Asegurar que todos los clientes registrados tengan registro en customerPointsTable
  const allCustomers = await db.select({ id: customersTable.id }).from(customersTable);
  for (const c of allCustomers) {
    const [existing] = await db
      .select({ id: customerPointsTable.id })
      .from(customerPointsTable)
      .where(eq(customerPointsTable.customerId, c.id))
      .limit(1);
    if (!existing) {
      await db.insert(customerPointsTable).values({
        customerId: c.id,
        points: 0,
        lifetimeEarned: 0,
        lifetimeRedeemed: 0,
        tier: "bronze",
      });
    }
  }

  return { processed, totalSales: sales.length };
}

// ── GET /api/loyalty/balance/:customerId ──────────────────────────────────────
router.get("/balance/:customerId", async (req, res) => {
  const customerId = Number(req.params.customerId);
  try {
    const settings = await getSettings();
    const [c] = await db
      .select()
      .from(customersTable)
      .where(eq(customersTable.id, customerId))
      .limit(1);

    const bal = await getOrCreateBalance(db, customerId);

    const points = bal?.points ?? 0;
    const lifetimeEarned = bal?.lifetimeEarned ?? 0;
    const tier = bal?.tier ?? "bronze";
    const redemptionRate = Number(settings?.pointsRedemptionRate ?? 0.01);

    res.json({
      customerId,
      customerName: c?.name ?? null,
      customerEmail: c?.email ?? null,
      customerPhone: c?.phone ?? null,
      customerNitCi: c?.nitCi ?? null,
      points,
      lifetimeEarned,
      lifetimeRedeemed: bal?.lifetimeRedeemed ?? 0,
      discountValue: +(points * redemptionRate).toFixed(2),
      redemptionRate,
      pointsPerUnit: settings?.pointsPerUnit ?? 1,
      loyaltyEnabled: Boolean(settings?.loyaltyEnabled),
      ...buildTierInfo(tier, lifetimeEarned),
    });
  } catch (err) {
    req.log.error({ err }, "GetLoyaltyBalance error");
    res.status(500).json({ message: "Error interno" });
  }
});

// ── GET /api/loyalty/history/:customerId ──────────────────────────────────────
router.get("/history/:customerId", async (req, res) => {
  const customerId = Number(req.params.customerId);
  try {
    const rows = await db
      .select()
      .from(pointsTransactionsTable)
      .where(eq(pointsTransactionsTable.customerId, customerId))
      .orderBy(desc(pointsTransactionsTable.createdAt))
      .limit(100);

    res.json(
      rows.map((r) => ({
        id: r.id,
        delta: r.delta,
        type: r.type,
        saleId: r.saleId ?? null,
        notes: r.notes ?? null,
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
      }))
    );
  } catch (err) {
    req.log.error({ err }, "GetLoyaltyHistory error");
    res.status(500).json({ message: "Error interno" });
  }
});

// ── GET /api/loyalty/leaderboard ──────────────────────────────────────────────
router.get("/leaderboard", async (req, res) => {
  try {
    // Sincronizar automáticamente cualquier venta que aún no tenga puntos acreditados
    try {
      await syncCustomerLoyaltyPoints();
    } catch (syncErr) {
      req.log.warn({ err: syncErr }, "Auto-sync loyalty points error (non-fatal)");
    }

    const rows = await db
      .select({
        customerId: customersTable.id,
        customerName: customersTable.name,
        customerEmail: customersTable.email,
        customerPhone: customersTable.phone,
        customerNitCi: customersTable.nitCi,
        points: customerPointsTable.points,
        lifetimeEarned: customerPointsTable.lifetimeEarned,
        lifetimeRedeemed: customerPointsTable.lifetimeRedeemed,
        tier: customerPointsTable.tier,
      })
      .from(customersTable)
      .leftJoin(customerPointsTable, eq(customersTable.id, customerPointsTable.customerId))
      .orderBy(
        desc(sql`COALESCE(${customerPointsTable.lifetimeEarned}, 0)`),
        asc(customersTable.name)
      );

    const settings = await getSettings();
    const redemptionRate = Number(settings?.pointsRedemptionRate ?? 0.01);

    res.json(
      rows.map((r) => {
        const points = r.points ?? 0;
        const lifetimeEarned = r.lifetimeEarned ?? 0;
        const lifetimeRedeemed = r.lifetimeRedeemed ?? 0;
        const tier = r.tier ?? "bronze";
        return {
          customerId: r.customerId,
          customerName: r.customerName,
          customerEmail: r.customerEmail ?? null,
          customerPhone: r.customerPhone ?? null,
          customerNitCi: r.customerNitCi ?? null,
          points,
          lifetimeEarned,
          lifetimeRedeemed,
          discountValue: +(points * redemptionRate).toFixed(2),
          ...buildTierInfo(tier, lifetimeEarned),
        };
      })
    );
  } catch (err) {
    req.log.error({ err }, "GetLeaderboard error");
    res.status(500).json({ message: "Error interno" });
  }
});

// ── POST /api/loyalty/sync ────────────────────────────────────────────────────
router.post("/sync", async (req: AuthRequest, res) => {
  try {
    const result = await syncCustomerLoyaltyPoints();
    res.json({ message: "Puntos sincronizados correctamente", ...result });
  } catch (err) {
    req.log.error({ err }, "SyncLoyalty error");
    res.status(500).json({ message: "Error al sincronizar puntos" });
  }
});

// ── GET /api/loyalty/tiers — static tier info ─────────────────────────────────
router.get("/tiers", async (_req, res) => {
  res.json(
    Object.entries(TIER_CONFIG).map(([key, t]) => ({
      name: key,
      label: t.label,
      min: t.min,
      max: t.max,
      multiplier: t.multiplier,
      color: t.color,
    }))
  );
});

// ── POST /api/loyalty/redeem ──────────────────────────────────────────────────
router.post("/redeem", async (req: AuthRequest, res) => {
  const { customerId, pointsToRedeem } = req.body ?? {};
  if (!customerId || !pointsToRedeem || pointsToRedeem <= 0) {
    res.status(400).json({ message: "Datos inválidos" });
    return;
  }

  try {
    const settings = await getSettings();

    const result = await db.transaction(async (tx) => {
      const bal = await getOrCreateBalance(tx, customerId);
      if (bal.points < pointsToRedeem) {
        throw new Error(`Puntos insuficientes. Disponibles: ${bal.points}`);
      }

      const redemptionRate = Number(settings.pointsRedemptionRate ?? 0.01);
      const discountAmount = +(pointsToRedeem * redemptionRate).toFixed(2);
      const remainingPoints = bal.points - pointsToRedeem;

      // Si el canje deja el balance en 0, el tier se reinicia a bronce y el
      // progreso histórico se resetea (podrá volver a subir con próximas compras).
      const fullRedemption = remainingPoints <= 0;

      await tx
        .update(customerPointsTable)
        .set({
          points: Math.max(0, remainingPoints),
          lifetimeRedeemed: bal.lifetimeRedeemed + pointsToRedeem,
          ...(fullRedemption ? { tier: "bronze", lifetimeEarned: 0 } : {}),
        })
        .where(eq(customerPointsTable.customerId, customerId));

      await tx.insert(pointsTransactionsTable).values({
        customerId,
        delta: -pointsToRedeem,
        type: "redeemed",
        notes: fullRedemption
          ? `Canje de ${pointsToRedeem} puntos — descuento ${discountAmount}. ¡Canje total! Nivel reiniciado a Bronce`
          : `Canje de ${pointsToRedeem} puntos — descuento ${discountAmount}`,
      });

      if (fullRedemption && bal.tier && bal.tier !== "bronze") {
        await tx.insert(pointsTransactionsTable).values({
          customerId,
          delta: 0,
          type: "tier_down",
          notes: `Nivel reiniciado a Bronce: el cliente canjeó todos sus puntos y descuentos`,
        });
      }

      return {
        pointsRedeemed: pointsToRedeem,
        discountAmount,
        remainingPoints: Math.max(0, remainingPoints),
      };
    });

    res.json(result);
  } catch (err: any) {
    if (err.message?.includes("Puntos insuficientes")) {
      res.status(400).json({ message: err.message });
    } else {
      req.log.error({ err }, "RedeemPoints error");
      res.status(500).json({ message: "Error interno" });
    }
  }
});

// ── POST /api/loyalty/adjust ──────────────────────────────────────────────────
router.post("/adjust", async (req: AuthRequest, res) => {
  const { customerId, delta, notes } = req.body ?? {};
  if (!customerId || delta === undefined) {
    res.status(400).json({ message: "Datos inválidos" });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      const bal = await getOrCreateBalance(tx, customerId);
      const prevTier = bal.tier ?? "bronze";
      const newPoints = Math.max(0, bal.points + delta);
      const newLifetime = delta > 0 ? bal.lifetimeEarned + delta : bal.lifetimeEarned;
      const newTier = getTierForLifetime(newLifetime);
      const tieredUp = newTier !== prevTier && delta > 0;

      await tx
        .update(customerPointsTable)
        .set({ points: newPoints, lifetimeEarned: newLifetime, tier: newTier })
        .where(eq(customerPointsTable.customerId, customerId));

      await tx.insert(pointsTransactionsTable).values({
        customerId,
        delta,
        type: "adjusted",
        notes: notes ?? `Ajuste manual: ${delta > 0 ? "+" : ""}${delta} puntos`,
      });

      let couponCode: string | null = null;
      if (tieredUp && (newTier === "silver" || newTier === "gold")) {
        await tx.insert(pointsTransactionsTable).values({
          customerId,
          delta: 0,
          type: "tier_up",
          notes: `¡Nivel alcanzado: ${TIER_CONFIG[newTier].label}! Multiplicador ×${TIER_CONFIG[newTier].multiplier}`,
        });
        const coupon = await issueTierCoupon(tx, customerId, newTier);
        couponCode = coupon.code;
        await tx.insert(pointsTransactionsTable).values({
          customerId,
          delta: 0,
          type: "coupon",
          notes: `¡Cupón generado: ${coupon.code} — ${newTier === "gold" ? "10" : "5"}% de descuento!`,
        });
      }

      return { customerId, points: newPoints, delta, tier: newTier, tieredUp, couponCode };
    });

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "AdjustPoints error");
    res.status(500).json({ message: "Error interno" });
  }
});

export default router;
