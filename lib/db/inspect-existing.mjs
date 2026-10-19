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

async function run() {
  try {
    const cats = await pool.query('SELECT id, name FROM categories ORDER BY id');
    console.log('Categories in DB:');
    console.table(cats.rows);

    const prods = await pool.query('SELECT id, name, barcode, purchase_price, sale_price, stock, category_id FROM products ORDER BY id');
    console.log('Products in DB (' + prods.rows.length + '):');
    console.table(prods.rows);
  } finally {
    await pool.end();
  }
}

run();
