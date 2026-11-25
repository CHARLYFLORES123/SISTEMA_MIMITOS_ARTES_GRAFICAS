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
  cashRegisterSessionsTable,
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

function getBusinessDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/La_Paz",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
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
      .select({ reservationId: reservationsTable.id, saleId: reservationsTable.saleId })
      .from(reservationsTable)
      .where(sql`${reservationsTable.saleId} IS NOT NULL`);
    const reservationIdBySaleId = new Map<number, number>(
      deliveredReservations
        .filter((row): row is { reservationId: number; saleId: number } => row.saleId !== null)
        .map((row) => [row.saleId, row.reservationId]),
    );
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
      const paymentDate = sql`COALESCE(
        crs.business_date,
        to_char(rp.created_at AT TIME ZONE 'America/La_Paz', 'YYYY-MM-DD')
      )`;
      const paymentDateFilters = [
        sql`${paymentDate} >= ${dateFromStr}`,
        sql`${paymentDate} <= ${dateToStr}`,
      ];
      const reservationDateFilters = and(
        sql`CAST(${reservationsTable.reservationDate} AS text) >= ${dateFromStr}`,
        sql`CAST(${reservationsTable.reservationDate} AS text) <= ${dateToStr}`,
      );
      dateFilters.push(or(
        sql`EXISTS (
          SELECT 1 FROM reservation_payments rp
          LEFT JOIN cash_register_sessions crs ON crs.id = rp.cash_register_session_id
          WHERE rp.reservation_id = ${reservationsTable.id}
            AND ${and(...paymentDateFilters)}
        )`,
        and(
          sql`NOT EXISTS (
            SELECT 1 FROM reservation_payments rp
            WHERE rp.reservation_id = ${reservationsTable.id}
          )`,
          reservationDateFilters,
        ),
        reservationDateFilters,
      )!);
    } else if (dateFromStr) {
      dateFilters.push(or(
        sql`EXISTS (
          SELECT 1 FROM reservation_payments rp
          LEFT JOIN cash_register_sessions crs ON crs.id = rp.cash_register_session_id
          WHERE rp.reservation_id = ${reservationsTable.id}
            AND COALESCE(crs.business_date, to_char(rp.created_at AT TIME ZONE 'America/La_Paz', 'YYYY-MM-DD')) >= ${dateFromStr}
        )`,
        sql`CAST(${reservationsTable.reservationDate} AS text) >= ${dateFromStr}`,
      )!);
    } else if (dateToStr) {
      dateFilters.push(or(
        sql`EXISTS (
          SELECT 1 FROM reservation_payments rp
          LEFT JOIN cash_register_sessions crs ON crs.id = rp.cash_register_session_id
          WHERE rp.reservation_id = ${reservationsTable.id}
            AND COALESCE(crs.business_date, to_char(rp.created_at AT TIME ZONE 'America/La_Paz', 'YYYY-MM-DD')) <= ${dateToStr}
        )`,
        sql`CAST(${reservationsTable.reservationDate} AS text) <= ${dateToStr}`,
      )!);
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

    const depositReservationIds = depositRows.map((row) => row.reservationId);
    const reservationPaymentRows = depositReservationIds.length
      ? await db.select().from(reservationPaymentsTable)
        .where(inArray(reservationPaymentsTable.reservationId, depositReservationIds))
        .orderBy(reservationPaymentsTable.id)
      : [];
    const paymentSessionIds = [...new Set(
      reservationPaymentRows
        .map((payment) => payment.cashRegisterSessionId)
        .filter((sessionId): sessionId is number => sessionId !== null),
    )];
    const paymentSessions = paymentSessionIds.length
      ? await db.select({
          id: cashRegisterSessionsTable.id,
          businessDate: cashRegisterSessionsTable.businessDate,
        }).from(cashRegisterSessionsTable)
          .where(inArray(cashRegisterSessionsTable.id, paymentSessionIds))
      : [];
    const businessDateBySession = new Map(paymentSessions.map((session) => [session.id, session.businessDate]));
    const paymentEventsByReservation = new Map<number, Array<{
      paymentMethod: string;
      amount: number;
      businessDate: string;
    }>>();
    for (const payment of reservationPaymentRows) {
      const events = paymentEventsByReservation.get(payment.reservationId) ?? [];
      events.push({
        paymentMethod: payment.paymentMethod,
        amount: Number(payment.amount),
        businessDate: (payment.cashRegisterSessionId && businessDateBySession.get(payment.cashRegisterSessionId))
          || getBusinessDateKey(payment.createdAt),
      });
      paymentEventsByReservation.set(payment.reservationId, events);
    }

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
      balanceReservationIds: Set<number>;
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
          balanceReservationIds: new Set<number>(),
          productsMap: new Map<string, ProductItem>(),
          depositsList: [],
        };
        groups.set(key, group);
      }
      return group;
    };

    // Procesar filas de ventas directas (excluyendo entregas de reserva para evitar doble conteo)
    const deliveryDateByReservation = new Map<number, string>();
    for (const row of rows) {
      const isResvDelivery =
        deliveredSaleIdSet.has(row.saleId) ||
        Boolean(row.saleNotes && row.saleNotes.includes("Entrega de reserva #"));
      if (isResvDelivery) {
        const reservationId = reservationIdBySaleId.get(row.saleId);
        if (reservationId) {
          deliveryDateByReservation.set(reservationId, getBusinessDateKey(new Date(row.saleCreatedAt)));
        }
      }
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

    const isInSelectedDateRange = (date: string) =>
      (!dateFromStr || date >= dateFromStr) && (!dateToStr || date <= dateToStr);

    // Los adelantos se agrupan por fecha real de recepción, no por fecha de reserva.
    for (const depRow of depositRows) {
      const uid = depRow.userId ?? 0;
      const currentDeposit = Number(depRow.deposit || 0);
      const total = Number(depRow.total || 0);
      const balance = Math.max(0, total - currentDeposit);
      const reservationDate = normalizeDateStr(depRow.reservationDate, new Date(depRow.createdAt));
      if (isInSelectedDateRange(reservationDate)) {
        getOrCreateGroup(reservationDate, uid, depRow.userName, depRow.userRole);
      }
      const events = paymentEventsByReservation.get(depRow.reservationId) ?? (currentDeposit > 0
        ? [{
          paymentMethod: depRow.depositMethod || "Efectivo",
          amount: currentDeposit,
          businessDate: getBusinessDateKey(depRow.createdAt),
        }]
        : []);
      const eventsByDate = new Map<string, typeof events>();
      for (const event of events) {
        if (!isInSelectedDateRange(event.businessDate)) continue;
        const eventsOnDate = eventsByDate.get(event.businessDate) ?? [];
        eventsOnDate.push(event);
        eventsByDate.set(event.businessDate, eventsOnDate);
      }

      for (const [dateKey, dateEvents] of eventsByDate) {
        const group = getOrCreateGroup(dateKey, uid, depRow.userName, depRow.userRole);
        const dayAmount = Number(dateEvents.reduce((sum, event) => sum + event.amount, 0).toFixed(2));
        if (!group.reservationIds.has(depRow.reservationId)) {
          group.reservationIds.add(depRow.reservationId);
          group.depositsCount += 1;
        }
        group.depositsAmount += dayAmount;
        group.depositsList.push({
          reservationId: depRow.reservationId,
          customerName: depRow.customerName || "Sin cliente",
          deposit: dayAmount,
          balance: Number(balance.toFixed(2)),
          total,
          depositMethod: [...new Set(dateEvents.map((event) => event.paymentMethod))].join(" / "),
          status: depRow.status,
          date: dateKey,
        });
      }

      const deliveryDate = deliveryDateByReservation.get(depRow.reservationId);
      if (deliveryDate && balance > 0 && isInSelectedDateRange(deliveryDate)) {
        const group = getOrCreateGroup(deliveryDate, uid, depRow.userName, depRow.userRole);
        if (!group.balanceReservationIds.has(depRow.reservationId)) {
          group.balanceReservationIds.add(depRow.reservationId);
          group.balancesAmount += balance;
        }
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
        if (isInSelectedDateRange(dateKey)) {
          resMeta.set(depRow.reservationId, { dateKey, uid });
        }
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

    if (dateFromStr || dateToStr) {
      const paymentDate = sql`COALESCE(
        crs.business_date,
        to_char(rp.created_at AT TIME ZONE 'America/La_Paz', 'YYYY-MM-DD')
      )`;
      const paymentDateFilters = [];
      if (dateFromStr) paymentDateFilters.push(sql`${paymentDate} >= ${dateFromStr}`);
      if (dateToStr) paymentDateFilters.push(sql`${paymentDate} <= ${dateToStr}`);

      const legacyDateFilters = [];
      if (dateFromStr) {
        legacyDateFilters.push(sql`(
          CAST(${reservationsTable.reservationDate} AS text) >= ${dateFromStr}
          OR to_char(${reservationsTable.createdAt} AT TIME ZONE 'America/La_Paz', 'YYYY-MM-DD') >= ${dateFromStr}
        )`);
      }
      if (dateToStr) {
        legacyDateFilters.push(sql`(
          CAST(${reservationsTable.reservationDate} AS text) <= ${dateToStr}
          OR to_char(${reservationsTable.createdAt} AT TIME ZONE 'America/La_Paz', 'YYYY-MM-DD') <= ${dateToStr}
        )`);
      }
      whereConditions.push(or(
        sql`EXISTS (
          SELECT 1 FROM reservation_payments rp
          LEFT JOIN cash_register_sessions crs ON crs.id = rp.cash_register_session_id
          WHERE rp.reservation_id = ${reservationsTable.id}
            AND ${and(...paymentDateFilters)}
        )`,
        and(
          sql`NOT EXISTS (
            SELECT 1 FROM reservation_payments rp
            WHERE rp.reservation_id = ${reservationsTable.id}
          )`,
          and(...legacyDateFilters),
        ),
      )!);
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

    const paymentSessionIds = [...new Set(payments.map((payment) => payment.cashRegisterSessionId).filter((value): value is number => value !== null))];
    const paymentSessions = paymentSessionIds.length
      ? await db.select({
          id: cashRegisterSessionsTable.id,
          businessDate: cashRegisterSessionsTable.businessDate,
        }).from(cashRegisterSessionsTable)
          .where(inArray(cashRegisterSessionsTable.id, paymentSessionIds))
      : [];
    const businessDateBySession = new Map(paymentSessions.map((session) => [session.id, session.businessDate]));
    const paymentsByResId = new Map<number, Array<{ paymentMethod: string; amount: number; createdAt: string; businessDate: string }>>();
    for (const p of payments) {
      const list = paymentsByResId.get(p.reservationId) ?? [];
      const createdAt = p.createdAt.toISOString();
      list.push({
        paymentMethod: p.paymentMethod,
        amount: Number(p.amount),
        createdAt,
        businessDate: (p.cashRegisterSessionId && businessDateBySession.get(p.cashRegisterSessionId))
          || getBusinessDateKey(p.createdAt),
      });
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

    const hasDateFilter = Boolean(dateFromStr || dateToStr);
    const deposits = rows.map((r) => {
      let rPayments = paymentsByResId.get(r.id) ?? [];
      if (rPayments.length === 0 && Number(r.deposit) > 0) {
        rPayments = [{
          paymentMethod: r.depositMethod || "Efectivo",
          amount: Number(r.deposit),
          createdAt: r.createdAt.toISOString(),
          businessDate: getBusinessDateKey(r.createdAt),
        }];
      }
      if (hasDateFilter) {
        rPayments = rPayments.filter((payment) =>
          (!dateFromStr || payment.businessDate >= dateFromStr)
          && (!dateToStr || payment.businessDate <= dateToStr)
        );
      }
      const depAmount = Number(rPayments.reduce((sum, payment) => sum + payment.amount, 0).toFixed(2));
      const currentDeposit = Number(r.deposit || 0);
      const totalAmount = Number(r.total || 0);
      const balanceAmount = Math.max(0, totalAmount - currentDeposit);
      const isCancelled = r.status === "cancelada";
      const wasRefunded = Boolean(r.depositRefunded);

      if (depAmount > 0) totalReservationsTotal += totalAmount;
      if (isCancelled) {
        // Adelanto devuelto: se registra como egreso, no como ingreso neto
        totalRefundedAmount += wasRefunded ? depAmount : 0;
      } else {
        totalDepositsAmount += depAmount;
        if (depAmount > 0) totalRemainingBalance += balanceAmount;
      }

      if (depAmount > 0) byStatus[r.status] = (byStatus[r.status] || 0) + 1;

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
        payments: rPayments.map(({ paymentMethod, amount, createdAt }) => ({ paymentMethod, amount, createdAt })),
        products: detailsByResId.get(r.id) ?? [],
      };
    }).filter((deposit) => deposit.deposit > 0);

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
      dateFilters.push(or(
        sql`EXISTS (
          SELECT 1 FROM reservation_payments rp
          LEFT JOIN cash_register_sessions crs ON crs.id = rp.cash_register_session_id
          WHERE rp.reservation_id = ${reservationsTable.id}
            AND COALESCE(crs.business_date, to_char(rp.created_at AT TIME ZONE 'America/La_Paz', 'YYYY-MM-DD')) >= ${dateFromStr}
            AND COALESCE(crs.business_date, to_char(rp.created_at AT TIME ZONE 'America/La_Paz', 'YYYY-MM-DD')) <= ${dateToStr}
        )`,
        and(
          sql`CAST(${reservationsTable.reservationDate} AS text) >= ${dateFromStr}`,
          sql`CAST(${reservationsTable.reservationDate} AS text) <= ${dateToStr}`
        ),
      )!);
    } else if (dateFromStr) {
      dateFilters.push(or(
        sql`EXISTS (
          SELECT 1 FROM reservation_payments rp
          LEFT JOIN cash_register_sessions crs ON crs.id = rp.cash_register_session_id
          WHERE rp.reservation_id = ${reservationsTable.id}
            AND COALESCE(crs.business_date, to_char(rp.created_at AT TIME ZONE 'America/La_Paz', 'YYYY-MM-DD')) >= ${dateFromStr}
        )`,
        sql`CAST(${reservationsTable.reservationDate} AS text) >= ${dateFromStr}`,
      )!);
    } else if (dateToStr) {
      dateFilters.push(or(
        sql`EXISTS (
          SELECT 1 FROM reservation_payments rp
          LEFT JOIN cash_register_sessions crs ON crs.id = rp.cash_register_session_id
          WHERE rp.reservation_id = ${reservationsTable.id}
            AND COALESCE(crs.business_date, to_char(rp.created_at AT TIME ZONE 'America/La_Paz', 'YYYY-MM-DD')) <= ${dateToStr}
        )`,
        sql`CAST(${reservationsTable.reservationDate} AS text) <= ${dateToStr}`,
      )!);
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
        createdAt: reservationsTable.createdAt,
      })
      .from(reservationsTable)
      .leftJoin(usersTable, eq(reservationsTable.userId, usersTable.id))
      .where(and(...depositConditions));

    const userReservationIds = resUserRows.map((row) => row.id);
    const userPayments = userReservationIds.length
      ? await db.select().from(reservationPaymentsTable)
        .where(inArray(reservationPaymentsTable.reservationId, userReservationIds))
      : [];
    const userPaymentSessionIds = [...new Set(
      userPayments
        .map((payment) => payment.cashRegisterSessionId)
        .filter((sessionId): sessionId is number => sessionId !== null),
    )];
    const userPaymentSessions = userPaymentSessionIds.length
      ? await db.select({
          id: cashRegisterSessionsTable.id,
          businessDate: cashRegisterSessionsTable.businessDate,
        }).from(cashRegisterSessionsTable)
          .where(inArray(cashRegisterSessionsTable.id, userPaymentSessionIds))
      : [];
    const userBusinessDates = new Map(userPaymentSessions.map((session) => [session.id, session.businessDate]));
    const userPaymentsByReservation = new Map<number, Array<{ paymentMethod: string; amount: number; businessDate: string }>>();
    for (const payment of userPayments) {
      const list = userPaymentsByReservation.get(payment.reservationId) ?? [];
      list.push({
        paymentMethod: payment.paymentMethod,
        amount: Number(payment.amount),
        businessDate: (payment.cashRegisterSessionId && userBusinessDates.get(payment.cashRegisterSessionId))
          || getBusinessDateKey(payment.createdAt),
      });
      userPaymentsByReservation.set(payment.reservationId, list);
    }

    const deliveredSaleIds = resUserRows
      .map((reservation) => reservation.saleId)
      .filter((saleId): saleId is number => saleId !== null);
    const deliverySales = deliveredSaleIds.length
      ? await db.select({
          id: salesTable.id,
          createdAt: salesTable.createdAt,
        }).from(salesTable)
          .where(inArray(salesTable.id, deliveredSaleIds))
      : [];
    const deliveryDateBySale = new Map(deliverySales.map((sale) => [sale.id, getBusinessDateKey(sale.createdAt)]));
    const isInSelectedDateRange = (date: string) =>
      (!dateFromStr || date >= dateFromStr) && (!dateToStr || date <= dateToStr);

    for (const r of resUserRows) {
      const uid = r.userId ?? 0;
      const recordedPayments = userPaymentsByReservation.get(r.id) ?? [];
      const effectivePayments = recordedPayments.length > 0
        ? recordedPayments.filter((payment) => isInSelectedDateRange(payment.businessDate))
        : (Number(r.deposit) > 0 && isInSelectedDateRange(getBusinessDateKey(r.createdAt))
          ? [{ paymentMethod: "Efectivo", amount: Number(r.deposit), businessDate: getBusinessDateKey(r.createdAt) }]
          : []);
      const depAmt = Number(effectivePayments.reduce((sum, payment) => sum + payment.amount, 0).toFixed(2));
      const totAmt = Number(r.total || 0);
      const balAmt = Math.max(0, totAmt - Number(r.deposit || 0));

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

      if (depAmt > 0) existing.totalDepositsCount += 1;
      existing.totalDepositsAmount = Number((existing.totalDepositsAmount + depAmt).toFixed(2));
      const deliveryDate = r.saleId ? deliveryDateBySale.get(r.saleId) : undefined;
      const balanceForPeriod = !dateFromStr && !dateToStr
        ? balCounted
        : (deliveryDate && isInSelectedDateRange(deliveryDate) ? balCounted : 0);
      existing.totalBalancesAmount = Number((existing.totalBalancesAmount + balanceForPeriod).toFixed(2));
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
