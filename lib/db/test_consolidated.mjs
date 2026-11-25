import pg from 'pg';
import fs from 'fs';
import path from 'path';

let dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  try {
    const envContent = fs.readFileSync(path.resolve('.env'), 'utf8');
    for (const line of envContent.split('\n')) {
      if (line.trim().startsWith('DATABASE_URL=')) {
        dbUrl = line.trim().substring('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch (e) {}
}

const { Pool } = pg;
const isCloudOrProd =
  process.env.NODE_ENV === "production" ||
  Boolean(dbUrl?.includes("sslmode=require")) ||
  Boolean(dbUrl?.includes("neon.tech")) ||
  Boolean(dbUrl?.includes("supabase.co"));

const pool = new Pool({
  connectionString: dbUrl,
  ssl: isCloudOrProd ? { rejectUnauthorized: false } : undefined,
});

async function main() {
  const date = '2026-10-25';
  console.log('Testing consolidated summary for:', date);

  // 1. Sessions
  const sessions = await pool.query(
    `SELECT cs.*, u.name as user_name, u.role as user_role
     FROM cash_register_sessions cs
     JOIN users u ON cs.user_id = u.id
     WHERE cs.business_date = $1
     ORDER BY cs.id`,
    [date]
  );
  console.log('Sessions count:', sessions.rows.length);

  // 2. Sales
  const sessionIds = sessions.rows.map(s => s.id);
  const sales = await pool.query(
    `SELECT s.*, u.name as user_name
     FROM sales s
     LEFT JOIN users u ON s.user_id = u.id
     WHERE s.status = 'completada' AND (
       ($1::int[] IS NOT NULL AND s.cash_register_session_id = ANY($1::int[]))
       OR s.created_at::date = $2::date
     )`,
    [sessionIds.length ? sessionIds : null, date]
  );
  console.log('Sales count:', sales.rows.length);
  console.table(sales.rows.map(s => ({ id: s.id, user: s.user_name, total: s.total, method: s.payment_method })));

  // 3. Reservations
  const reservations = await pool.query(
    `SELECT r.*, u.name as user_name, c.name as customer_name
     FROM reservations r
     LEFT JOIN users u ON r.user_id = u.id
     LEFT JOIN customers c ON r.customer_id = c.id
     WHERE CAST(r.deposit AS numeric) > 0 AND (
       ($1::int[] IS NOT NULL AND r.cash_register_session_id = ANY($1::int[]))
       OR r.reservation_date::text = $2
       OR r.created_at::date = $2::date
     )
     ORDER BY r.id`,
    [sessionIds.length ? sessionIds : null, date]
  );
  console.log('Reservations count:', reservations.rows.length);
  console.table(reservations.rows.map(r => ({ id: r.id, user: r.user_name, deposit: r.deposit, method: r.deposit_method, session: r.cash_register_session_id })));

  await pool.end();
}
main();
