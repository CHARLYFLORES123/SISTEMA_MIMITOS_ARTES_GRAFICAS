import pg from 'pg';
const { Pool } = pg;

const connectionString = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString || connectionString.includes('localhost')) {
  console.error('❌ Por favor especifica la URL de conexión de Neon en la variable NEON_DATABASE_URL o DATABASE_URL');
  console.error('Ejemplo:');
  console.error('  $env:NEON_DATABASE_URL="postgresql://neondb_owner:...@ep-....neon.tech/neondb?sslmode=require"');
  console.error('  node lib/db/update-schema-neon.mjs');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  console.log('🔄 Conectando a Neon para actualizar el esquema de la base de datos...\n');
  const client = await pool.connect();
  try {
    console.log('1️⃣ Actualizando tipos de columna en sale_details y reservation_details...');
    await client.query(`
      ALTER TABLE "sale_details" ALTER COLUMN "quantity" TYPE numeric(12, 2);
      ALTER TABLE "reservation_details" ALTER COLUMN "quantity" TYPE numeric(12, 2);
    `);
    console.log('   ✅ Columnas quantity convertidas a numeric(12, 2) con éxito.');

    console.log('2️⃣ Actualizando columnas en reservations...');
    await client.query(`
      ALTER TABLE "reservations" ALTER COLUMN "deposit_method" TYPE varchar(255);
      ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "cash_register_session_id" integer REFERENCES "cash_register_sessions"("id") ON DELETE SET NULL;
    `);
    console.log('   ✅ Columna cash_register_session_id agregada y deposit_method ampliada.');

    console.log('3️⃣ Creando tabla reservation_payments si no existe...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS "reservation_payments" (
        "id" serial PRIMARY KEY NOT NULL,
        "reservation_id" integer NOT NULL REFERENCES "reservations"("id") ON DELETE CASCADE,
        "payment_method" varchar(100) NOT NULL,
        "amount" numeric(12, 2) NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "reservation_payments_reservation_id_idx" ON "reservation_payments" ("reservation_id");
    `);
    console.log('   ✅ Tabla reservation_payments lista.');

    console.log('4️⃣ Agregando columnas de devolución de adelanto en reservations...');
    await client.query(`
      ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "deposit_refunded" boolean DEFAULT false NOT NULL;
      ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "refund_method" varchar(255);
      ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "refunded_at" timestamp with time zone;
    `);
    console.log('   ✅ Columnas deposit_refunded, refund_method y refunded_at listas.');

    console.log('\n🎉 ¡Base de datos en Neon actualizada correctamente!');
  } catch (err) {
    console.error('❌ Error actualizando la base de datos en Neon:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
