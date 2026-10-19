import pg from 'pg';
import fs from 'fs';

let LOCAL_URL = 'postgresql://postgres:12345@localhost:5432/bd_mimitos_artes_graficas';
if (fs.existsSync('.env')) {
  const content = fs.readFileSync('.env', 'utf-8');
  const match = content.match(/DATABASE_URL=["']?([^"'\r\n]+)["']?/);
  if (match) {
    LOCAL_URL = match[1];
  }
}

const NEON_URL = 'postgresql://neondb_owner:npg_iCEzx0sqaL9S@ep-round-dawn-aexfn52a-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require';

const { Pool } = pg;

async function testConnection(name, url, isSsl = false) {
  const pool = new Pool({
    connectionString: url,
    ssl: isSsl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 5000,
  });

  try {
    const res = await pool.query('SELECT current_database(), count(*) as prod_count FROM products');
    console.log(`[${name}] Conectado a DB "${res.rows[0].current_database}". Cantidad de productos: ${res.rows[0].prod_count}`);
    const cats = await pool.query('SELECT count(*) as cat_count FROM categories');
    console.log(`[${name}] Cantidad de categorias: ${cats.rows[0].cat_count}`);
    return pool;
  } catch (err) {
    console.error(`[${name}] Error:`, err.message);
    return null;
  }
}

async function run() {
  console.log('--- Probando Local (' + LOCAL_URL + ') ---');
  const local = await testConnection('LOCAL', LOCAL_URL, false);
  if (local) await local.end();

  console.log('\n--- Probando Neon ---');
  const neon = await testConnection('NEON', NEON_URL, true);
  if (neon) await neon.end();
}

run();
