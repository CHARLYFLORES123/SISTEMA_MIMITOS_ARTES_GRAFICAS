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

const content = fs.readFileSync('textos para base datos.txt', 'utf-8');
const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);

async function checkOverlap() {
  try {
    const existing = await pool.query('SELECT id, name, barcode FROM products');
    console.log('Existing DB products count:', existing.rows.length);

    const fileItems = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split('\t').map(s => s.trim());
      fileItems.push({
        line: i,
        barcode: parts[0],
        name: parts[1]
      });
    }

    const matchesByName = [];
    const matchesByBarcode = [];

    for (const ex of existing.rows) {
      const matchName = fileItems.find(f => f.name && f.name.toLowerCase() === ex.name.toLowerCase());
      if (matchName) matchesByName.push({ db: ex, file: matchName });

      const matchCode = fileItems.find(f => f.barcode && f.barcode === ex.barcode);
      if (matchCode) matchesByBarcode.push({ db: ex, file: matchCode });
    }

    console.log('Matches by name:', matchesByName.length);
    console.log('Matches by barcode:', matchesByBarcode.length);
    if (matchesByName.length > 0) {
      console.log('Sample name matches:', matchesByName);
    }
  } finally {
    await pool.end();
  }
}

checkOverlap();
