import type { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { auth } from "@repo/auth";
import { storageService } from "@repo/services";

/**
 * TRANSITIONAL OBJECT ROUTES — `GET /api/storage/:id` and
 * `GET /api/public/storage/:id`.
 *
 * ADR-063 retires these: files live in buckets, and every read hands out a
 * ready-made link with the record that authorises it. Until each screen reads
 * those links, these routes keep today's URLs working by streaming the file
 * from the bucket (never redirecting: the mobile client sends its session
 * cookie as a plain header, which would follow a redirect to the bucket).
 * They go when the last screen stops building `/api/storage/...` URLs.
 *
 * Same rules as before: the private route needs a session with an active
 * role in the file's organisation; the public route serves public files
 * only. A foreign, missing or unready id is the same 404.
 */
export function mountStorageRoute(app: Express) {
  app.get("/api/storage/:id", async (req: Request, res: Response) => {
    const session = await auth.api.getSession({
      headers: req.headers as never,
    });

    if (!session) {
      res.status(401).json({ error: "Sign in required." });
      return;
    }

    const id = String(req.params.id);
    if (!id || !/^[0-9a-fA-F-]{36}$/.test(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    try {
      const object = await storageService.readForMember(session.user.id, id);
      if (!object || !object.contentType.startsWith("image/")) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      res
        .status(200)
        .set("Content-Type", object.contentType)
        .set("Content-Length", String(object.data.length))
        // Private: the bytes are tenant data. Immutable: a replacement is a
        // new id, so an id's bytes never change.
        .set("Cache-Control", "private, max-age=31536000, immutable")
        .send(object.data);
    } catch (error) {
      console.error("[storage] serving object failed:", error);
      res.status(500).json({ error: "Something went wrong." });
    }
  });
}

/**
 * Own limiter: this is the one endpoint an anonymous scraper can hammer, and
 * the general limiter must not be consumed by it.
 */
const publicStorageLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests." },
});

export function mountPublicStorageRoute(app: Express) {
  app.get("/api/public/storage/:id", publicStorageLimiter, async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!id || !/^[0-9a-fA-F-]{36}$/.test(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    try {
      const object = await storageService.readForPublic(id);
      if (!object || !object.contentType.startsWith("image/")) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      res
        .status(200)
        .set("Content-Type", object.contentType)
        .set("Content-Length", String(object.data.length))
        .set("Cache-Control", "public, max-age=31536000, immutable")
        .send(object.data);
    } catch (error) {
      console.error("[storage] serving public object failed:", error);
      res.status(500).json({ error: "Something went wrong." });
    }
  });
}
