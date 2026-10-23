import type { Request, RequestHandler } from "express";
import { Types } from "mongoose";
import { Cafe } from "../models/Cafe.js";
import { User, type UserRole } from "../models/User.js";

export interface AuthContext {
  user: { id: string; name: string; email: string; role: UserRole };
  cafe: { id: string; name: string; slug: string };
}

declare global {
  namespace Express {
    interface Request { auth?: AuthContext }
  }
}

export const requireAuth: RequestHandler = async (request, response, next) => {
  const userId = request.session?.userId;
  if (!userId || !Types.ObjectId.isValid(userId)) {
    response.status(401).json({ message: "Требуется вход в аккаунт." });
    return;
  }
  try {
    const user = await User.findById(userId).select("_id name email cafeId role isActive").lean();
    if (!user || !user.isActive || (user.role !== "owner" && user.role !== "staff")) {
      response.status(401).json({ message: "Требуется вход в аккаунт." });
      return;
    }
    const cafe = await Cafe.findById(user.cafeId).select("_id name slug isActive").lean();
    if (!cafe || !cafe.isActive) {
      response.status(401).json({ message: "Требуется вход в аккаунт." });
      return;
    }
    request.auth = {
      user: { id: user._id.toString(), name: user.name, email: user.email, role: user.role },
      cafe: { id: cafe._id.toString(), name: cafe.name, slug: cafe.slug },
    };
    next();
  } catch {
    response.status(503).json({ message: "Проверка доступа временно недоступна." });
  }
};

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (request, response, next) => {
    if (!request.auth) { response.status(401).json({ message: "Требуется вход в аккаунт." }); return; }
    if (!roles.includes(request.auth.user.role)) { response.status(403).json({ message: "Недостаточно прав." }); return; }
    next();
  };
}

export function requireCafeAccess(cafeIdFromRequest: (request: Request) => string | undefined =
  (request) => typeof request.params.cafeId === "string" ? request.params.cafeId : undefined): RequestHandler {
  return (request, response, next) => {
    if (!request.auth) { response.status(401).json({ message: "Требуется вход в аккаунт." }); return; }
    const requestedCafeId = cafeIdFromRequest(request);
    if (!requestedCafeId || !Types.ObjectId.isValid(requestedCafeId) || requestedCafeId !== request.auth.cafe.id) {
      response.status(403).json({ message: "Доступ к этому кафе запрещён." });
      return;
    }
    next();
  };
}
