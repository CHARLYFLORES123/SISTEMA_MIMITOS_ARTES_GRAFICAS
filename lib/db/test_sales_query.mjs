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
  try {
    const dateFrom = '2026-10-25';
    const dateTo = '2026-10-25';
    const start = new Date(dateFrom);
    const end = new Date(new Date(dateTo).getTime() + 86399999);
    console.log('Query window UTC:', start.toISOString(), 'to', end.toISOString());

    const sales = await pool.query(
      `SELECT s.id, s.user_id, u.name as user_name, s.total, s.created_at, s.cash_register_session_id
       FROM sales s
       LEFT JOIN users u ON s.user_id = u.id
       WHERE s.created_at >= $1 AND s.created_at <= $2`,
      [start, end]
    );
    console.log('Sales returned for 2026-10-25:');
    console.table(sales.rows);

    const allSalesToday = await pool.query(
      `SELECT s.id, s.user_id, u.name as user_name, s.total, s.created_at, s.cash_register_session_id
       FROM sales s
       LEFT JOIN users u ON s.user_id = u.id
       JOIN cash_register_sessions cs ON s.cash_register_session_id = cs.id
       WHERE cs.business_date = '2026-10-25'`
    );
    console.log('Sales by cash register session 2026-10-25:');
    console.table(allSalesToday.rows);
  } finally {
    await pool.end();
  }
}
main();
