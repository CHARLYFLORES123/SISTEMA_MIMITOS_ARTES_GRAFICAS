import { Router } from "express";
import { db, quotesTable, quoteDetailsTable, productsTable, customersTable, salesTable, saleDetailsTable, usersTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { CreateQuoteBody, GetSalesQueryParams } from "@workspace/api-zod";
import { verifyToken, requireRoles, AuthRequest } from "../middlewares/auth";
import { auditLog } from "../lib/audit";
import { formatProductLabel } from "../lib/product-label";

const router = Router();
router.use(verifyToken);

const canWrite = requireRoles(["admin", "compras"]);

const IVA_RATE = 0;

function fmtQuote(q: any, customerName?: string | null, userName?: string | null) {
  return {
    id: q.id, customerId: q.customerId ?? null, customerName: customerName ?? null,
    userId: q.userId ?? null, userName: userName ?? null,
    subtotal: Number(q.subtotal), iva: Number(q.iva), total: Number(q.total),
    paymentMethod: q.paymentMethod, status: q.status, notes: q.notes ?? null,
    validUntil: q.validUntil instanceof Date ? q.validUntil.toISOString() : (q.validUntil ?? null),
    createdAt: q.createdAt instanceof Date ? q.createdAt.toISOString() : q.createdAt,
  };
}

// GET /api/quotes
router.get("/", async (req: AuthRequest, res) => {
  const { customerId, status } = req.query as any;
  try {
    const rows = await db
      .select({ quote: quotesTable, customerName: customersTable.name, userName: usersTable.name })
      .from(quotesTable)
      .leftJoin(customersTable, eq(quotesTable.customerId, customersTable.id))
      .leftJoin(usersTable, eq(quotesTable.userId, usersTable.id))
      .where(
        and(
          customerId ? eq(quotesTable.customerId, Number(customerId)) : undefined,
          status ? eq(quotesTable.status, String(status)) : undefined,
        )
      )
      .orderBy(sql`${quotesTable.createdAt} DESC`);
    res.json(rows.map(r => fmtQuote(r.quote, r.customerName, r.userName)));
  } catch (err) { req.log.error({ err }, "GetQuotes error"); res.status(500).json({ message: "Error interno" }); }
});

// POST /api/quotes — compras + admin
router.post("/", canWrite, async (req: AuthRequest, res) => {
  const parsed = CreateQuoteBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ message: "Datos inválidos" }); return; }
  const { customerId, items, paymentMethod, notes, validUntil } = parsed.data;

  try {
    const productIds = items.map(i => i.productId);
    const products = await db.select().from(productsTable).where(
      sql`${productsTable.id} = ANY(${sql.raw(`ARRAY[${productIds.join(",")}]::int[]`)})`
    );
    const productMap = new Map(products.map(p => [p.id, p]));

    const subtotal = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
    const iva = 0;
    const total = subtotal;

    const result = await db.transaction(async (tx) => {
      const [quote] = await tx.insert(quotesTable).values({
        customerId: customerId ?? null, userId: req.userId ?? null,
        subtotal: String(subtotal.toFixed(2)), iva: String(iva.toFixed(2)), total: String(total.toFixed(2)),
        paymentMethod, notes: notes ?? null, validUntil: validUntil ? new Date(validUntil) : null,
      }).returning();

      for (const item of items) {
        const p = productMap.get(item.productId);
        await tx.insert(quoteDetailsTable).values({
          quoteId: quote.id, productId: item.productId,
          productName: p ? formatProductLabel(p) : "Producto desconocido",
          quantity: item.quantity, unitPrice: String(item.unitPrice.toFixed(2)),
          subtotal: String((item.unitPrice * item.quantity).toFixed(2)),
        });
      }
      return quote;
    });

    let customerName: string | null = null;
    if (customerId) {
      const [c] = await db.select({ name: customersTable.name }).from(customersTable).where(eq(customersTable.id, customerId)).limit(1);
      customerName = c?.name ?? null;
    }

    res.status(201).json(fmtQuote(result, customerName));
    auditLog({ req, action: "created", entity: "quote", entityId: result.id, entityName: customerName ?? `Cotización #${result.id}`, details: { total } });
  } catch (err) { req.log.error({ err }, "CreateQuote error"); res.status(500).json({ message: "Error interno" }); }
});

// GET /api/quotes/:id
router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const [row] = await db
      .select({ quote: quotesTable, customerName: customersTable.name, userName: usersTable.name })
      .from(quotesTable)
      .leftJoin(customersTable, eq(quotesTable.customerId, customersTable.id))
      .leftJoin(usersTable, eq(quotesTable.userId, usersTable.id))
      .where(eq(quotesTable.id, id)).limit(1);
    if (!row) { res.status(404).json({ message: "Cotización no encontrada" }); return; }
    const details = await db.select().from(quoteDetailsTable).where(eq(quoteDetailsTable.quoteId, id));
    res.json({
      ...fmtQuote(row.quote, row.customerName, row.userName),
      details: details.map(d => ({
        id: d.id, productId: d.productId ?? null, productName: d.productName,
        quantity: d.quantity, unitPrice: Number(d.unitPrice), subtotal: Number(d.subtotal),
      })),
    });
  } catch (err) { req.log.error({ err }, "GetQuoteById error"); res.status(500).json({ message: "Error interno" }); }
});

// POST /api/quotes/:id/convert — compras + admin
router.post("/:id/convert", canWrite, async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  try {
    const [quote] = await db.select().from(quotesTable).where(eq(quotesTable.id, id)).limit(1);
    if (!quote) { res.status(404).json({ message: "Cotización no encontrada" }); return; }
    if (quote.status !== "pendiente") { res.status(400).json({ message: "La cotización ya fue convertida o está vencida" }); return; }

    const details = await db.select().from(quoteDetailsTable).where(eq(quoteDetailsTable.quoteId, id));
    const productIds = details.filter(d => d.productId).map(d => d.productId!);
    const products = productIds.length > 0
      ? await db.select().from(productsTable).where(sql`${productsTable.id} = ANY(${sql.raw(`ARRAY[${productIds.join(",")}]::int[]`)})`)
      : [];
    const productMap = new Map(products.map(p => [p.id, p]));

    for (const d of details) {
      if (!d.productId) continue;
      const p = productMap.get(d.productId);
      if (p && p.stock < d.quantity) {
        res.status(400).json({ message: `Stock insuficiente para ${p.name}. Disponible: ${p.stock}` });
        return;
      }
    }

    const sale = await db.transaction(async (tx) => {
      const [newSale] = await tx.insert(salesTable).values({
        customerId: quote.customerId, userId: req.userId ?? null,
        subtotal: quote.subtotal, iva: quote.iva, total: quote.total,
        paymentMethod: quote.paymentMethod, notes: quote.notes,
      }).returning();

      for (const d of details) {
        await tx.insert(saleDetailsTable).values({
          saleId: newSale.id, productId: d.productId, productName: d.productName,
          quantity: String(d.quantity), unitPrice: d.unitPrice, subtotal: d.subtotal,
        });
        if (d.productId) {
          const p = productMap.get(d.productId);
          if (p) {
            await tx.update(productsTable).set({ stock: p.stock - d.quantity }).where(eq(productsTable.id, d.productId));
          }
        }
      }

      await tx.update(quotesTable).set({ status: "convertida", convertedSaleId: newSale.id }).where(eq(quotesTable.id, id));
      return newSale;
    });

    let customerName: string | null = null;
    if (sale.customerId) {
      const [c] = await db.select({ name: customersTable.name }).from(customersTable).where(eq(customersTable.id, sale.customerId)).limit(1);
      customerName = c?.name ?? null;
    }

    res.status(201).json({
      id: sale.id, customerId: sale.customerId ?? null, customerName,
      subtotal: Number(sale.subtotal), iva: Number(sale.iva), total: Number(sale.total),
      paymentMethod: sale.paymentMethod, status: sale.status,
      notes: sale.notes ?? null, createdAt: sale.createdAt.toISOString(),
    });
    auditLog({ req, action: "converted", entity: "quote", entityId: id, entityName: `Cotización #${id} → Venta #${sale.id}`, details: { saleId: sale.id, total: Number(sale.total) } });
  } catch (err) { req.log.error({ err }, "ConvertQuoteToSale error"); res.status(500).json({ message: "Error interno" }); }
});

export default router;
