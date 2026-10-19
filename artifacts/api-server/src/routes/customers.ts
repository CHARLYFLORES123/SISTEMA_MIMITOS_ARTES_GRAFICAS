import { Router } from "express";
import { db, customersTable, salesTable, saleDetailsTable } from "@workspace/db";
import { eq, ilike, or, count, sum, min, max, avg } from "drizzle-orm";
import { CreateCustomerBody, GetCustomersQueryParams } from "@workspace/api-zod";
import { verifyToken, requireRoles, requireAdmin, AuthRequest } from "../middlewares/auth";
import { auditLog } from "../lib/audit";

const router = Router();
router.use(verifyToken);

const canWrite = requireRoles(["admin", "vendedor"]);
const canCreate = requireRoles(["admin", "vendedor", "diseñador"]);

function formatCustomer(c: any, totalPurchases = 0) {
  return {
    id: c.id, name: c.name, nitCi: c.nitCi ?? null, email: c.email ?? null,
    phone: c.phone ?? null, address: c.address ?? null, totalPurchases,
    createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt,
  };
}

// GET /api/customers
router.get("/", async (req, res) => {
  const parsed = GetCustomersQueryParams.safeParse(req.query);
  const { search } = parsed.success ? parsed.data : {} as any;

  try {
    const rows = await db
      .select({
        id: customersTable.id, name: customersTable.name, nitCi: customersTable.nitCi,
        email: customersTable.email, phone: customersTable.phone, address: customersTable.address,
        createdAt: customersTable.createdAt, totalPurchases: count(salesTable.id),
      })
      .from(customersTable)
      .leftJoin(salesTable, eq(salesTable.customerId, customersTable.id))
      .where(search ? or(
        ilike(customersTable.name, `%${search}%`),
        ilike(customersTable.nitCi, `%${search}%`),
        ilike(customersTable.phone, `%${search}%`)
      ) : undefined)
      .groupBy(customersTable.id)
      .orderBy(customersTable.name);

    res.json(rows.map(r => formatCustomer(r, Number(r.totalPurchases))));
  } catch (err) {
    req.log.error({ err }, "GetCustomers error");
    res.status(500).json({ message: "Error interno" });
  }
});

// POST /api/customers — vendedor + admin
router.post("/", canCreate, async (req: AuthRequest, res) => {
  const parsed = CreateCustomerBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: "Datos inválidos" }); return; }

  try {
    const [c] = await db.insert(customersTable).values(parsed.data).returning();
    res.status(201).json(formatCustomer(c));
    auditLog({ req, action: "created", entity: "customer", entityId: c.id, entityName: c.name });
  } catch (err) {
    req.log.error({ err }, "CreateCustomer error");
    res.status(500).json({ message: "Error interno" });
  }
});

// GET /api/customers/:id
router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const [c] = await db.select().from(customersTable).where(eq(customersTable.id, id)).limit(1);
    if (!c) { res.status(404).json({ message: "Cliente no encontrado" }); return; }
    const [{ total }] = await db.select({ total: count(salesTable.id) }).from(salesTable).where(eq(salesTable.customerId, id));
    res.json(formatCustomer(c, Number(total)));
  } catch (err) {
    req.log.error({ err }, "GetCustomerById error");
    res.status(500).json({ message: "Error interno" });
  }
});

// PUT /api/customers/:id — vendedor + admin
router.put("/:id", canWrite, async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const parsed = CreateCustomerBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: "Datos inválidos" }); return; }

  try {
    const [c] = await db.update(customersTable).set(parsed.data).where(eq(customersTable.id, id)).returning();
    if (!c) { res.status(404).json({ message: "Cliente no encontrado" }); return; }
    res.json(formatCustomer(c));
    auditLog({ req, action: "updated", entity: "customer", entityId: c.id, entityName: c.name });
  } catch (err) {
    req.log.error({ err }, "UpdateCustomer error");
    res.status(500).json({ message: "Error interno" });
  }
});

// GET /api/customers/:id/statement
router.get("/:id/statement", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const [c] = await db.select().from(customersTable).where(eq(customersTable.id, id)).limit(1);
    if (!c) { res.status(404).json({ message: "Cliente no encontrado" }); return; }

    const stats = await db
      .select({
        totalSpent: sum(salesTable.total), saleCount: count(salesTable.id),
        averageTicket: avg(salesTable.total), firstPurchase: min(salesTable.createdAt),
        lastPurchase: max(salesTable.createdAt),
      })
      .from(salesTable)
      .where(eq(salesTable.customerId, id));

    const salesRows = await db.select().from(salesTable).where(eq(salesTable.customerId, id)).orderBy(salesTable.createdAt);

    res.json({
      id: c.id, name: c.name, nitCi: c.nitCi ?? null, email: c.email ?? null,
      phone: c.phone ?? null, address: c.address ?? null,
      totalSpent: Number(stats[0]?.totalSpent ?? 0),
      saleCount: Number(stats[0]?.saleCount ?? 0),
      averageTicket: Number(stats[0]?.averageTicket ?? 0),
      firstPurchase: stats[0]?.firstPurchase instanceof Date ? stats[0].firstPurchase.toISOString() : (stats[0]?.firstPurchase ?? null),
      lastPurchase: stats[0]?.lastPurchase instanceof Date ? stats[0].lastPurchase.toISOString() : (stats[0]?.lastPurchase ?? null),
      sales: salesRows.map(s => ({
        id: s.id,
        createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
        paymentMethod: s.paymentMethod, status: s.status,
        subtotal: Number(s.subtotal), iva: Number(s.iva), total: Number(s.total),
        notes: s.notes ?? null,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "GetCustomerStatement error");
    res.status(500).json({ message: "Error interno" });
  }
});

// DELETE /api/customers/:id — admin only
router.delete("/:id", requireAdmin, async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  try {
    const [c] = await db.select().from(customersTable).where(eq(customersTable.id, id)).limit(1);
    await db.delete(customersTable).where(eq(customersTable.id, id));
    res.json({ message: "Cliente eliminado" });
    auditLog({ req, action: "deleted", entity: "customer", entityId: id, entityName: c?.name });
  } catch (err) {
    req.log.error({ err }, "DeleteCustomer error");
    res.status(500).json({ message: "Error interno" });
  }
});

export default router;
