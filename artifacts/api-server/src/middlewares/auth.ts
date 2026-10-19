import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { logger } from "../lib/logger";

const JWT_SECRET = process.env.JWT_SECRET ?? "pos-ventas-secret-change-in-prod";

export interface AuthRequest extends Request {
  userId?: number;
  userRole?: string;
  userName?: string;
}

export function verifyToken(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ message: "No autorizado" });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: number; role: string; name?: string };
    req.userId = payload.userId;
    req.userRole = payload.role;
    req.userName = payload.name;
    next();
  } catch (err) {
    logger.warn({ err }, "Invalid JWT token");
    res.status(401).json({ message: "Token inválido o expirado" });
  }
}

export function signToken(userId: number, role: string, name?: string): string {
  return jwt.sign({ userId, role, name }, JWT_SECRET, { expiresIn: "7d" });
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  const role = req.userRole?.toLowerCase();
  if (role !== "admin" && role !== "administrador") {
    res.status(403).json({ message: "Acceso denegado: se requiere rol Admin" });
    return;
  }
  next();
}

export function requireRoles(allowed: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const role = req.userRole?.toLowerCase() ?? "";
    if (!allowed.map(r => r.toLowerCase()).includes(role)) {
      res.status(403).json({ message: `Acceso denegado: se requiere uno de los roles [${allowed.join(", ")}]` });
      return;
    }
    next();
  };
}
