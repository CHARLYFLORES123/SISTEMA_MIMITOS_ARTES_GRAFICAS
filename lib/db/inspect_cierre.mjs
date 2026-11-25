import pg from 'pg';
import fs from 'fs';
import path from 'path';

// read .env manually
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
    const users = await pool.query('SELECT id, name, email, role FROM users');
    console.log('USERS:');
    console.table(users.rows);

    const sessions = await pool.query(`
      SELECT s.id, s.user_id, u.name as user_name, u.role, s.business_date, s.status, s.opening_amount
      FROM cash_register_sessions s
      JOIN users u ON s.user_id = u.id
      ORDER BY s.id DESC LIMIT 10
    `);
    console.log('\nRECENT CASH SESSIONS:');
    console.table(sessions.rows);

    const reservations = await pool.query(`
      SELECT r.id, r.user_id, u.name as user_name, r.deposit, r.deposit_method, r.cash_register_session_id, r.reservation_date, r.status
      FROM reservations r
      LEFT JOIN users u ON r.user_id = u.id
      ORDER BY r.id DESC LIMIT 10
    `);
    console.log('\nRECENT RESERVATIONS:');
    console.table(reservations.rows);

    const sales = await pool.query(`
      SELECT s.id, s.user_id, u.name as user_name, s.total, s.payment_method, s.cash_register_session_id, s.status, s.created_at
      FROM sales s
      LEFT JOIN users u ON s.user_id = u.id
      ORDER BY s.id DESC LIMIT 10
    `);
    console.log('\nRECENT SALES:');
    console.table(sales.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
main();
