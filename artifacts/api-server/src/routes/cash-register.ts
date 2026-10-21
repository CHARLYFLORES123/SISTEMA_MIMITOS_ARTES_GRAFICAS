import { Router } from "express";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  cashRegisterExpensesTable,
  cashRegisterSessionsTable,
  customersTable,
  db,
  reservationPaymentsTable,
  reservationsTable,
  salePaymentsTable,
  salesTable,
  usersTable,
} from "@workspace/db";
import { AuthRequest, requireRoles, verifyToken } from "../middlewares/auth";
import { auditLog } from "../lib/audit";

const router = Router();
router.use(verifyToken);

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isValidBusinessDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function getSessionSummary(sessionId: number) {
  const [session] = await db
    .select({
      session: cashRegisterSessionsTable,
      userName: usersTable.name,
    })
    .from(cashRegisterSessionsTable)
    .innerJoin(usersTable, eq(cashRegisterSessionsTable.userId, usersTable.id))
    .where(eq(cashRegisterSessionsTable.id, sessionId))
    .limit(1);
  if (!session) return undefined;

  const sales = await db
    .select({
      id: salesTable.id,
      total: salesTable.total,
      paymentMethod: salesTable.paymentMethod,
    })
    .from(salesTable)
    .where(and(
      eq(salesTable.cashRegisterSessionId, sessionId),
      eq(salesTable.status, "completada"),
    ));
  const payments = sales.length
    ? await db.select().from(salePaymentsTable).where(inArray(salePaymentsTable.saleId, sales.map(({ id }) => id)))
    : [];
  const paymentsBySale = new Map<number, typeof payments>();
  for (const payment of payments) {
    const salePayments = paymentsBySale.get(payment.saleId) ?? [];
    salePayments.push(payment);
    paymentsBySale.set(payment.saleId, salePayments);
  }
  const totalsByMethod = new Map<string, number>();
  for (const sale of sales) {
    const salePayments = paymentsBySale.get(sale.id);
    const effectivePayments = salePayments?.length
      ? salePayments.map(({ paymentMethod, amount }) => ({ paymentMethod, amount: Number(amount) }))
      : [{ paymentMethod: sale.paymentMethod, amount: Number(sale.total) }];
    for (const payment of effectivePayments) {
      totalsByMethod.set(payment.paymentMethod, (totalsByMethod.get(payment.paymentMethod) ?? 0) + payment.amount);
    }
  }

  // Reservation deposits registered in this cash session
  // Auto-link any unassigned deposits created on this business date that haven't been linked
  await db
    .update(reservationsTable)
    .set({ cashRegisterSessionId: sessionId })
    .where(and(
      sql`${reservationsTable.cashRegisterSessionId} IS NULL`,
      sql`CAST(${reservationsTable.deposit} AS NUMERIC) > 0`,
      or(
        eq(reservationsTable.userId, session.session.userId),
        sql`${reservationsTable.userId} IS NULL`
      ),
      sql`CAST(${reservationsTable.reservationDate} AS text) = ${session.session.businessDate}`
    ));

  const reservations = await db
    .select({
      id: reservationsTable.id,
      total: reservationsTable.total,
      deposit: reservationsTable.deposit,
      depositMethod: reservationsTable.depositMethod,
      createdAt: reservationsTable.createdAt,
      customerId: reservationsTable.customerId,
      customerName: customersTable.name,
      userId: reservationsTable.userId,
      userName: usersTable.name,
    })
    .from(reservationsTable)
    .leftJoin(customersTable, eq(reservationsTable.customerId, customersTable.id))
    .leftJoin(usersTable, eq(reservationsTable.userId, usersTable.id))
    .where(and(
      sql`CAST(${reservationsTable.deposit} AS NUMERIC) > 0`,
      or(
        eq(reservationsTable.cashRegisterSessionId, sessionId),
        and(
          sql`${reservationsTable.cashRegisterSessionId} IS NULL`,
          sql`CAST(${reservationsTable.reservationDate} AS text) = ${session.session.businessDate}`
        )
      )
    ))
    .orderBy(reservationsTable.id);

  const resvPayments = reservations.length
    ? await db.select().from(reservationPaymentsTable).where(inArray(reservationPaymentsTable.reservationId, reservations.map(r => r.id)))
    : [];

  const paymentsByReservation = new Map<number, typeof resvPayments>();
  for (const p of resvPayments) {
    const list = paymentsByReservation.get(p.reservationId) ?? [];
    list.push(p);
    paymentsByReservation.set(p.reservationId, list);
  }

  for (const resv of reservations) {
    const pList = paymentsByReservation.get(resv.id);
    const effectivePayments = pList?.length
      ? pList.map(({ paymentMethod, amount }) => ({ paymentMethod, amount: Number(amount) }))
      : [{ paymentMethod: resv.depositMethod || "Efectivo", amount: Number(resv.deposit) }];
    for (const payment of effectivePayments) {
      totalsByMethod.set(payment.paymentMethod, (totalsByMethod.get(payment.paymentMethod) ?? 0) + payment.amount);
    }
  }

  const expenses = await db
    .select({
      id: cashRegisterExpensesTable.id,
      description: cashRegisterExpensesTable.description,
      amount: cashRegisterExpensesTable.amount,
      authorizedByName: usersTable.name,
      createdAt: cashRegisterExpensesTable.createdAt,
    })
    .from(cashRegisterExpensesTable)
    .innerJoin(usersTable, eq(cashRegisterExpensesTable.authorizedBy, usersTable.id))
    .where(eq(cashRegisterExpensesTable.sessionId, sessionId));

  // Compute cash from sales
  let cashSales = 0;
  for (const sale of sales) {
    const salePayments = paymentsBySale.get(sale.id);
    const effective = salePayments?.length
      ? salePayments.map(p => ({ paymentMethod: p.paymentMethod, amount: Number(p.amount) }))
      : [{ paymentMethod: sale.paymentMethod, amount: Number(sale.total) }];
    cashSales += effective
      .filter(({ paymentMethod }) => paymentMethod.toLowerCase().includes("efectivo"))
      .reduce((sum, p) => sum + p.amount, 0);
  }
  cashSales = roundMoney(cashSales);

  // Compute cash from deposits & total deposits
  let cashDeposits = 0;
  let totalDeposits = 0;
  for (const resv of reservations) {
    const pList = paymentsByReservation.get(resv.id);
    const effective = pList?.length
      ? pList.map(({ paymentMethod, amount }) => ({ paymentMethod, amount: Number(amount) }))
      : [{ paymentMethod: resv.depositMethod || "Efectivo", amount: Number(resv.deposit) }];
    for (const p of effective) {
      totalDeposits += p.amount;
      if (p.paymentMethod.toLowerCase().includes("efectivo")) {
        cashDeposits += p.amount;
      }
    }
  }
  cashDeposits = roundMoney(cashDeposits);
  totalDeposits = roundMoney(totalDeposits);

  const totalExpenses = roundMoney(expenses.reduce((sum, expense) => sum + Number(expense.amount), 0));
  const expectedCash = roundMoney(Number(session.session.openingAmount) + cashSales + cashDeposits - totalExpenses);

  return {
    id: session.session.id,
    userId: session.session.userId,
    userName: session.userName,
    businessDate: session.session.businessDate,
    status: session.session.status,
    openingAmount: Number(session.session.openingAmount),
    cashSales,
    cashDeposits,
    totalDeposits,
    deposits: reservations.map((resv) => {
      const pList = paymentsByReservation.get(resv.id);
      const effectivePayments = pList?.length
        ? pList.map(({ paymentMethod, amount }) => ({ paymentMethod, amount: Number(amount) }))
        : [{ paymentMethod: resv.depositMethod || "Efectivo", amount: Number(resv.deposit) }];
      return {
        id: resv.id,
        customerName: resv.customerName || "Sin cliente",
        userName: resv.userName || "—",
        total: Number(resv.total),
        deposit: Number(resv.deposit),
        depositMethod: resv.depositMethod,
        createdAt: resv.createdAt.toISOString(),
        payments: effectivePayments,
      };
    }),
    totalsByMethod: Object.fromEntries([...totalsByMethod].map(([method, amount]) => [method, roundMoney(amount)])),
    expenses: expenses.map((expense) => ({
      id: expense.id,
      description: expense.description,
      amount: Number(expense.amount),
      authorizedByName: expense.authorizedByName,
      createdAt: expense.createdAt.toISOString(),
    })),
    totalExpenses,
    expectedCash: session.session.status === "closed" && session.session.expectedCash != null
      ? Number(session.session.expectedCash)
      : expectedCash,
    countedCash: session.session.countedCash == null ? null : Number(session.session.countedCash),
    difference: session.session.difference == null ? null : Number(session.session.difference),
    openedAt: session.session.openedAt.toISOString(),
    closedAt: session.session.closedAt?.toISOString() ?? null,
  };
}

router.get("/", async (req: AuthRequest, res) => {
  const date = req.query.date;
  if (!isValidBusinessDate(date)) {
    res.status(400).json({ message: "Indica una fecha válida para consultar la caja" });
    return;
  }
  try {
    const queryUserId = (req.userRole === "admin" && req.query.userId) ? Number(req.query.userId) : req.userId!;
    let [session] = await db.select({ id: cashRegisterSessionsTable.id })
      .from(cashRegisterSessionsTable)
      .where(and(
        eq(cashRegisterSessionsTable.userId, queryUserId),
        eq(cashRegisterSessionsTable.businessDate, date),
      ))
      .limit(1);

    // If admin and no session for user, check if there's any session registered for this date
    if (!session && req.userRole === "admin") {
      [session] = await db.select({ id: cashRegisterSessionsTable.id })
        .from(cashRegisterSessionsTable)
        .where(eq(cashRegisterSessionsTable.businessDate, date))
        .orderBy(sql`${cashRegisterSessionsTable.id} DESC`)
        .limit(1);
    }

    if (!session) {
      res.json(null);
      return;
    }
    const result = await getSessionSummary(session.id);
    res.json(result ?? null);
  } catch (err) {
    req.log.error({ err }, "GetCashRegisterSession error");
    res.status(500).json({ message: "No se pudo consultar la caja" });
  }
});

router.post("/open", async (req: AuthRequest, res) => {
  const { businessDate, openingAmount } = req.body as { businessDate?: unknown; openingAmount?: unknown };
  if (!isValidBusinessDate(businessDate) || typeof openingAmount !== "number" || !Number.isFinite(openingAmount) || openingAmount < 0) {
    res.status(400).json({ message: "Indica una fecha y un efectivo inicial válido" });
    return;
  }
  try {
    const [session] = await db.insert(cashRegisterSessionsTable).values({
      userId: req.userId!,
      businessDate,
      openingAmount: String(roundMoney(openingAmount)),
    }).returning({ id: cashRegisterSessionsTable.id });
    const result = await getSessionSummary(session.id);
    if (!result) throw new Error(`Created cash register session ${session.id} could not be reloaded`);
    res.status(201).json(result);
    auditLog({ req, action: "opened", entity: "cash_register", entityId: session.id, entityName: businessDate, details: { openingAmount: result.openingAmount } });
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "23505") {
      res.status(409).json({ message: "Ya existe una caja abierta o cerrada para este usuario y fecha" });
      return;
    }
    req.log.error({ err }, "OpenCashRegister error");
    res.status(500).json({ message: "No se pudo abrir la caja" });
  }
});

router.post("/:id/expenses", requireRoles(["admin", "inventario", "vendedor"]), async (req: AuthRequest, res) => {
  const sessionId = Number(req.params.id);
  const { description, amount } = req.body as { description?: unknown; amount?: unknown };
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0 ||
      typeof description !== "string" || !description.trim() || description.trim().length > 300 ||
      typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ message: "Indica una descripción y un monto de gasto válido" });
    return;
  }
  try {
    const [expense] = await db.transaction(async (tx) => {
      const [session] = await tx.select()
        .from(cashRegisterSessionsTable)
        .where(and(
          eq(cashRegisterSessionsTable.id, sessionId),
          eq(cashRegisterSessionsTable.status, "open"),
        ))
        .for("update")
        .limit(1);
      if (!session) return [];
      return tx.insert(cashRegisterExpensesTable).values({
        sessionId,
        description: description.trim(),
        amount: String(roundMoney(amount)),
        authorizedBy: req.userId!,
      }).returning({ id: cashRegisterExpensesTable.id });
    });
    if (!expense) {
      res.status(404).json({ message: "No se encontró una caja abierta para registrar el gasto" });
      return;
    }
    const result = await getSessionSummary(sessionId);
    res.status(201).json(result);
    auditLog({ req, action: "expense_authorized", entity: "cash_register", entityId: sessionId, entityName: description.trim(), details: { amount: roundMoney(amount) } });
  } catch (err) {
    req.log.error({ err }, "CreateCashRegisterExpense error");
    res.status(500).json({ message: "No se pudo registrar el gasto autorizado" });
  }
});

router.post("/:id/close", async (req: AuthRequest, res) => {
  const sessionId = Number(req.params.id);
  const { countedCash } = req.body as { countedCash?: unknown };
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0 ||
      typeof countedCash !== "number" || !Number.isFinite(countedCash) || countedCash < 0) {
    res.status(400).json({ message: "Indica una cantidad de efectivo contado válida" });
    return;
  }
  try {
    const result = await db.transaction(async (tx) => {
      const [session] = await tx.select()
        .from(cashRegisterSessionsTable)
        .where(and(
          eq(cashRegisterSessionsTable.id, sessionId),
          eq(cashRegisterSessionsTable.userId, req.userId!),
          eq(cashRegisterSessionsTable.status, "open"),
        ))
        .for("update")
        .limit(1);
      if (!session) return undefined;

      const sales = await tx.select({
        id: salesTable.id,
        total: salesTable.total,
        paymentMethod: salesTable.paymentMethod,
      }).from(salesTable).where(and(
        eq(salesTable.cashRegisterSessionId, sessionId),
        eq(salesTable.status, "completada"),
      ));
      const payments = sales.length
        ? await tx.select().from(salePaymentsTable).where(inArray(salePaymentsTable.saleId, sales.map(({ id }) => id)))
        : [];
      const cashSales = sales.reduce((sum, sale) => {
        const salePayments = payments.filter((payment) => payment.saleId === sale.id);
        const effectivePayments = salePayments.length
          ? salePayments
          : [{ paymentMethod: sale.paymentMethod, amount: sale.total }];
        return sum + effectivePayments
          .filter((payment) => payment.paymentMethod.toLowerCase().includes("efectivo"))
          .reduce((paymentSum, payment) => paymentSum + Number(payment.amount), 0);
      }, 0);
      const expenses = await tx.select({ amount: cashRegisterExpensesTable.amount })
        .from(cashRegisterExpensesTable)
        .where(eq(cashRegisterExpensesTable.sessionId, sessionId));

      const reservations = await tx.select({
        id: reservationsTable.id,
        deposit: reservationsTable.deposit,
        depositMethod: reservationsTable.depositMethod,
      }).from(reservationsTable).where(and(
        eq(reservationsTable.cashRegisterSessionId, sessionId),
        sql`CAST(${reservationsTable.deposit} AS NUMERIC) > 0`,
      ));
      const resvPayments = reservations.length
        ? await tx.select().from(reservationPaymentsTable).where(inArray(reservationPaymentsTable.reservationId, reservations.map(r => r.id)))
        : [];
      let cashDeposits = 0;
      for (const resv of reservations) {
        const pList = resvPayments.filter(p => p.reservationId === resv.id);
        const effectivePayments = pList.length
          ? pList.map(p => ({ paymentMethod: p.paymentMethod, amount: Number(p.amount) }))
          : [{ paymentMethod: resv.depositMethod || "Efectivo", amount: Number(resv.deposit) }];
        cashDeposits += effectivePayments
          .filter(p => p.paymentMethod.toLowerCase().includes("efectivo"))
          .reduce((sum, p) => sum + p.amount, 0);
      }
      cashDeposits = roundMoney(cashDeposits);

      const expectedCash = roundMoney(
        Number(session.openingAmount) +
        cashSales +
        cashDeposits -
        expenses.reduce((sum, expense) => sum + Number(expense.amount), 0),
      );
      const counted = roundMoney(countedCash);
      await tx.update(cashRegisterSessionsTable).set({
        status: "closed",
        expectedCash: String(expectedCash),
        countedCash: String(counted),
        difference: String(roundMoney(counted - expectedCash)),
        closedAt: new Date(),
      }).where(eq(cashRegisterSessionsTable.id, sessionId));
      return { expectedCash, countedCash: counted, difference: roundMoney(counted - expectedCash) };
    });
    if (!result) {
      res.status(404).json({ message: "No se encontró una caja abierta de este usuario" });
      return;
    }
    const summary = await getSessionSummary(sessionId);
    res.json(summary);
    auditLog({ req, action: "closed", entity: "cash_register", entityId: sessionId, entityName: summary?.businessDate, details: result });
  } catch (err) {
    req.log.error({ err }, "CloseCashRegister error");
    res.status(500).json({ message: "No se pudo cerrar la caja" });
  }
});

export default router;
