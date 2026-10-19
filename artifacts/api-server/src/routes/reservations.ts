import { Router } from "express";
import { z } from "zod/v4";
import {
  db, reservationsTable, reservationDetailsTable, productsTable, customersTable, usersTable,
  salesTable, saleDetailsTable, salePaymentsTable, cashRegisterSessionsTable,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { verifyToken, requireRoles, AuthRequest } from "../middlewares/auth";
import { auditLog } from "../lib/audit";
import { formatProductLabel } from "../lib/product-label";

const router = Router();
router.use(verifyToken);

const canManage = requireRoles(["admin", "diseñador", "vendedor"]);
const stageOrder = ["reserva", "produccion", "listo_entrega"] as const;
const reservationStageSchema = z.enum(stageOrder);

const createReservationSchema = z.object({
  customerId: z.number().int().positive().nullable().optional(),
  deposit: z.number().finite().nonnegative().max(9_999_999_999.99).default(0),
  depositMethod: z.string().trim().max(100).optional().nullable(),
  reservationDate: z.string().date().optional(),
  expectedAt: z.string().date().optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
  details: z.array(z.object({
    productId: z.number().int().positive(),
    specifications: z.string().trim().min(1).max(5000),
    quantity: z.number().int().positive(),
    unitPrice: z.number().finite().nonnegative().max(9_999_999_999.99),
  })).min(1),
});

const deliverSchema = z.object({
  cashRegisterSessionId: z.number().int().positive(),
  paymentMethod: z.string().trim().min(1).max(100),
  payments: z.array(z.object({
    paymentMethod: z.string().trim().min(1).max(100),
    amount: z.number().finite().positive().max(9_999_999_999.99),
  })).optional(),
  cashReceived: z.number().finite().nonnegative().optional(),
  discount: z.number().finite().nonnegative().max(9_999_999_999.99).optional().default(0),
});

function formatReservation(reservation: typeof reservationsTable.$inferSelect, details: Array<typeof reservationDetailsTable.$inferSelect>, customerName: string | null, customerPhone: string | null, userName: string | null) {
  return {
    id: reservation.id,
    customerId: reservation.customerId,
    customerName,
    customerPhone,
    userId: reservation.userId,
    userName,
    status: reservation.status,
    total: Number(reservation.total),
    deposit: Number(reservation.deposit),
    balance: Math.max(0, Number(reservation.total) - Number(reservation.deposit)),
    depositMethod: reservation.depositMethod,
    reservationDate: reservation.reservationDate,
    expectedAt: reservation.expectedAt,
    notes: reservation.notes,
    saleId: reservation.saleId,
    createdAt: reservation.createdAt.toISOString(),
    details: details.map((detail) => ({
      id: detail.id,
      productId: detail.productId,
      productName: detail.productName,
      specifications: detail.specifications,
      quantity: detail.quantity,
      unitPrice: Number(detail.unitPrice),
      subtotal: Number(detail.subtotal),
      status: detail.status,
    })),
  };
}

async function fetchReservation(id: number) {
  const [row] = await db.select({
    reservation: reservationsTable,
    customerName: customersTable.name,
    customerPhone: customersTable.phone,
    userName: usersTable.name,
  })
    .from(reservationsTable)
    .leftJoin(customersTable, eq(reservationsTable.customerId, customersTable.id))
    .leftJoin(usersTable, eq(reservationsTable.userId, usersTable.id))
    .where(eq(reservationsTable.id, id))
    .limit(1);
  if (!row) return null;
  const details = await db.select().from(reservationDetailsTable)
    .where(eq(reservationDetailsTable.reservationId, id))
    .orderBy(reservationDetailsTable.id);
  return formatReservation(row.reservation, details, row.customerName, row.customerPhone, row.userName);
}

// GET /api/reservations
router.get("/", requireRoles(["admin", "diseñador", "vendedor"]), async (req: AuthRequest, res) => {
  try {
    const statusQuery = typeof req.query.status === "string" ? req.query.status.trim() : null;
    const filterStatus = statusQuery || null;

    const baseQuery = db.select({
      reservation: reservationsTable,
      customerName: customersTable.name,
      customerPhone: customersTable.phone,
      userName: usersTable.name,
    })
      .from(reservationsTable)
      .leftJoin(customersTable, eq(reservationsTable.customerId, customersTable.id))
      .leftJoin(usersTable, eq(reservationsTable.userId, usersTable.id));

    const rows = filterStatus
      ? await baseQuery.where(eq(reservationsTable.status, filterStatus)).orderBy(sql`${reservationsTable.createdAt} DESC`)
      : await baseQuery.orderBy(sql`${reservationsTable.createdAt} DESC`);
    const details = rows.length
      ? await db.select().from(reservationDetailsTable)
        .where(inArray(reservationDetailsTable.reservationId, rows.map(({ reservation }) => reservation.id)))
        .orderBy(reservationDetailsTable.id)
      : [];
    const detailsByReservation = new Map<number, typeof details>();
    for (const detail of details) {
      const values = detailsByReservation.get(detail.reservationId) ?? [];
      values.push(detail);
      detailsByReservation.set(detail.reservationId, values);
    }
    res.json(rows.map(({ reservation, customerName, customerPhone, userName }) =>
      formatReservation(reservation, detailsByReservation.get(reservation.id) ?? [], customerName, customerPhone, userName)));
  } catch (err) {
    req.log.error({ err }, "GetReservations error");
    res.status(500).json({ message: "Error interno" });
  }
});

// GET /api/reservations/:id
router.get("/:id", requireRoles(["admin", "diseñador", "vendedor"]), async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) { res.status(400).json({ message: "Reserva inválida" }); return; }
  try {
    const reservation = await fetchReservation(id);
    if (!reservation) { res.status(404).json({ message: "Reserva no encontrada" }); return; }
    res.json(reservation);
  } catch (err) {
    req.log.error({ err }, "GetReservation error");
    res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/reservations
router.post("/", canManage, async (req: AuthRequest, res) => {
  const parsed = createReservationSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: "Datos inválidos", errors: parsed.error.flatten() }); return; }

  const { customerId, deposit, depositMethod, reservationDate, expectedAt, notes, details } = parsed.data;
  const productIds = [...new Set(details.map((detail) => detail.productId))];
  try {
    const products = await db.select().from(productsTable).where(inArray(productsTable.id, productIds));
    const productsById = new Map(products.map((product) => [product.id, product]));
    const missingProduct = productIds.find((productId) => !productsById.has(productId));
    if (missingProduct) { res.status(400).json({ message: `Producto ${missingProduct} no encontrado` }); return; }

    if (customerId) {
      const [customer] = await db.select({ id: customersTable.id }).from(customersTable)
        .where(eq(customersTable.id, customerId)).limit(1);
      if (!customer) { res.status(400).json({ message: "Cliente no encontrado" }); return; }
    }

    const normalizedDetails = details.map((detail) => {
      const unitPrice = Number(detail.unitPrice.toFixed(2));
      return {
        ...detail,
        unitPrice,
        subtotal: Number((unitPrice * detail.quantity).toFixed(2)),
      };
    });
    const roundedTotal = Number(normalizedDetails.reduce((sum, detail) => sum + detail.subtotal, 0).toFixed(2));
    const roundedDeposit = Number(deposit.toFixed(2));
    if (roundedDeposit > roundedTotal) {
      res.status(400).json({ message: "El adelanto no puede ser mayor al total de la reserva" });
      return;
    }

    const reservation = await db.transaction(async (tx) => {
      const [created] = await tx.insert(reservationsTable).values({
        customerId: customerId ?? null,
        userId: req.userId ?? null,
        total: roundedTotal.toFixed(2),
        deposit: roundedDeposit.toFixed(2),
        depositMethod: roundedDeposit > 0 ? depositMethod?.trim() || null : null,
        reservationDate,
        expectedAt: expectedAt ?? null,
        notes: notes?.trim() || null,
      }).returning();
      await tx.insert(reservationDetailsTable).values(normalizedDetails.map((detail) => {
        const product = productsById.get(detail.productId)!;
        return {
          reservationId: created.id,
          productId: product.id,
          productName: formatProductLabel(product),
          specifications: detail.specifications.trim(),
          quantity: detail.quantity,
          unitPrice: detail.unitPrice.toFixed(2),
          subtotal: detail.subtotal.toFixed(2),
        };
      }));
      return created;
    });

    const result = await fetchReservation(reservation.id);
    res.status(201).json(result);
    auditLog({
      req, action: "created", entity: "reservation", entityId: reservation.id,
      entityName: `Reserva #${reservation.id}`, details: { total: roundedTotal, deposit: roundedDeposit },
    });
  } catch (err) {
    req.log.error({ err }, "CreateReservation error");
    res.status(500).json({ message: "Error interno" });
  }
});

// PATCH /api/reservations/:id/details/:detailId/status
router.patch("/:id/details/:detailId/status", canManage, async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const detailId = Number(req.params.detailId);
  const parsed = z.object({ status: reservationStageSchema }).safeParse(req.body);
  if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(detailId) || detailId < 1 || !parsed.success) {
    res.status(400).json({ message: "Datos inválidos" });
    return;
  }

  try {
    const updated = await db.transaction(async (tx) => {
      const [reservation] = await tx.select().from(reservationsTable)
        .where(eq(reservationsTable.id, id)).for("update").limit(1);
      if (!reservation) return { error: "Reserva no encontrada", errorStatus: 404 as const };
      if (reservation.status === "entregada") return { error: "La reserva ya fue entregada", errorStatus: 409 as const };

      const [detail] = await tx.update(reservationDetailsTable)
        .set({ status: parsed.data.status, updatedAt: new Date() })
        .where(and(
          eq(reservationDetailsTable.id, detailId),
          eq(reservationDetailsTable.reservationId, id),
        ))
        .returning();
      if (!detail) return { error: "Producto de la reserva no encontrado", errorStatus: 404 as const };

      const allDetails = await tx.select({ status: reservationDetailsTable.status })
        .from(reservationDetailsTable)
        .where(eq(reservationDetailsTable.reservationId, id));
      const currentStage = stageOrder.find((stage) => allDetails.some((item) => item.status === stage)) ?? "reserva";
      await tx.update(reservationsTable).set({ status: currentStage, updatedAt: new Date() })
        .where(eq(reservationsTable.id, id));
      return { reservationId: id, status: currentStage };
    });

    if ("error" in updated) {
      if (typeof updated.errorStatus !== "number") throw new Error("Reservation update returned no HTTP status");
      res.status(updated.errorStatus).json({ message: updated.error });
      return;
    }
    const result = await fetchReservation(id);
    res.json(result);
    auditLog({
      req, action: "updated", entity: "reservation", entityId: id,
      entityName: `Reserva #${id}`, details: { detailId, status: parsed.data.status },
    });
  } catch (err) {
    req.log.error({ err }, "UpdateReservationStage error");
    res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/reservations/:id/deliver — record only the outstanding balance in the open cash register
router.post("/:id/deliver", requireRoles(["admin", "vendedor"]), async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const parsed = deliverSchema.safeParse(req.body);
  if (!Number.isSafeInteger(id) || id < 1 || !parsed.success) {
    res.status(400).json({ message: "Datos inválidos" });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [reservation] = await tx.select().from(reservationsTable)
        .where(eq(reservationsTable.id, id)).for("update").limit(1);
      if (!reservation) return { error: "Reserva no encontrada", errorStatus: 404 as const };
      if (reservation.saleId || reservation.status === "entregada") {
        return { error: "La reserva ya fue entregada", errorStatus: 409 as const };
      }

      const [session] = await tx.select({ id: cashRegisterSessionsTable.id })
        .from(cashRegisterSessionsTable)
        .where(and(
          eq(cashRegisterSessionsTable.id, parsed.data.cashRegisterSessionId),
          eq(cashRegisterSessionsTable.userId, req.userId!),
          eq(cashRegisterSessionsTable.status, "open"),
        ))
        .for("update")
        .limit(1);
      if (!session) return { error: "Abre tu caja antes de registrar la entrega", errorStatus: 409 as const };

      const details = await tx.select().from(reservationDetailsTable)
        .where(eq(reservationDetailsTable.reservationId, id))
        .orderBy(reservationDetailsTable.id);
      if (details.length === 0) return { error: "La reserva no tiene productos", errorStatus: 409 as const };

      const total = Number(reservation.total);
      const deposit = Number(reservation.deposit);
      const discount = Number((parsed.data.discount ?? 0).toFixed(2));
      const balance = Number(Math.max(0, total - deposit - discount).toFixed(2));
      const finalTotal = Number(Math.max(0, total - discount).toFixed(2));

      const splitPayments = (parsed.data.payments && parsed.data.payments.length > 0) ? parsed.data.payments : null;
      let effectivePaymentMethod = parsed.data.paymentMethod;
      let changeDue = 0;

      if (balance > 0) {
        if (splitPayments) {
          const splitTotal = Number(splitPayments.reduce((acc, p) => acc + p.amount, 0).toFixed(2));
          if (Math.abs(splitTotal - balance) > 0.05) {
            return { error: `La suma de los pagos divididos (${splitTotal.toFixed(2)}) no coincide con el saldo (${balance.toFixed(2)})`, errorStatus: 400 as const };
          }
          effectivePaymentMethod = splitPayments.map((p) => p.paymentMethod).join(" / ");
          const cashPayment = splitPayments.find((p) => p.paymentMethod.toLowerCase().includes("efectivo"));
          if (cashPayment) {
            const cashRcv = parsed.data.cashReceived !== undefined ? parsed.data.cashReceived : cashPayment.amount;
            if (cashRcv < cashPayment.amount) {
              return { error: `El efectivo recibido (${cashRcv.toFixed(2)}) es menor al monto en efectivo (${cashPayment.amount.toFixed(2)})`, errorStatus: 400 as const };
            }
            changeDue = Number((cashRcv - cashPayment.amount).toFixed(2));
          }
        } else {
          const isCashPayment = parsed.data.paymentMethod.toLowerCase().includes("efectivo");
          const cashReceived = parsed.data.cashReceived ?? balance;
          if (isCashPayment && cashReceived < balance) {
            return { error: "El monto recibido no cubre el saldo pendiente", errorStatus: 400 as const };
          }
          changeDue = isCashPayment ? Number((cashReceived - balance).toFixed(2)) : 0;
        }
      } else {
        effectivePaymentMethod = "Adelanto de reserva";
      }

      const notes = [
        reservation.notes,
        `Entrega de reserva #${id}`,
        `Adelanto recibido previamente: ${deposit.toFixed(2)}`,
        discount > 0 ? `Descuento aplicado en entrega: ${discount.toFixed(2)}` : null,
      ].filter(Boolean).join(" | ");

      const [sale] = await tx.insert(salesTable).values({
        customerId: reservation.customerId,
        userId: req.userId ?? null,
        subtotal: total.toFixed(2),
        discount: discount.toFixed(2),
        iva: "0.00",
        total: finalTotal.toFixed(2),
        paymentMethod: effectivePaymentMethod,
        cashRegisterSessionId: parsed.data.cashRegisterSessionId,
        amountPaid: balance.toFixed(2),
        changeDue: changeDue.toFixed(2),
        notes,
      }).returning();

      await tx.insert(saleDetailsTable).values(details.map((detail) => ({
        saleId: sale.id,
        productId: detail.productId,
        productName: detail.productName,
        quantity: detail.quantity,
        unitPrice: detail.unitPrice,
        subtotal: detail.subtotal,
      })));

      if (balance > 0) {
        if (splitPayments) {
          for (const sp of splitPayments) {
            await tx.insert(salePaymentsTable).values({
              saleId: sale.id,
              paymentMethod: sp.paymentMethod,
              amount: sp.amount.toFixed(2),
            });
          }
        } else {
          await tx.insert(salePaymentsTable).values({
            saleId: sale.id,
            paymentMethod: parsed.data.paymentMethod,
            amount: balance.toFixed(2),
          });
        }
      }

      await tx.update(reservationsTable)
        .set({ status: "entregada", saleId: sale.id, updatedAt: new Date() })
        .where(eq(reservationsTable.id, id));
      await tx.update(reservationDetailsTable)
        .set({ status: "entregada", updatedAt: new Date() })
        .where(eq(reservationDetailsTable.reservationId, id));
      return {
        sale,
        balance,
        changeDue,
        effectivePaymentMethod,
        payments: splitPayments ?? (balance > 0 ? [{ paymentMethod: parsed.data.paymentMethod, amount: balance }] : []),
      };
    });

    if ("error" in result) {
      if (typeof result.errorStatus !== "number") throw new Error("Reservation delivery returned no HTTP status");
      res.status(result.errorStatus).json({ message: result.error });
      return;
    }
    const customerId = result.sale.customerId;
    const [customer] = customerId
      ? await db.select({ name: customersTable.name }).from(customersTable)
        .where(eq(customersTable.id, customerId)).limit(1)
      : [undefined];
    const saleDetails = await db.select().from(saleDetailsTable).where(eq(saleDetailsTable.saleId, result.sale.id));
    res.status(201).json({
      id: result.sale.id,
      customerId: result.sale.customerId,
      customerName: customer?.name ?? null,
      userId: result.sale.userId,
      userName: req.userName ?? null,
      subtotal: Number(result.sale.subtotal),
      discount: Number(result.sale.discount ?? 0),
      iva: Number(result.sale.iva),
      total: Number(result.sale.total),
      paymentMethod: result.effectivePaymentMethod,
      payments: result.payments,
      amountPaid: result.balance,
      changeDue: result.changeDue,
      status: result.sale.status,
      notes: result.sale.notes,
      createdAt: result.sale.createdAt.toISOString(),
      details: saleDetails.map((detail) => ({
        id: detail.id, productId: detail.productId, productName: detail.productName,
        quantity: detail.quantity, unitPrice: Number(detail.unitPrice), subtotal: Number(detail.subtotal),
      })),
      pointsEarned: 0,
    });
    auditLog({
      req, action: "updated", entity: "reservation", entityId: id,
      entityName: `Reserva #${id}`, details: { saleId: result.sale.id, balance: result.balance },
    });
  } catch (err) {
    req.log.error({ err }, "DeliverReservation error");
    res.status(500).json({ message: "Error interno" });
  }
});

export default router;
