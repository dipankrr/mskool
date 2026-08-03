import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import { getOrBuildAuthCache } from '../authz/cache';

const JWT_SECRET = process.env.JWT_SECRET ?? 'change-me-in-production';

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;

  if (!token) { res.status(401).json({ error: 'Unauthenticated' }); return; }

  let userId: string;
  try {
    ({ userId } = jwt.verify(token, JWT_SECRET) as { userId: string });
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' }); return;
  }

  try {
    const [userRow] = await db
      .select({ isPlatformAdmin: users.isPlatformAdmin })
      .from(users)
      .where(eq(users.id, userId));

    if (!userRow) { res.status(401).json({ error: 'User not found' }); return; }

    req.user = { userId, isPlatformAdmin: userRow.isPlatformAdmin };

    // Platform admins have no org-scoped cache — they bypass org authz entirely.
    if (!userRow.isPlatformAdmin) {
      req.authz = await getOrBuildAuthCache(userId);
    }
  } catch (err) {
    next(err); return;
  }

  next();
}
