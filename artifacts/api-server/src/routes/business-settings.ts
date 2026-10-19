import { Router } from "express";
import { db, businessSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { UpdateBusinessSettingsBody } from "@workspace/api-zod";
import { verifyToken, requireAdmin } from "../middlewares/auth";
import { syncCustomerLoyaltyPoints } from "./loyalty";

const router = Router();

function fmt(s: any) {
  return {
    id: s.id, companyName: s.companyName, rucNit: s.rucNit ?? null,
    phone: s.phone ?? null, email: s.email ?? null, address: s.address ?? null,
    logoUrl: s.logoUrl ?? null, currency: s.currency, currencySymbol: s.currencySymbol,
    loyaltyEnabled: s.loyaltyEnabled ?? false,
    pointsPerUnit: s.pointsPerUnit ?? 1,
    pointsRedemptionRate: Number(s.pointsRedemptionRate ?? 0.01),
    openCashDrawer: s.openCashDrawer ?? true,
    cashDrawerOnlyCash: s.cashDrawerOnlyCash ?? true,
    printerName: s.printerName ?? null,
    updatedAt: s.updatedAt instanceof Date ? s.updatedAt.toISOString() : s.updatedAt,
  };
}

function fmtPublic(s: any) {
  return { companyName: s.companyName, logoUrl: s.logoUrl ?? null };
}

async function ensureSettings() {
  const [existing] = await db.select().from(businessSettingsTable).limit(1);
  if (existing) {
    return existing;
  }
  const [created] = await db.insert(businessSettingsTable).values({ loyaltyEnabled: false }).returning();
  return created;
}

// Public branding data used by the login screen before authentication.
router.get("/public", async (req, res) => {
  try {
    const settings = await ensureSettings();
    res.json(fmtPublic(settings));
  } catch (err) { req.log.error({ err }, "GetPublicBusinessSettings error"); res.status(500).json({ message: "Error interno" }); }
});

router.use(verifyToken);

// GET — all authenticated roles
router.get("/", async (req, res) => {
  try {
    const settings = await ensureSettings();
    res.json(fmt(settings));
  } catch (err) { req.log.error({ err }, "GetBusinessSettings error"); res.status(500).json({ message: "Error interno" }); }
});

import { z } from "zod";

const updateSettingsSchema = z.object({
  companyName: z.string().min(1, "Razón social requerida").optional(),
  rucNit: z.string().nullish(),
  phone: z.string().nullish(),
  email: z.string().nullish(),
  address: z.string().nullish(),
  logoUrl: z.string().nullish(),
  currency: z.string().optional(),
  currencySymbol: z.string().optional(),
  loyaltyEnabled: z.boolean().optional(),
  pointsPerUnit: z.coerce.number().int().optional(),
  pointsRedemptionRate: z.coerce.number().optional(),
  openCashDrawer: z.boolean().optional(),
  cashDrawerOnlyCash: z.boolean().optional(),
  printerName: z.string().nullish(),
});

// PUT — admin only
router.put("/", requireAdmin, async (req, res) => {
  const parsed = updateSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ issues: parsed.error.issues }, "UpdateBusinessSettings validation failed");
    res.status(400).json({ message: "Datos inválidos", issues: parsed.error.issues });
    return;
  }
  try {
    const existing = await ensureSettings();
    const { pointsRedemptionRate, ...settingsData } = parsed.data;
    const [updated] = await db.update(businessSettingsTable)
      .set({
        ...settingsData,
        ...(pointsRedemptionRate === undefined ? {} : { pointsRedemptionRate: String(pointsRedemptionRate) }),
      })
      .where(eq(businessSettingsTable.id, existing.id))
      .returning();

    if (updated.loyaltyEnabled && !existing.loyaltyEnabled) {
      try {
        await syncCustomerLoyaltyPoints();
      } catch (syncErr) {
        req.log.warn({ err: syncErr }, "Failed to auto-sync loyalty points on enable");
      }
    }

    res.json(fmt(updated));
  } catch (err) { req.log.error({ err }, "UpdateBusinessSettings error"); res.status(500).json({ message: "Error interno" }); }
});

export default router;
