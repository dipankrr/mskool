import type { Request, Response, NextFunction } from 'express';
import type { UserAuthCache } from '../authz/types';
import type { DataScope } from '../authz/types';

// ── Express augmentation ──────────────────────────────────────────────────────
declare global {
  namespace Express {
    interface Request {
      user?:       { userId: string; isPlatformAdmin: boolean };
      authz?:      UserAuthCache;
      dataScope?:  DataScope;
      dataScopes?: DataScope[];
    }
  }
}

// ── Errors ────────────────────────────────────────────────────────────────────
export class ForbiddenError extends Error {
  constructor(message = 'Forbidden') { super(message); this.name = 'ForbiddenError'; }
}
export class NotFoundError extends Error {
  constructor(message = 'Not found') { super(message); this.name = 'NotFoundError'; }
}
export class AuthVersionError extends Error {
  // Thrown internally when auth version mismatch is detected.
  // Handled by re-running the permission check with the fresh cache.
  constructor() { super('Auth version mismatch'); this.name = 'AuthVersionError'; }
}

// ── PolicyFn ──────────────────────────────────────────────────────────────────
// A policy function reads the request and either:
//   - throws ForbiddenError   → 403
//   - returns void            → allowed, no scope to attach
//   - returns DataScope       → allowed, attach to req.dataScope
//   - returns DataScope[]     → allowed (list), attach to req.dataScopes
export type PolicyFn = (req: Request) => Promise<DataScope | DataScope[] | void>;

// ── authorize ─────────────────────────────────────────────────────────────────
// The only authz call that appears in route definitions.
// All business logic lives in the policy function — routes stay clean.
export function authorize(policyFn: PolicyFn) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await policyFn(req);
      if (Array.isArray(result))  req.dataScopes = result;
      else if (result)            req.dataScope  = result;
      next();
    } catch (err) {
      if (err instanceof ForbiddenError) { res.status(403).json({ error: err.message }); return; }
      if (err instanceof NotFoundError)  { res.status(404).json({ error: err.message }); return; }
      next(err);
    }
  };
}

// ── requirePlatformAdmin ──────────────────────────────────────────────────────
// For platform-admin-only routes (org provisioning, global settings).
// Bypasses the org-scoped authz system entirely.
export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user?.isPlatformAdmin) { res.status(403).json({ error: 'Platform admin only' }); return; }
  next();
}
