import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const isCloudOrProd =
  process.env.NODE_ENV === "production" ||
  Boolean(process.env.DATABASE_URL?.includes("sslmode=require")) ||
  Boolean(process.env.DATABASE_URL?.includes("neon.tech")) ||
  Boolean(process.env.DATABASE_URL?.includes("supabase.co"));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isCloudOrProd ? { rejectUnauthorized: false } : undefined,
});

async function main() {
  try {
    const users = await pool.query('SELECT id, name, username, role, active FROM users');
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
