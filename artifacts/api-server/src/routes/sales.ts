import { Router } from "express";
import {
  db, salesTable, saleDetailsTable, productsTable,
  customersTable, usersTable, businessSettingsTable,
  customerPointsTable, pointsTransactionsTable, getTierForLifetime,
  cashRegisterSessionsTable, salePaymentsTable,
} from "@workspace/db";
import { eq, gte, lte, and, sql, inArray } from "drizzle-orm";
import { CreateSaleBody } from "@workspace/api-zod";
import { verifyToken, requireRoles, requireAdmin, AuthRequest } from "../middlewares/auth";
import { awardPointsForSale, getOrCreateBalance } from "./loyalty";
import { auditLog } from "../lib/audit";
import { formatProductLabel } from "../lib/product-label";
import { sendSaleReceiptEmail } from "../lib/mailer";

const router = Router();
router.use(verifyToken);

const canCreate = requireRoles(["admin", "vendedor"]);

const IVA_RATE = 0;

class SaleRequestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

function formatSale(
  s: any,
  customerName?: string | null,
  userName?: string | null,
  customerNitCi?: string | null,
  customerPhone?: string | null,
  payments?: Array<{ paymentMethod: string; amount: number }>
) {
  return {
    id: s.id, customerId: s.customerId ?? null, customerName: customerName ?? null,
    customerNitCi: customerNitCi ?? null, customerPhone: customerPhone ?? null,
    userId: s.userId ?? null, userName: userName ?? null,
    subtotal: Number(s.subtotal), iva: Number(s.iva), total: Number(s.total),
    paymentMethod: s.paymentMethod,
    payments: payments?.length ? payments : undefined,
    amountPaid: s.amountPaid !== null && s.amountPaid !== undefined ? Number(s.amountPaid) : null,
    changeDue: s.changeDue !== null && s.changeDue !== undefined ? Number(s.changeDue) : null,
    status: s.status, notes: s.notes ?? null,
    createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
  };
}

async function getSalePayments(saleIds: number[]) {
  if (saleIds.length === 0) return new Map<number, Array<{ paymentMethod: string; amount: number }>>();
  const rows = await db.select().from(salePaymentsTable).where(inArray(salePaymentsTable.saleId, saleIds));
  const result = new Map<number, Array<{ paymentMethod: string; amount: number }>>();
  for (const row of rows) {
    const payments = result.get(row.saleId) ?? [];
    payments.push({ paymentMethod: row.paymentMethod, amount: Number(row.amount) });
    result.set(row.saleId, payments);
  }
  return result;
}

// GET /api/sales
router.get("/", async (req: AuthRequest, res) => {
  const { dateFrom, dateTo, customerId, userId } = req.query as any;
  try {
    const rows = await db
      .select({
        sale: salesTable,
        customerName: customersTable.name,
        customerNitCi: customersTable.nitCi,
        customerPhone: customersTable.phone,
        userName: usersTable.name,
      })
      .from(salesTable)
      .leftJoin(customersTable, eq(salesTable.customerId, customersTable.id))
      .leftJoin(usersTable, eq(salesTable.userId, usersTable.id))
      .where(
        and(
          dateFrom ? gte(salesTable.createdAt, new Date(dateFrom)) : undefined,
          dateTo ? lte(salesTable.createdAt, new Date(new Date(dateTo).getTime() + 86399999)) : undefined,
          customerId ? eq(salesTable.customerId, Number(customerId)) : undefined,
          userId ? eq(salesTable.userId, Number(userId)) : undefined,
        )
      )
      .orderBy(sql`${salesTable.createdAt} DESC`);

    const paymentMap = await getSalePayments(rows.map(({ sale }) => sale.id));
    res.json(rows.map(r => formatSale(r.sale, r.customerName, r.userName, r.customerNitCi, r.customerPhone, paymentMap.get(r.sale.id))));
  } catch (err) {
    req.log.error({ err }, "GetSales error");
    res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/sales — vendedor + admin
router.post("/", canCreate, async (req: AuthRequest, res) => {
  const parsed = CreateSaleBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: "Datos inválidos" }); return; }

  const { customerId, items, paymentMethod, notes, amountPaid, changeDue, payments, cashRegisterSessionId } = parsed.data;
  if (!cashRegisterSessionId) {
    res.status(409).json({ message: "Abre tu caja antes de registrar una venta" });
    return;
  }

  try {
    const productIds = items.map(i => i.productId);
    const products = await db.select().from(productsTable).where(
      sql`${productsTable.id} = ANY(${sql.raw(`ARRAY[${productIds.join(",")}]::int[]`)})`
    );
    const productMap = new Map(products.map(p => [p.id, p]));

    for (const item of items) {
      const p = productMap.get(item.productId);
      if (!p) { res.status(400).json({ message: `Producto ${item.productId} no encontrado` }); return; }
      if (p.stock < item.quantity) {
        res.status(400).json({ message: `Stock insuficiente para ${p.name}. Disponible: ${p.stock}` });
        return;
      }
    }

    const discount = Math.max(0, Number((req.body as any).discount ?? 0));
    const grossSubtotal = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
    const subtotal = Math.max(0, grossSubtotal - discount);
    const iva = 0;
    const total = +subtotal.toFixed(2);
    const roundedPayments = payments?.map((payment) => ({
      paymentMethod: payment.paymentMethod.trim(),
      amount: +payment.amount.toFixed(2),
    }));
    if (roundedPayments && (
      roundedPayments.some((payment) => !payment.paymentMethod || payment.amount <= 0) ||
      Math.abs(roundedPayments.reduce((sum, payment) => sum + payment.amount, 0) - total) >= 0.01
    )) {
      res.status(400).json({ message: "La suma de los pagos debe coincidir con el total de la venta" });
      return;
    }
    const finalPayments = roundedPayments ?? [{ paymentMethod, amount: total }];
    const finalPaymentMethod = roundedPayments
      ? roundedPayments.length > 1 ? "Pago combinado" : roundedPayments[0].paymentMethod
      : paymentMethod;

    const result = await db.transaction(async (tx) => {
      if (cashRegisterSessionId) {
        const [session] = await tx.select({ id: cashRegisterSessionsTable.id })
          .from(cashRegisterSessionsTable)
          .where(and(
            eq(cashRegisterSessionsTable.id, cashRegisterSessionId),
            eq(cashRegisterSessionsTable.userId, req.userId!),
            eq(cashRegisterSessionsTable.status, "open"),
          ))
          .for("update")
          .limit(1);
        if (!session) throw new SaleRequestError("Abre tu caja antes de registrar una venta", 409);
      }
      const [sale] = await tx.insert(salesTable).values({
        customerId: customerId ?? null,
        userId: req.userId ?? null,
        subtotal: String(subtotal.toFixed(2)),
        discount: String(discount.toFixed(2)),
        iva: String(iva.toFixed(2)),
        total: String(total.toFixed(2)),
        paymentMethod: finalPaymentMethod,
        cashRegisterSessionId: cashRegisterSessionId ?? null,
        amountPaid: amountPaid !== null && amountPaid !== undefined ? String(Number(amountPaid).toFixed(2)) : null,
        changeDue: changeDue !== null && changeDue !== undefined ? String(Number(changeDue).toFixed(2)) : null,
        notes: notes ?? null,
      }).returning();
      await tx.insert(salePaymentsTable).values(finalPayments.map((payment) => ({
        saleId: sale.id,
        paymentMethod: payment.paymentMethod,
        amount: String(payment.amount.toFixed(2)),
      })));

      for (const item of items) {
        const p = productMap.get(item.productId)!;
        await tx.insert(saleDetailsTable).values({
          saleId: sale.id, productId: item.productId, productName: formatProductLabel(p),
          quantity: item.quantity, unitPrice: String(item.unitPrice.toFixed(2)),
          subtotal: String((item.unitPrice * item.quantity).toFixed(2)),
        });
        await tx.update(productsTable)
          .set({ stock: p.stock - item.quantity })
          .where(eq(productsTable.id, item.productId));
      }
      return sale;
    });

    let customerName: string | null = null;
    let customerNitCi: string | null = null;
    let customerPhone: string | null = null;
    if (customerId) {
      const [c] = await db
        .select({
          name: customersTable.name,
          nitCi: customersTable.nitCi,
          phone: customersTable.phone,
        })
        .from(customersTable)
        .where(eq(customersTable.id, customerId))
        .limit(1);
      customerName = c?.name ?? null;
      customerNitCi = c?.nitCi ?? null;
      customerPhone = c?.phone ?? null;
    }

    let pointsEarned = 0;
    try {
      const [settings] = await db.select().from(businessSettingsTable).limit(1);
      const loyaltyActive = Boolean(settings?.loyaltyEnabled);
      // Regla de negocio: si el cliente canjeó su descuento en esta venta,
      // no se le asignan puntos ni descuento adicional.
      const saleHadRedemption = Math.max(0, Number((req.body as any).discount ?? 0)) > 0;
      if (loyaltyActive && customerId && !saleHadRedemption) {
        const pointsPerUnit = Number(settings?.pointsPerUnit ?? 1);
        const pointsRes = await awardPointsForSale(customerId, result.id, Number(result.total), pointsPerUnit);
        pointsEarned = typeof pointsRes === "object" && pointsRes ? pointsRes.earned : Number(pointsRes) || 0;
      }
    } catch (pointsErr) {
      req.log.warn({ err: pointsErr }, "Failed to award loyalty points (non-fatal)");
    }

    res.status(201).json({
      ...formatSale(result, customerName, null, customerNitCi, customerPhone, finalPayments),
      pointsEarned,
    });
    auditLog({
      req, action: "created", entity: "sale", entityId: result.id,
      entityName: customerName ?? `Venta #${result.id}`,
      details: { total: Number(result.total), paymentMethod, items: items.length },
    });
  } catch (err) {
    if (err instanceof SaleRequestError) {
      res.status(err.status).json({ message: err.message });
      return;
    }
    req.log.error({ err }, "CreateSale error");
    res.status(500).json({ message: "Error interno" });
  }
});

// GET /api/sales/:id
router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const [row] = await db
      .select({
        sale: salesTable,
        customerName: customersTable.name,
        customerNitCi: customersTable.nitCi,
        customerPhone: customersTable.phone,
        userName: usersTable.name,
      })
      .from(salesTable)
      .leftJoin(customersTable, eq(salesTable.customerId, customersTable.id))
      .leftJoin(usersTable, eq(salesTable.userId, usersTable.id))
      .where(eq(salesTable.id, id))
      .limit(1);

    if (!row) { res.status(404).json({ message: "Venta no encontrada" }); return; }

    const details = await db.select().from(saleDetailsTable).where(eq(saleDetailsTable.saleId, id));

    let pointsEarned = 0;
    if (row.sale.customerId) {
      const [tx] = await db
        .select({ delta: pointsTransactionsTable.delta })
        .from(pointsTransactionsTable)
        .where(
          and(
            eq(pointsTransactionsTable.saleId, id),
            eq(pointsTransactionsTable.type, "earned")
          )
        )
        .limit(1);
      pointsEarned = tx?.delta ?? 0;
    }

    const paymentMap = await getSalePayments([id]);
    res.json({
      ...formatSale(row.sale, row.customerName, row.userName, row.customerNitCi, row.customerPhone, paymentMap.get(id)),
      pointsEarned,
      details: details.map(d => ({
        id: d.id, productId: d.productId ?? null, productName: d.productName,
        quantity: d.quantity, unitPrice: Number(d.unitPrice), subtotal: Number(d.subtotal),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "GetSaleById error");
    res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/sales/:id/email - enviar boleta al correo del cliente
router.post("/:id/email", async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const { pdfBase64 } = req.body as { pdfBase64?: unknown };

  if (!Number.isInteger(id) || typeof pdfBase64 !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(pdfBase64) || pdfBase64.length > 14_000_000) {
    res.status(400).json({ message: "PDF inválido" });
    return;
  }

  try {
    const [row] = await db
      .select({
        sale: salesTable,
        customerName: customersTable.name,
        customerEmail: customersTable.email,
      })
      .from(salesTable)
      .leftJoin(customersTable, eq(salesTable.customerId, customersTable.id))
      .where(eq(salesTable.id, id))
      .limit(1);

    if (!row) { res.status(404).json({ message: "Venta no encontrada" }); return; }
    if (!row.customerEmail) { res.status(400).json({ message: "El cliente no tiene un correo registrado" }); return; }

    const [settings] = await db.select().from(businessSettingsTable).limit(1);
    await sendSaleReceiptEmail({
      to: row.customerEmail,
      customerName: row.customerName ?? "cliente",
      saleId: id,
      total: Number(row.sale.total),
      companyName: settings?.companyName ?? "Punto de Venta",
      pdf: Buffer.from(pdfBase64, "base64"),
    });

    res.json({ message: "Boleta enviada correctamente" });
  } catch (err: any) {
    req.log.error({ err, saleId: id }, "SendSaleReceiptEmail error");
    res.status(500).json({ message: err?.message || "No se pudo enviar la boleta por correo" });
  }
});

// POST /api/sales/:id/cancel — admin only
router.post("/:id/cancel", requireAdmin, async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  try {
    const [sale] = await db.select().from(salesTable).where(eq(salesTable.id, id)).limit(1);
    if (!sale) { res.status(404).json({ message: "Venta no encontrada" }); return; }
    if (sale.status === "cancelada") { res.status(400).json({ message: "La venta ya está cancelada" }); return; }

    const details = await db.select().from(saleDetailsTable).where(eq(saleDetailsTable.saleId, id));

    await db.transaction(async (tx) => {
      await tx.update(salesTable).set({ status: "cancelada" }).where(eq(salesTable.id, id));
      for (const d of details) {
        if (d.productId) {
          await tx.update(productsTable)
            .set({ stock: sql`${productsTable.stock} + ${d.quantity}` })
            .where(eq(productsTable.id, d.productId));
        }
      }

      if (sale.customerId) {
        const [earnedTx] = await tx
          .select()
          .from(pointsTransactionsTable)
          .where(
            and(
              eq(pointsTransactionsTable.saleId, id),
              eq(pointsTransactionsTable.type, "earned")
            )
          )
          .limit(1);

        if (earnedTx && earnedTx.delta > 0) {
          const bal = await getOrCreateBalance(tx, sale.customerId);
          const newPoints = Math.max(0, bal.points - earnedTx.delta);
          const newLifetime = Math.max(0, bal.lifetimeEarned - earnedTx.delta);
          const newTier = getTierForLifetime(newLifetime);
          await tx.update(customerPointsTable).set({
            points: newPoints,
            lifetimeEarned: newLifetime,
            tier: newTier,
          }).where(eq(customerPointsTable.customerId, sale.customerId));

          await tx.insert(pointsTransactionsTable).values({
            customerId: sale.customerId,
            delta: -earnedTx.delta,
            type: "adjusted",
            saleId: id,
            notes: `Reversión por cancelación de venta #${String(id).padStart(6, "0")}`,
          });
        }
      }
    });

    res.json({ message: "Venta cancelada y stock restaurado" });
    auditLog({ req, action: "cancelled", entity: "sale", entityId: id, entityName: `Venta #${id}`, details: { total: Number(sale.total) } });
  } catch (err) {
    req.log.error({ err }, "CancelSale error");
    res.status(500).json({ message: "Error interno" });
  }
});

export default router;
