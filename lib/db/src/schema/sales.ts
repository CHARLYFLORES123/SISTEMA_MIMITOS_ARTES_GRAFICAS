import { pgTable, serial, integer, numeric, varchar, text, timestamp, date, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { customersTable } from "./customers";
import { usersTable } from "./users";
import { productsTable } from "./products";

export const cashRegisterSessionsTable = pgTable("cash_register_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  businessDate: varchar("business_date", { length: 10 }).notNull(),
  openingAmount: numeric("opening_amount", { precision: 12, scale: 2 }).notNull(),
  expectedCash: numeric("expected_cash", { precision: 12, scale: 2 }),
  countedCash: numeric("counted_cash", { precision: 12, scale: 2 }),
  difference: numeric("difference", { precision: 12, scale: 2 }),
  status: varchar("status", { length: 20 }).notNull().default("open"),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("cash_register_user_business_date_unique").on(table.userId, table.businessDate),
]);

export const cashRegisterExpensesTable = pgTable("cash_register_expenses", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => cashRegisterSessionsTable.id, { onDelete: "cascade" }),
  description: varchar("description", { length: 300 }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  authorizedBy: integer("authorized_by").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const salesTable = pgTable("sales", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
  discount: numeric("discount", { precision: 12, scale: 2 }).notNull().default("0"),
  iva: numeric("iva", { precision: 12, scale: 2 }).notNull(),
  total: numeric("total", { precision: 12, scale: 2 }).notNull(),
  paymentMethod: varchar("payment_method", { length: 50 }).notNull().default("Efectivo"),
  cashRegisterSessionId: integer("cash_register_session_id").references(() => cashRegisterSessionsTable.id, { onDelete: "set null" }),
  amountPaid: numeric("amount_paid", { precision: 12, scale: 2 }),
  changeDue: numeric("change_due", { precision: 12, scale: 2 }),
  status: varchar("status", { length: 30 }).notNull().default("completada"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const salePaymentsTable = pgTable("sale_payments", {
  id: serial("id").primaryKey(),
  saleId: integer("sale_id").notNull().references(() => salesTable.id, { onDelete: "cascade" }),
  paymentMethod: varchar("payment_method", { length: 100 }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
});

export const saleDetailsTable = pgTable("sale_details", {
  id: serial("id").primaryKey(),
  saleId: integer("sale_id").notNull().references(() => salesTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => productsTable.id, { onDelete: "set null" }),
  productName: varchar("product_name", { length: 300 }).notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull(),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reservationsTable = pgTable("reservations", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  status: varchar("status", { length: 30 }).notNull().default("reserva"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull(),
  deposit: numeric("deposit", { precision: 12, scale: 2 }).notNull().default("0"),
  depositMethod: varchar("deposit_method", { length: 255 }),
  cashRegisterSessionId: integer("cash_register_session_id").references(() => cashRegisterSessionsTable.id, { onDelete: "set null" }),
  reservationDate: date("reservation_date").notNull().defaultNow(),
  expectedAt: date("expected_at"),
  notes: text("notes"),
  saleId: integer("sale_id").references(() => salesTable.id, { onDelete: "set null" }),
  depositRefunded: boolean("deposit_refunded").notNull().default(false),
  refundMethod: varchar("refund_method", { length: 255 }),
  refundedAt: timestamp("refunded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const reservationPaymentsTable = pgTable("reservation_payments", {
  id: serial("id").primaryKey(),
  reservationId: integer("reservation_id").notNull().references(() => reservationsTable.id, { onDelete: "cascade" }),
  paymentMethod: varchar("payment_method", { length: 100 }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reservationDetailsTable = pgTable("reservation_details", {
  id: serial("id").primaryKey(),
  reservationId: integer("reservation_id").notNull().references(() => reservationsTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => productsTable.id, { onDelete: "set null" }),
  productName: varchar("product_name", { length: 300 }).notNull(),
  specifications: text("specifications").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull(),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
  status: varchar("status", { length: 30 }).notNull().default("reserva"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSaleSchema = createInsertSchema(salesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSaleDetailSchema = createInsertSchema(saleDetailsTable).omit({ id: true, createdAt: true });
export type InsertSale = z.infer<typeof insertSaleSchema>;
export type InsertSaleDetail = z.infer<typeof insertSaleDetailSchema>;
export type Sale = typeof salesTable.$inferSelect;
export type SaleDetail = typeof saleDetailsTable.$inferSelect;
export type SalePayment = typeof salePaymentsTable.$inferSelect;
export type Reservation = typeof reservationsTable.$inferSelect;
export type ReservationPayment = typeof reservationPaymentsTable.$inferSelect;
export type ReservationDetail = typeof reservationDetailsTable.$inferSelect;
export type CashRegisterSession = typeof cashRegisterSessionsTable.$inferSelect;
export type CashRegisterExpense = typeof cashRegisterExpensesTable.$inferSelect;
