import pg from 'pg';
import fs from 'fs';

let LOCAL_URL = 'postgresql://postgres:12345@localhost:5432/bd_mimitos_artes_graficas';
if (fs.existsSync('.env')) {
  const content = fs.readFileSync('.env', 'utf-8');
  const match = content.match(/DATABASE_URL=["']?([^"'\r\n]+)["']?/);
  if (match) LOCAL_URL = match[1];
}

const { Pool } = pg;
const pool = new Pool({ connectionString: LOCAL_URL });

async function check() {
  try {
    const res = await pool.query(`
      SELECT conname, contype, pg_get_constraintdef(c.oid)
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE conrelid = 'products'::regclass;
    `);
    console.log('Constraints on products:');
    console.table(res.rows);

    const indexes = await pool.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'products';
    `);
    console.log('Indexes on products:');
    console.table(indexes.rows);

    const existingProducts = await pool.query('SELECT id, name, barcode FROM products LIMIT 10');
    console.log('Sample existing products:');
    console.table(existingProducts.rows);
  } finally {
    await pool.end();
  }
}

check();
