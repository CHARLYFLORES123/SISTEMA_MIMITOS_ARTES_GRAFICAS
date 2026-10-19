import "./lib/env";
import app from "./app";
import { logger } from "./lib/logger";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const rawPort = process.env["PORT"] || "5000";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function seedDemoUsers() {
  const demos = [
    { name: "Administrador Demo", email: "admin@demo.com", password: "admin123", role: "admin" },
    { name: "Vendedor Demo", email: "vendedor@demo.com", password: "vendedor123", role: "vendedor" },
    { name: "Inventario Demo", email: "inventario@demo.com", password: "inventario123", role: "inventario" },
    { name: "Compras Demo", email: "compras@demo.com", password: "compras123", role: "compras" },
    { name: "Diseñador Demo", email: "disenador@demo.com", password: "disenador123", role: "diseñador" },
  ];

  for (const demo of demos) {
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, demo.email)).limit(1);
    if (!existing) {
      const passwordHash = await bcrypt.hash(demo.password, 10);
      await db.insert(usersTable).values({ name: demo.name, email: demo.email, passwordHash, role: demo.role });
      logger.info({ email: demo.email, role: demo.role }, "Demo user seeded");
    }
  }
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  try {
    await seedDemoUsers();
  } catch (e) {
    logger.error({ err: e }, "Failed to seed demo users");
  }
});
