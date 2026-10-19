import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(path.resolve(process.cwd(), ".env"));
  } catch {
    try {
      process.loadEnvFile(path.resolve(process.cwd(), "../../.env"));
    } catch {
      // Ignored if neither exists
    }
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
