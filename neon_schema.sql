-- =====================================================================
-- ESQUEMA COMPLETO PARA NEON SQL EDITOR - SISTEMA VENTA DE ROPA (POS)
-- Copia y pega todo este script en el SQL Editor de Neon y dale a "Run"
-- =====================================================================

-- 1. TABLA DE USUARIOS
CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"email" varchar(256) NOT NULL,
	"password_hash" text NOT NULL,
	"role" varchar(50) DEFAULT 'admin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);

-- 2. TABLA DE CATEGORÍAS
CREATE TABLE IF NOT EXISTS "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- 3. TABLA DE MARCAS
CREATE TABLE IF NOT EXISTS "brands" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- 4. TABLA DE CLIENTES
CREATE TABLE IF NOT EXISTS "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(300) NOT NULL,
	"nit_ci" varchar(50),
	"email" varchar(256),
	"phone" varchar(30),
	"address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- 5. TABLA DE PROVEEDORES
CREATE TABLE IF NOT EXISTS "suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(300) NOT NULL,
	"nit_ci" varchar(50),
	"contact_name" varchar(200),
	"email" varchar(256),
	"phone" varchar(30),
	"whatsapp" varchar(30),
	"address" text,
	"city" varchar(150),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- 6. TABLA DE PRODUCTOS
CREATE TABLE IF NOT EXISTS "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(300) NOT NULL,
	"sku" varchar(100),
	"barcode" varchar(100),
	"description" text,
	"size" varchar(50),
	"color" varchar(100),
	"subcategory" varchar(200),
	"material" varchar(200),
	"season" varchar(100),
	"gender" varchar(50),
	"supplier_id" integer,
	"entry_date" date DEFAULT now() NOT NULL,
	"purchase_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"sale_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"wholesale_price" numeric(12, 2),
	"promotional_price" numeric(12, 2),
	"stock" integer DEFAULT 0 NOT NULL,
	"min_stock" integer DEFAULT 5 NOT NULL,
	"category_id" integer,
	"brand_id" integer,
	"image_url" text,
	"image_urls" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "products_sku_unique" ON "products" ("sku");

-- 7. TABLA DE DOCUMENTOS DE INVENTARIO
CREATE TABLE IF NOT EXISTS "inventory_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" varchar(30) NOT NULL,
	"status" varchar(30) NOT NULL,
	"supplier_id" integer,
	"supplier_name" varchar(300),
	"reference" varchar(150),
	"invoice_file_name" varchar(255),
	"invoice_mime_type" varchar(100),
	"invoice_file_data" text,
	"notes" text,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"payment_method" varchar(100),
	"payment_type" varchar(20),
	"amount_paid" numeric(12, 2),
	"balance_pending" numeric(12, 2),
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- 8. ÍTEMS DE DOCUMENTOS DE INVENTARIO
CREATE TABLE IF NOT EXISTS "inventory_document_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"counted_stock" integer,
	"unit_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"notes" text
);

-- 9. SESIONES DE CAJA
CREATE TABLE IF NOT EXISTS "cash_register_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"business_date" varchar(10) NOT NULL,
	"opening_amount" numeric(12, 2) NOT NULL,
	"expected_cash" numeric(12, 2),
	"counted_cash" numeric(12, 2),
	"difference" numeric(12, 2),
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS "cash_register_user_business_date_unique" ON "cash_register_sessions" ("user_id", "business_date");

-- 10. GASTOS DE CAJA
CREATE TABLE IF NOT EXISTS "cash_register_expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"description" varchar(300) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"authorized_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- 11. VENTAS
CREATE TABLE IF NOT EXISTS "sales" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer,
	"user_id" integer,
	"subtotal" numeric(12, 2) NOT NULL,
	"discount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"iva" numeric(12, 2) NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"payment_method" varchar(50) DEFAULT 'Efectivo' NOT NULL,
	"cash_register_session_id" integer,
	"amount_paid" numeric(12, 2),
	"change_due" numeric(12, 2),
	"status" varchar(30) DEFAULT 'completada' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- 12. DETALLES DE VENTA
CREATE TABLE IF NOT EXISTS "sale_details" (
	"id" serial PRIMARY KEY NOT NULL,
	"sale_id" integer NOT NULL,
	"product_id" integer,
	"product_name" varchar(300) NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- 13. PAGOS DE VENTA MULTI-MÉTODO
CREATE TABLE IF NOT EXISTS "sale_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"sale_id" integer NOT NULL,
	"payment_method" varchar(100) NOT NULL,
	"amount" numeric(12, 2) NOT NULL
);

-- 14. COTIZACIONES
CREATE TABLE IF NOT EXISTS "quotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer,
	"user_id" integer,
	"subtotal" numeric(12, 2) NOT NULL,
	"iva" numeric(12, 2) NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"payment_method" varchar(50) DEFAULT 'Efectivo' NOT NULL,
	"status" varchar(30) DEFAULT 'pendiente' NOT NULL,
	"notes" text,
	"valid_until" timestamp with time zone,
	"converted_sale_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- 15. DETALLES DE COTIZACIÓN
CREATE TABLE IF NOT EXISTS "quote_details" (
	"id" serial PRIMARY KEY NOT NULL,
	"quote_id" integer NOT NULL,
	"product_id" integer,
	"product_name" varchar(300) NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- 16. CONFIGURACIÓN DEL NEGOCIO
CREATE TABLE IF NOT EXISTS "business_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_name" varchar(300) DEFAULT 'Mi Empresa' NOT NULL,
	"ruc_nit" varchar(50),
	"phone" varchar(30),
	"email" varchar(256),
	"address" text,
	"logo_url" text,
	"currency" varchar(10) DEFAULT 'BOB' NOT NULL,
	"currency_symbol" varchar(10) DEFAULT 'Bs' NOT NULL,
	"loyalty_enabled" boolean DEFAULT true NOT NULL,
	"points_per_unit" integer DEFAULT 1 NOT NULL,
	"points_redemption_rate" numeric(8, 4) DEFAULT '0.01' NOT NULL,
	"open_cash_drawer" boolean DEFAULT true NOT NULL,
	"cash_drawer_only_cash" boolean DEFAULT true NOT NULL,
	"printer_name" varchar(200),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- 17. MÉTODOS DE PAGO
CREATE TABLE IF NOT EXISTS "payment_methods" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- 18. PUNTOS DE FIDELIZACIÓN POR CLIENTE
CREATE TABLE IF NOT EXISTS "customer_points" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"lifetime_earned" integer DEFAULT 0 NOT NULL,
	"lifetime_redeemed" integer DEFAULT 0 NOT NULL,
	"tier" varchar(20) DEFAULT 'bronze' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_points_customer_id_unique" UNIQUE("customer_id")
);

-- 19. HISTORIAL DE PUNTOS
CREATE TABLE IF NOT EXISTS "points_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"delta" integer NOT NULL,
	"type" varchar(30) NOT NULL,
	"sale_id" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- 20. CUPONES DE DESCUENTO
CREATE TABLE IF NOT EXISTS "coupons" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(30) NOT NULL,
	"customer_id" integer NOT NULL,
	"tier" varchar(20) NOT NULL,
	"discount_percent" numeric(5, 2) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_in_sale_id" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_code_unique" UNIQUE("code")
);

-- 21. REGISTROS DE AUDITORÍA
CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"user_name" varchar(200),
	"user_role" varchar(50),
	"action" varchar(50) NOT NULL,
	"entity" varchar(50) NOT NULL,
	"entity_id" integer,
	"entity_name" varchar(300),
	"details" jsonb,
	"ip" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- =====================================================================
-- CLAVES FORÁNEAS (RELACIONES)
-- =====================================================================

DO $$
BEGIN
  -- products fk
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_supplier_id_suppliers_id_fk') THEN
    ALTER TABLE "products" ADD CONSTRAINT "products_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_category_id_categories_id_fk') THEN
    ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_brand_id_brands_id_fk') THEN
    ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL;
  END IF;

  -- inventory fk
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_documents_supplier_id_suppliers_id_fk') THEN
    ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_documents_created_by_users_id_fk') THEN
    ALTER TABLE "inventory_documents" ADD CONSTRAINT "inventory_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_document_items_document_id_inventory_documents_id_fk') THEN
    ALTER TABLE "inventory_document_items" ADD CONSTRAINT "inventory_document_items_document_id_inventory_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "inventory_documents"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_document_items_product_id_products_id_fk') THEN
    ALTER TABLE "inventory_document_items" ADD CONSTRAINT "inventory_document_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT;
  END IF;

  -- cash register fk
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_register_sessions_user_id_users_id_fk') THEN
    ALTER TABLE "cash_register_sessions" ADD CONSTRAINT "cash_register_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_register_expenses_session_id_cash_register_sessions_id_fk') THEN
    ALTER TABLE "cash_register_expenses" ADD CONSTRAINT "cash_register_expenses_session_id_cash_register_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "cash_register_sessions"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_register_expenses_authorized_by_users_id_fk') THEN
    ALTER TABLE "cash_register_expenses" ADD CONSTRAINT "cash_register_expenses_authorized_by_users_id_fk" FOREIGN KEY ("authorized_by") REFERENCES "users"("id") ON DELETE RESTRICT;
  END IF;

  -- sales fk
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_customer_id_customers_id_fk') THEN
    ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_user_id_users_id_fk') THEN
    ALTER TABLE "sales" ADD CONSTRAINT "sales_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_cash_register_session_id_cash_register_sessions_id_fk') THEN
    ALTER TABLE "sales" ADD CONSTRAINT "sales_cash_register_session_id_cash_register_sessions_id_fk" FOREIGN KEY ("cash_register_session_id") REFERENCES "cash_register_sessions"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_details_sale_id_sales_id_fk') THEN
    ALTER TABLE "sale_details" ADD CONSTRAINT "sale_details_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_details_product_id_products_id_fk') THEN
    ALTER TABLE "sale_details" ADD CONSTRAINT "sale_details_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_payments_sale_id_sales_id_fk') THEN
    ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE;
  END IF;

  -- quotes fk
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotes_customer_id_customers_id_fk') THEN
    ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quotes_user_id_users_id_fk') THEN
    ALTER TABLE "quotes" ADD CONSTRAINT "quotes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quote_details_quote_id_quotes_id_fk') THEN
    ALTER TABLE "quote_details" ADD CONSTRAINT "quote_details_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quote_details_product_id_products_id_fk') THEN
    ALTER TABLE "quote_details" ADD CONSTRAINT "quote_details_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL;
  END IF;

  -- loyalty & coupons fk
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_points_customer_id_customers_id_fk') THEN
    ALTER TABLE "customer_points" ADD CONSTRAINT "customer_points_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'points_transactions_customer_id_customers_id_fk') THEN
    ALTER TABLE "points_transactions" ADD CONSTRAINT "points_transactions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'points_transactions_sale_id_sales_id_fk') THEN
    ALTER TABLE "points_transactions" ADD CONSTRAINT "points_transactions_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coupons_customer_id_customers_id_fk') THEN
    ALTER TABLE "coupons" ADD CONSTRAINT "coupons_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coupons_used_in_sale_id_sales_id_fk') THEN
    ALTER TABLE "coupons" ADD CONSTRAINT "coupons_used_in_sale_id_sales_id_fk" FOREIGN KEY ("used_in_sale_id") REFERENCES "sales"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- =====================================================================
-- DATOS INICIALES (USUARIOS DEMO Y CONFIGURACIÓN)
-- =====================================================================

-- Configuración básica del negocio
INSERT INTO "business_settings" ("id", "company_name", "currency", "currency_symbol", "loyalty_enabled", "points_per_unit", "points_redemption_rate", "open_cash_drawer", "cash_drawer_only_cash")
VALUES (1, 'Mi Tienda de Ropa', 'BOB', 'Bs', true, 1, 0.01, true, true)
ON CONFLICT ("id") DO NOTHING;

-- Métodos de pago habituales
INSERT INTO "payment_methods" ("name", "description", "is_active") VALUES
('Efectivo', 'Pago en efectivo', true),
('Tarjeta', 'Pago con tarjeta POS', true),
('QR / Transferencia', 'Pago móvil QR o transferencia bancaria', true)
ON CONFLICT DO NOTHING;

-- Usuarios de acceso por defecto (contraseña encriptada: admin123, vendedor123, etc.)
INSERT INTO "users" ("name", "email", "password_hash", "role") VALUES
('Administrador Demo', 'admin@demo.com', '$2b$10$p6A5b4a.pZll5gbMtjTEGOEurNPcSQNLJzyi8LGf7igTxYg4M2yLS', 'admin'),
('Vendedor Demo', 'vendedor@demo.com', '$2b$10$8blPn3ujxLIFjzkM3B8hsOMQvmHWlEnzjJIshGTz9XeAFFPpptX/e', 'vendedor'),
('Inventario Demo', 'inventario@demo.com', '$2b$10$wbWJlZ2qUkeaRZHoyy4rdeoCCD.Qwg78ekdCAVVxFgcf5yi/Fxl8y', 'inventario'),
('Compras Demo', 'compras@demo.com', '$2b$10$Jw7dZ0s4vhSj67NMn23kM..M5sErP6eNGuZ0lSjFf5nQbASblSQqK', 'compras')
ON CONFLICT ("email") DO NOTHING;
