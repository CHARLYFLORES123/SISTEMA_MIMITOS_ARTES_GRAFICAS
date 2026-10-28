import { Router } from "express";
import {
  db,
  salesTable,
  saleDetailsTable,
  productsTable,
  categoriesTable,
  usersTable,
  reservationsTable,
  reservationPaymentsTable,
  reservationDetailsTable,
  customersTable,
} from "@workspace/db";
import { eq, gte, lte, and, or, count, sum, sql, desc, inArray } from "drizzle-orm";
import { verifyToken } from "../middlewares/auth";

const router = Router();
router.use(verifyToken);

function parseDateRange(query: any) {
  const { dateFrom, dateTo } = query;
  let from: Date | undefined;
  let to: Date | undefined;
  if (dateFrom) {
    from = new Date(dateFrom.includes("T") ? dateFrom : `${dateFrom}T00:00:00`);
  }
  if (dateTo) {
    to = new Date(dateTo.includes("T") ? dateTo : `${dateTo}T23:59:59.999`);
  }
  return { from, to };
}

function getLocalDateKey(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeDateStr(val: any, fallback: Date): string {
  if (!val) return getLocalDateKey(fallback);
  if (val instanceof Date) return getLocalDateKey(val);
  const s = String(val).trim();
  if (s.includes("T")) return s.split("T")[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(val);
  if (!isNaN(d.getTime())) return getLocalDateKey(d);
  return getLocalDateKey(fallback);
}

// GET /api/reports/sales-by-seller-daily — Ventas y adelantos por vendedor por día con productos
router.get("/sales-by-seller-daily", async (req, res) => {
  const { from, to } = parseDateRange(req.query);
  const userId = req.query.userId ? Number(req.query.userId) : undefined;
  const dateFromStr = typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined;
  const dateToStr = typeof req.query.dateTo === "string" ? req.query.dateTo : undefined;

  try {
    // 0. Obtener entregas de reservas en salesTable para no duplicarlas como ventas directas
    const deliveredReservations = await db
      .select({ saleId: reservationsTable.saleId })
      .from(reservationsTable)
      .where(sql`${reservationsTable.saleId} IS NOT NULL`);
    const deliveredSaleIdSet = new Set<number>(
      deliveredReservations.map((r) => r.saleId!).filter(Boolean)
    );

    // 1. Obtener ventas completadas
    const rows = await db
      .select({
        saleId: salesTable.id,
        saleTotal: salesTable.total,
        saleCreatedAt: salesTable.createdAt,
        saleNotes: salesTable.notes,
        userId: salesTable.userId,
        userName: usersTable.name,
        userRole: usersTable.role,
        productId: saleDetailsTable.productId,
        productName: saleDetailsTable.productName,
        quantity: saleDetailsTable.quantity,
        unitPrice: saleDetailsTable.unitPrice,
        itemSubtotal: saleDetailsTable.subtotal,
      })
      .from(salesTable)
      .leftJoin(usersTable, eq(salesTable.userId, usersTable.id))
      .leftJoin(saleDetailsTable, eq(saleDetailsTable.saleId, salesTable.id))
      .where(
        and(
          eq(salesTable.status, "completada"),
          from ? gte(salesTable.createdAt, from) : undefined,
          to ? lte(salesTable.createdAt, to) : undefined,
          userId ? eq(salesTable.userId, userId) : undefined,
        )
      )
      .orderBy(desc(salesTable.createdAt), desc(salesTable.id));

    // 2. Obtener reservas (adelantos y saldo a cobrar)
    const depositConditions = [
      sql`CAST(${reservationsTable.total} AS numeric) > 0`,
      sql`${reservationsTable.status} != 'cancelada'`,
      sql`${reservationsTable.depositRefunded} = false`,
      sql`NOT EXISTS (SELECT 1 FROM sales s WHERE s.id = ${reservationsTable.saleId} AND s.status = 'cancelada')`,
    ];
    if (userId) {
      depositConditions.push(eq(reservationsTable.userId, userId));
    }

    const dateFilters = [];
    if (from && to) {
      dateFilters.push(and(gte(reservationsTable.createdAt, from), lte(reservationsTable.createdAt, to)));
    } else if (from) {
      dateFilters.push(gte(reservationsTable.createdAt, from));
    } else if (to) {
      dateFilters.push(lte(reservationsTable.createdAt, to));
    }

    if (dateFromStr && dateToStr) {
      dateFilters.push(
        and(
          sql`CAST(${reservationsTable.reservationDate} AS text) >= ${dateFromStr}`,
          sql`CAST(${reservationsTable.reservationDate} AS text) <= ${dateToStr}`
        )
      );
    } else if (dateFromStr) {
      dateFilters.push(sql`CAST(${reservationsTable.reservationDate} AS text) >= ${dateFromStr}`);
    } else if (dateToStr) {
      dateFilters.push(sql`CAST(${reservationsTable.reservationDate} AS text) <= ${dateToStr}`);
    }

    if (dateFilters.length > 0) {
      depositConditions.push(or(...dateFilters)!);
    }

    const depositRows = await db
      .select({
        reservationId: reservationsTable.id,
        customerId: reservationsTable.customerId,
        customerName: customersTable.name,
        userId: reservationsTable.userId,
        userName: usersTable.name,
        userRole: usersTable.role,
        deposit: reservationsTable.deposit,
        total: reservationsTable.total,
        depositMethod: reservationsTable.depositMethod,
        reservationDate: reservationsTable.reservationDate,
        createdAt: reservationsTable.createdAt,
        status: reservationsTable.status,
        saleId: reservationsTable.saleId,
      })
      .from(reservationsTable)
      .leftJoin(usersTable, eq(reservationsTable.userId, usersTable.id))
      .leftJoin(customersTable, eq(reservationsTable.customerId, customersTable.id))
      .where(and(...depositConditions))
      .orderBy(desc(reservationsTable.createdAt), desc(reservationsTable.id));

    // Obtener lista completa de vendedores para el selector
    const sellersList = await db
      .select({ id: usersTable.id, name: usersTable.name, role: usersTable.role })
      .from(usersTable)
      .where(
        or(
          eq(usersTable.role, "vendedor"),
          eq(usersTable.role, "admin"),
          eq(usersTable.role, "diseñador")
        )
      )
      .orderBy(usersTable.name);

    interface ProductItem {
      productId: number | null;
      productName: string;
      quantity: number;
      subtotal: number;
    }

    interface DepositItem {
      reservationId: number;
      customerName: string;
      deposit: number;
      balance: number;
      total: number;
      depositMethod: string;
      status: string;
      date: string;
    }

    interface DayGroup {
      date: string;
      userId: number;
      userName: string;
      userRole: string;
      salesCount: number;
      totalAmount: number;
      depositsCount: number;
      depositsAmount: number;
      balancesAmount: number;
      grandTotal: number;
      saleIds: Set<number>;
      reservationIds: Set<number>;
      productsMap: Map<string, ProductItem>;
      depositsList: DepositItem[];
    }

    const groups = new Map<string, DayGroup>();

    const getOrCreateGroup = (dateKey: string, uid: number, uName: string | null, uRole: string | null): DayGroup => {
      const key = `${dateKey}_${uid}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          date: dateKey,
          userId: uid,
          userName: uName ?? "Sin vendedor asignado",
          userRole: uRole ?? "vendedor",
          salesCount: 0,
          totalAmount: 0,
          depositsCount: 0,
          depositsAmount: 0,
          balancesAmount: 0,
          grandTotal: 0,
          saleIds: new Set<number>(),
          reservationIds: new Set<number>(),
          productsMap: new Map<string, ProductItem>(),
          depositsList: [],
        };
        groups.set(key, group);
      }
      return group;
    };

    // Procesar filas de ventas directas (excluyendo entregas de reserva para evitar doble conteo)
    for (const row of rows) {
      const isResvDelivery =
        deliveredSaleIdSet.has(row.saleId) ||
        Boolean(row.saleNotes && row.saleNotes.includes("Entrega de reserva #"));
      if (isResvDelivery) continue;

      const dateKey = getLocalDateKey(new Date(row.saleCreatedAt));
      const uid = row.userId ?? 0;
      const group = getOrCreateGroup(dateKey, uid, row.userName, row.userRole);

      if (!group.saleIds.has(row.saleId)) {
        group.saleIds.add(row.saleId);
        group.salesCount += 1;
        group.totalAmount += Number(row.saleTotal || 0);
      }

      if (row.productName) {
        const prodKey = `${row.productId ?? ""}_${row.productName}`;
        let prod = group.productsMap.get(prodKey);
        if (!prod) {
          prod = {
            productId: row.productId ?? null,
            productName: row.productName,
            quantity: 0,
            subtotal: 0,
          };
          group.productsMap.set(prodKey, prod);
        }
        prod.quantity += Number(row.quantity || 0);
        prod.subtotal += Number(row.itemSubtotal || 0);
      }
    }

    // Procesar filas de reservas (adelantos y saldos a cobrar)
    for (const depRow of depositRows) {
      const dateKey = normalizeDateStr(depRow.reservationDate, new Date(depRow.createdAt));
      const uid = depRow.userId ?? 0;
      const group = getOrCreateGroup(dateKey, uid, depRow.userName, depRow.userRole);

      if (!group.reservationIds.has(depRow.reservationId)) {
        group.reservationIds.add(depRow.reservationId);
        const depAmt = Number(depRow.deposit || 0);
        const totAmt = Number(depRow.total || 0);
        const balAmt = Math.max(0, totAmt - depAmt);
        // Solo sumar el saldo a cobrar cuando la reserva está Entregada (y por tanto cobrada).
        // Si no está entregada, el saldo queda pendiente y solo se cuenta el adelanto.
        const isDelivered = depRow.status === "entregada" || Boolean(depRow.saleId);

        group.depositsCount += 1;
        group.depositsAmount += depAmt;
        group.balancesAmount += isDelivered ? balAmt : 0;
        group.depositsList.push({
          reservationId: depRow.reservationId,
          customerName: depRow.customerName || "Sin cliente",
          deposit: depAmt,
          balance: Number(balAmt.toFixed(2)),
          total: totAmt,
          depositMethod: depRow.depositMethod || "Efectivo",
          status: depRow.status,
          date: dateKey,
        });
      }
    }

    // Incluir productos de las reservas en el desglose de productos del día
    const resIds = depositRows.map((r) => r.reservationId);
    if (resIds.length > 0) {
      const resDetails = await db
        .select({
          reservationId: reservationDetailsTable.reservationId,
          productId: reservationDetailsTable.productId,
          productName: reservationDetailsTable.productName,
          quantity: reservationDetailsTable.quantity,
          subtotal: reservationDetailsTable.subtotal,
        })
        .from(reservationDetailsTable)
        .where(inArray(reservationDetailsTable.reservationId, resIds));

      const resMeta = new Map<number, { dateKey: string; uid: number }>();
      for (const depRow of depositRows) {
        const dateKey = normalizeDateStr(depRow.reservationDate, new Date(depRow.createdAt));
        const uid = depRow.userId ?? 0;
        resMeta.set(depRow.reservationId, { dateKey, uid });
      }

      for (const rd of resDetails) {
        const meta = resMeta.get(rd.reservationId);
        if (!meta || !rd.productName) continue;
        const group = groups.get(`${meta.dateKey}_${meta.uid}`);
        if (!group) continue;

        const prodKey = `${rd.productId ?? ""}_${rd.productName}`;
        let prod = group.productsMap.get(prodKey);
        if (!prod) {
          prod = {
            productId: rd.productId ?? null,
            productName: rd.productName,
            quantity: 0,
            subtotal: 0,
          };
          group.productsMap.set(prodKey, prod);
        }
        prod.quantity += Number(rd.quantity || 0);
        prod.subtotal += Number(rd.subtotal || 0);
      }
    }

    // Calcular grandTotal y mapear lista diaria (Suma únicamente Monto Adelanto + Saldo a cobrar de Reservas = Total de Reserva)
    const daily = Array.from(groups.values()).map((g) => {
      const totalAmount = Number(g.totalAmount.toFixed(2));
      const depositsAmount = Number(g.depositsAmount.toFixed(2));
      const balancesAmount = Number(g.balancesAmount.toFixed(2));
      const grandTotal = Number((depositsAmount + balancesAmount).toFixed(2));
      return {
        date: g.date,
        userId: g.userId,
        userName: g.userName,
        userRole: g.userRole,
        salesCount: g.salesCount,
        totalAmount,
        depositsCount: g.depositsCount,
        depositsAmount,
        balancesAmount,
        grandTotal,
        products: Array.from(g.productsMap.values())
          .map((p) => ({
            productId: p.productId,
            productName: p.productName,
            quantity: p.quantity,
            subtotal: Number(p.subtotal.toFixed(2)),
          }))
          .sort((a, b) => b.quantity - a.quantity),
        deposits: g.depositsList.sort((a, b) => b.reservationId - a.reservationId),
      };
    }).sort((a, b) => b.date.localeCompare(a.date) || b.grandTotal - a.grandTotal);

    let totalRevenue = 0;
    let totalSales = 0;
    let totalDepositsAmount = 0;
    let totalDepositsCount = 0;
    let totalBalancesAmount = 0;
    let totalProducts = 0;
    const activeSellersSet = new Set<number>();

    for (const d of daily) {
      totalRevenue += d.totalAmount;
      totalSales += d.salesCount;
      totalDepositsAmount += d.depositsAmount;
      totalDepositsCount += d.depositsCount;
      totalBalancesAmount += d.balancesAmount;
      if (d.userId) activeSellersSet.add(d.userId);
      for (const p of d.products) {
        totalProducts += p.quantity;
      }
    }

    res.json({
      daily,
      summary: {
        totalRevenue: Number(totalRevenue.toFixed(2)),
        totalSales,
        totalDepositsAmount: Number(totalDepositsAmount.toFixed(2)),
        totalDepositsCount,
        totalBalancesAmount: Number(totalBalancesAmount.toFixed(2)),
        grandTotalCollected: Number((totalDepositsAmount + totalBalancesAmount).toFixed(2)),
        totalProducts,
        activeSellersCount: activeSellersSet.size,
      },
      sellers: sellersList,
    });
  } catch (err) {
    req.log.error({ err }, "ReportSalesBySellerDaily error");
    res.status(500).json({ message: "Error interno" });
  }
});

// GET /api/reports/reservation-deposits — Detalle completo de adelantos recibidos en reservas
router.get("/reservation-deposits", async (req, res) => {
  const { from, to } = parseDateRange(req.query);
  const dateFromStr = typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined;
  const dateToStr = typeof req.query.dateTo === "string" ? req.query.dateTo : undefined;
  const userId = req.query.userId ? Number(req.query.userId) : undefined;
  const status = typeof req.query.status === "string" && req.query.status !== "all" ? req.query.status : undefined;

  try {
    const whereConditions = [
      sql`CAST(${reservationsTable.deposit} AS numeric) > 0`,
      sql`NOT EXISTS (SELECT 1 FROM sales s WHERE s.id = ${reservationsTable.saleId} AND s.status = 'cancelada')`,
    ];

    if (userId) {
      whereConditions.push(eq(reservationsTable.userId, userId));
    }

    if (status) {
      whereConditions.push(eq(reservationsTable.status, status));
    }

    const dateFilters = [];
    if (from && to) {
      dateFilters.push(and(gte(reservationsTable.createdAt, from), lte(reservationsTable.createdAt, to)));
    } else if (from) {
      dateFilters.push(gte(reservationsTable.createdAt, from));
    } else if (to) {
      dateFilters.push(lte(reservationsTable.createdAt, to));
    }

    if (dateFromStr && dateToStr) {
      dateFilters.push(
        and(
          sql`CAST(${reservationsTable.reservationDate} AS text) >= ${dateFromStr}`,
          sql`CAST(${reservationsTable.reservationDate} AS text) <= ${dateToStr}`
        )
      );
    } else if (dateFromStr) {
      dateFilters.push(sql`CAST(${reservationsTable.reservationDate} AS text) >= ${dateFromStr}`);
    } else if (dateToStr) {
      dateFilters.push(sql`CAST(${reservationsTable.reservationDate} AS text) <= ${dateToStr}`);
    }

    if (dateFilters.length > 0) {
      whereConditions.push(or(...dateFilters)!);
    }

    const rows = await db
      .select({
        id: reservationsTable.id,
        customerId: reservationsTable.customerId,
        customerName: customersTable.name,
        customerPhone: customersTable.phone,
        userId: reservationsTable.userId,
        userName: usersTable.name,
        userRole: usersTable.role,
        status: reservationsTable.status,
        total: reservationsTable.total,
        deposit: reservationsTable.deposit,
        depositMethod: reservationsTable.depositMethod,
        reservationDate: reservationsTable.reservationDate,
        expectedAt: reservationsTable.expectedAt,
        notes: reservationsTable.notes,
        saleId: reservationsTable.saleId,
        depositRefunded: reservationsTable.depositRefunded,
        refundMethod: reservationsTable.refundMethod,
        refundedAt: reservationsTable.refundedAt,
        createdAt: reservationsTable.createdAt,
      })
      .from(reservationsTable)
      .leftJoin(customersTable, eq(reservationsTable.customerId, customersTable.id))
      .leftJoin(usersTable, eq(reservationsTable.userId, usersTable.id))
      .where(and(...whereConditions))
      .orderBy(desc(reservationsTable.createdAt), desc(reservationsTable.id));

    const resIds = rows.map((r) => r.id);
    const payments = resIds.length
      ? await db
          .select()
          .from(reservationPaymentsTable)
          .where(inArray(reservationPaymentsTable.reservationId, resIds))
          .orderBy(reservationPaymentsTable.id)
      : [];

    const details = resIds.length
      ? await db
          .select()
          .from(reservationDetailsTable)
          .where(inArray(reservationDetailsTable.reservationId, resIds))
          .orderBy(reservationDetailsTable.id)
      : [];

    const paymentsByResId = new Map<number, Array<{ paymentMethod: string; amount: number }>>();
    for (const p of payments) {
      const list = paymentsByResId.get(p.reservationId) ?? [];
      list.push({ paymentMethod: p.paymentMethod, amount: Number(p.amount) });
      paymentsByResId.set(p.reservationId, list);
    }

    const detailsByResId = new Map<
      number,
      Array<{
        id: number;
        productId: number | null;
        productName: string;
        specifications: string;
        quantity: number;
        unitPrice: number;
        subtotal: number;
      }>
    >();
    for (const d of details) {
      const list = detailsByResId.get(d.reservationId) ?? [];
      list.push({
        id: d.id,
        productId: d.productId,
        productName: d.productName,
        specifications: d.specifications,
        quantity: Number(d.quantity),
        unitPrice: Number(d.unitPrice),
        subtotal: Number(d.subtotal),
      });
      detailsByResId.set(d.reservationId, list);
    }

    let totalDepositsAmount = 0;
    let totalReservationsTotal = 0;
    let totalRemainingBalance = 0;
    let totalRefundedAmount = 0;
    const byMethod: Record<string, number> = {};
    const byStatus: Record<string, number> = {};

    const deposits = rows.map((r) => {
      const depAmount = Number(r.deposit || 0);
      const totalAmount = Number(r.total || 0);
      const balanceAmount = Math.max(0, totalAmount - depAmount);
      const isCancelled = r.status === "cancelada";
      const wasRefunded = Boolean(r.depositRefunded);

      totalReservationsTotal += totalAmount;
      if (isCancelled) {
        // Adelanto devuelto: se registra como egreso, no como ingreso neto
        totalRefundedAmount += wasRefunded ? depAmount : 0;
      } else {
        totalDepositsAmount += depAmount;
        totalRemainingBalance += balanceAmount;
      }

      byStatus[r.status] = (byStatus[r.status] || 0) + 1;

      let rPayments = paymentsByResId.get(r.id);
      if (!rPayments || rPayments.length === 0) {
        const method = r.depositMethod || "Efectivo";
        rPayments = [{ paymentMethod: method, amount: depAmount }];
      }

      // Solo sumar a métodos de pago si la reserva no fue anulada (el dinero se devolvió)
      if (!isCancelled) {
        for (const p of rPayments) {
          byMethod[p.paymentMethod] = Number(((byMethod[p.paymentMethod] || 0) + p.amount).toFixed(2));
        }
      }

      return {
        id: r.id,
        customerId: r.customerId,
        customerName: r.customerName || "Sin cliente",
        customerPhone: r.customerPhone || null,
        userId: r.userId,
        userName: r.userName || "Sin vendedor",
        userRole: r.userRole || "vendedor",
        status: r.status,
        total: totalAmount,
        deposit: depAmount,
        balance: balanceAmount,
        depositMethod: r.depositMethod,
        depositRefunded: wasRefunded,
        refundMethod: r.refundMethod,
        refundedAt: r.refundedAt ? r.refundedAt.toISOString() : null,
        reservationDate: r.reservationDate ? normalizeDateStr(r.reservationDate, new Date(r.createdAt)) : normalizeDateStr(null, new Date(r.createdAt)),
        expectedAt: r.expectedAt ? normalizeDateStr(r.expectedAt, new Date(r.createdAt)) : null,
        notes: r.notes,
        saleId: r.saleId,
        createdAt: r.createdAt.toISOString(),
        payments: rPayments,
        products: detailsByResId.get(r.id) ?? [],
      };
    });

    const totalCount = deposits.length;
    const averageDeposit = totalCount > 0 ? Number((totalDepositsAmount / totalCount).toFixed(2)) : 0;

    res.json({
      deposits,
      summary: {
        totalDepositsAmount: Number(totalDepositsAmount.toFixed(2)),
        totalReservationsCount: totalCount,
        totalReservationsTotal: Number(totalReservationsTotal.toFixed(2)),
        totalRemainingBalance: Number(totalRemainingBalance.toFixed(2)),
        totalRefundedAmount: Number(totalRefundedAmount.toFixed(2)),
        averageDeposit,
        byPaymentMethod: byMethod,
        byStatus,
      },
    });
  } catch (err) {
    req.log.error({ err }, "ReportReservationDeposits error");
    res.status(500).json({ message: "Error interno" });
  }
});

// GET /api/reports/sales-by-user
router.get("/sales-by-user", async (req, res) => {
  const { from, to } = parseDateRange(req.query);
  const dateFromStr = typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined;
  const dateToStr = typeof req.query.dateTo === "string" ? req.query.dateTo : undefined;

  try {
    // 0. Entregas de reservas para no duplicarlas como ventas directas
    const deliveredReservations = await db
      .select({ saleId: reservationsTable.saleId })
      .from(reservationsTable)
      .where(sql`${reservationsTable.saleId} IS NOT NULL`);
    const deliveredSaleIdSet = new Set<number>(
      deliveredReservations.map((r) => r.saleId!).filter(Boolean)
    );

    // 1. Ventas directas completadas
    const allSales = await db
      .select({
        id: salesTable.id,
        userId: salesTable.userId,
        userName: usersTable.name,
        total: salesTable.total,
        notes: salesTable.notes,
      })
      .from(salesTable)
      .leftJoin(usersTable, eq(salesTable.userId, usersTable.id))
      .where(
        and(
          eq(salesTable.status, "completada"),
          from ? gte(salesTable.createdAt, from) : undefined,
          to ? lte(salesTable.createdAt, to) : undefined,
        )
      );

    interface UserAgg {
      userId: number;
      userName: string;
      totalSales: number;
      totalRevenue: number;
      totalDepositsCount: number;
      totalDepositsAmount: number;
      totalBalancesAmount: number;
      grandTotal: number;
    }

    const userMap = new Map<number, UserAgg>();

    for (const s of allSales) {
      const isResvDelivery =
        deliveredSaleIdSet.has(s.id) ||
        Boolean(s.notes && s.notes.includes("Entrega de reserva #"));
      if (isResvDelivery) continue; // Las entregas de reserva se procesan en reservas para evitar duplicidad

      const uid = s.userId ?? 0;
      const rev = Number(s.total || 0);
      let existing = userMap.get(uid);
      if (!existing) {
        existing = {
          userId: uid,
          userName: s.userName ?? "Sin vendedor",
          totalSales: 0,
          totalRevenue: 0,
          totalDepositsCount: 0,
          totalDepositsAmount: 0,
          totalBalancesAmount: 0,
          grandTotal: 0,
        };
        userMap.set(uid, existing);
      }
      existing.totalSales += 1;
      existing.totalRevenue = Number((existing.totalRevenue + rev).toFixed(2));
      // No sumamos totalRevenue (venta directa) a grandTotal, grandTotal es el total de reservas (adelanto + saldo a cobrar)
    }

    // 2. Obtener reservas (adelantos + saldos a cobrar) por vendedor en el mismo período
    const depositConditions = [
      sql`CAST(${reservationsTable.total} AS numeric) > 0`,
      sql`${reservationsTable.status} != 'cancelada'`,
      sql`${reservationsTable.depositRefunded} = false`,
      sql`NOT EXISTS (SELECT 1 FROM sales s WHERE s.id = ${reservationsTable.saleId} AND s.status = 'cancelada')`,
    ];
    const dateFilters = [];
    if (from && to) {
      dateFilters.push(and(gte(reservationsTable.createdAt, from), lte(reservationsTable.createdAt, to)));
    } else if (from) {
      dateFilters.push(gte(reservationsTable.createdAt, from));
    } else if (to) {
      dateFilters.push(lte(reservationsTable.createdAt, to));
    }
    if (dateFromStr && dateToStr) {
      dateFilters.push(
        and(
          sql`CAST(${reservationsTable.reservationDate} AS text) >= ${dateFromStr}`,
          sql`CAST(${reservationsTable.reservationDate} AS text) <= ${dateToStr}`
        )
      );
    } else if (dateFromStr) {
      dateFilters.push(sql`CAST(${reservationsTable.reservationDate} AS text) >= ${dateFromStr}`);
    } else if (dateToStr) {
      dateFilters.push(sql`CAST(${reservationsTable.reservationDate} AS text) <= ${dateToStr}`);
    }

    if (dateFilters.length > 0) {
      depositConditions.push(or(...dateFilters)!);
    }

    const resUserRows = await db
      .select({
        id: reservationsTable.id,
        userId: reservationsTable.userId,
        userName: usersTable.name,
        deposit: reservationsTable.deposit,
        total: reservationsTable.total,
        status: reservationsTable.status,
        saleId: reservationsTable.saleId,
      })
      .from(reservationsTable)
      .leftJoin(usersTable, eq(reservationsTable.userId, usersTable.id))
      .where(and(...depositConditions));

    for (const r of resUserRows) {
      const uid = r.userId ?? 0;
      const depAmt = Number(r.deposit || 0);
      const totAmt = Number(r.total || 0);
      const balAmt = Math.max(0, totAmt - depAmt);

      let existing = userMap.get(uid);
      if (!existing) {
        existing = {
          userId: uid,
          userName: r.userName ?? "Sin vendedor",
          totalSales: 0,
          totalRevenue: 0,
          totalDepositsCount: 0,
          totalDepositsAmount: 0,
          totalBalancesAmount: 0,
          grandTotal: 0,
        };
        userMap.set(uid, existing);
      }
      // Solo sumar el saldo a cobrar cuando la reserva está Entregada (y por tanto cobrada).
      // Si no está entregada, el saldo queda pendiente y solo se cuenta el adelanto.
      const isDelivered = r.status === "entregada" || Boolean(r.saleId);
      const balCounted = isDelivered ? balAmt : 0;

      existing.totalDepositsCount += 1;
      existing.totalDepositsAmount = Number((existing.totalDepositsAmount + depAmt).toFixed(2));
      existing.totalBalancesAmount = Number((existing.totalBalancesAmount + balCounted).toFixed(2));
      // Total Recaudado = Monto Adelanto + Saldo a Cobrar de la Reserva (solo si está entregada)
      existing.grandTotal = Number(
        (existing.totalDepositsAmount + existing.totalBalancesAmount).toFixed(2)
      );
    }

    const result = Array.from(userMap.values()).sort((a, b) => b.grandTotal - a.grandTotal);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "ReportSalesByUser error");
    res.status(500).json({ message: "Error interno" });
  }
});

// GET /api/reports/by-category
router.get("/by-category", async (req, res) => {
  const { from, to } = parseDateRange(req.query);
  try {
    const rows = await db
      .select({
        categoryId: productsTable.categoryId,
        categoryName: categoriesTable.name,
        totalSold: sum(saleDetailsTable.quantity),
        totalRevenue: sum(saleDetailsTable.subtotal),
      })
      .from(saleDetailsTable)
      .innerJoin(salesTable, and(eq(saleDetailsTable.saleId, salesTable.id), eq(salesTable.status, "completada")))
      .leftJoin(productsTable, eq(saleDetailsTable.productId, productsTable.id))
      .leftJoin(categoriesTable, eq(productsTable.categoryId, categoriesTable.id))
      .where(
        and(
          from ? gte(salesTable.createdAt, from) : undefined,
          to ? lte(salesTable.createdAt, to) : undefined,
        )
      )
      .groupBy(productsTable.categoryId, categoriesTable.name)
      .orderBy(sql`sum(${saleDetailsTable.subtotal}) DESC`);

    res.json(
      rows.map((r) => ({
        categoryId: r.categoryId ?? null,
        categoryName: r.categoryName ?? "Sin categoría",
        totalSold: Number(r.totalSold ?? 0),
        totalRevenue: Number(r.totalRevenue ?? 0),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "ReportByCategory error");
    res.status(500).json({ message: "Error interno" });
  }
});

// GET /api/reports/stock-alerts
router.get("/stock-alerts", async (req, res) => {
  try {
    const rows = await db
      .select({
        id: productsTable.id,
        name: productsTable.name,
        stock: productsTable.stock,
        minStock: productsTable.minStock,
        categoryName: categoriesTable.name,
      })
      .from(productsTable)
      .leftJoin(categoriesTable, eq(productsTable.categoryId, categoriesTable.id))
      .where(sql`${productsTable.stock} <= ${productsTable.minStock}`)
      .orderBy(productsTable.stock);

    res.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        stock: r.stock,
        minStock: r.minStock,
        categoryName: r.categoryName ?? null,
        brandName: null,
        status: r.stock === 0 ? "Sin stock" : "Stock bajo",
      }))
    );
  } catch (err) {
    req.log.error({ err }, "ReportStockAlerts error");
    res.status(500).json({ message: "Error interno" });
  }
});

export default router;
