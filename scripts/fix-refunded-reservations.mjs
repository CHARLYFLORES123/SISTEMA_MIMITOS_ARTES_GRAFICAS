/**
 * Corrige reservas cuya venta de entrega fue anulada antes de que existiera
 * el flujo de devolución de adelanto (deposit_refunded).
 *
 * Para cada reserva con saleId que apunta a una venta CANCELADA:
 *  - Marca deposit_refunded = true (si tiene adelanto) con refund_method y refunded_at
 *  - Libera la reserva: saleId = null, status = 'listo_entrega' (y sus detalles)
 *  - Agrega nota explicativa
 *  - Registra la salida de caja (gasto) por la parte del adelanto en efectivo,
 *    si la sesión de caja de la venta anulada sigue abierta
 *
 * Uso:  node scripts/fix-refunded-reservations.mjs
 * Requiere DATABASE_URL (la lee de artifacts/api-server/.env si no está en el entorno)
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Resolver 'pg' desde el paquete lib/db (donde está instalado)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(join(__dirname, "..", "lib", "db", "package.json"));
const pg = require("pg");
const { Pool } = pg;

function loadEnv() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = join(process.cwd(), "artifacts", "api-server", ".env");
  try {
    const content = readFileSync(envPath, "utf8");
    const line = content
      .split("\n")
      .find((l) => l.trim().startsWith("DATABASE_URL="));
    if (!line) return null;
    const raw = line.slice(line.indexOf("=") + 1).trim();
    const match = raw.match(/^"(.*)"$/) || raw.match(/^'(.*)'$/);
    return match ? match[1] : raw;
  } catch {
    return null;
  }
}

const connectionString = loadEnv();
if (!connectionString) {
  console.error("❌ No se encontró DATABASE_URL");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString });

async function main() {
  console.log("🔄 Buscando reservas con venta de entrega anulada...\n");

  const { rows: reservations } = await pool.query(`
    SELECT r.id, r.status, r.total, r.deposit, r.deposit_method, r.sale_id, r.notes, r.cash_register_session_id
    FROM reservations r
    JOIN sales s ON s.id = r.sale_id
    WHERE s.status = 'cancelada'
      AND r.status != 'cancelada'
  `);

  if (reservations.length === 0) {
    console.log("✅ No hay reservas por corregir.");
    return;
  }

  console.log(`📋 ${reservations.length} reserva(s) con venta anulada:\n`);
  for (const r of reservations) {
    console.log(
      `   Reserva #${r.id} | venta #${r.sale_id} | adelanto: ${Number(r.deposit).toFixed(2)}`,
    );
  }
  console.log("");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let fixed = 0;

    for (const r of reservations) {
      const deposit = Number(r.deposit);

      // Métodos con que se recibió el adelanto
      const { rows: payments } = await client.query(
        `SELECT payment_method, amount FROM reservation_payments WHERE reservation_id = $1`,
        [r.id],
      );
      const effectivePayments = payments.length
        ? payments.map((p) => ({
            paymentMethod: p.payment_method,
            amount: Number(p.amount),
          }))
        : [{ paymentMethod: r.deposit_method || "Efectivo", amount: deposit }];

      const refundMethod = effectivePayments
        .map((p) => `Devolución ${p.paymentMethod}: ${p.amount.toFixed(2)}`)
        .join(" / ");

      const resvNotes = [
        r.notes,
        `ADELANTO DEVUELTO: Venta #${r.sale_id} anulada (corrección automática)${refundMethod ? ` (${refundMethod})` : ""}`,
      ]
        .filter(Boolean)
        .join(" | ");

      // 1. Marcar devolución y liberar la reserva
      await client.query(
        `UPDATE reservations
         SET sale_id = NULL,
             status = 'listo_entrega',
             notes = $2,
             deposit_refunded = $3,
             refund_method = $4,
             refunded_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [r.id, resvNotes, deposit > 0, deposit > 0 ? refundMethod : null],
      );

      // 2. Liberar los detalles
      await client.query(
        `UPDATE reservation_details SET status = 'listo_entrega', updated_at = NOW() WHERE reservation_id = $1`,
        [r.id],
      );

      // 3. Registrar salida de caja por la parte en efectivo, si la sesión sigue abierta
      if (deposit > 0) {
        const cashRefunded = effectivePayments
          .filter((p) => p.paymentMethod.toLowerCase().includes("efectivo"))
          .reduce((sum, p) => sum + p.amount, 0);

        if (cashRefunded > 0 && r.sale_id) {
          const { rows: sessions } = await client.query(
            `SELECT id, status FROM cash_register_sessions WHERE id = (
               SELECT cash_register_session_id FROM sales WHERE id = $1
             )`,
            [r.sale_id],
          );
          const session = sessions[0];
          if (session && session.status === "open") {
            const { rows: users } = await client.query(
              `SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`,
            );
            const adminId = users[0]?.id;
            if (adminId) {
              await client.query(
                `INSERT INTO cash_register_expenses (session_id, description, amount, authorized_by, created_at)
                 VALUES ($1, $2, $3, $4, NOW())`,
                [
                  session.id,
                  `Devolución de adelanto - Reserva #${r.id} (venta #${r.sale_id} anulada)`,
                  cashRefunded.toFixed(2),
                  adminId,
                ],
              );
            }
          }
        }
      }

      fixed++;
      console.log(
        `   ✅ Reserva #${r.id} corregida (adelanto devuelto: ${deposit.toFixed(2)})`,
      );
    }

    await client.query("COMMIT");
    console.log(`\n🎉 ${fixed} reserva(s) corregida(s) con éxito.`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error, se revirtieron los cambios:", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
