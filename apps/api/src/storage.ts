import type { Express, Request, Response } from "express";
import { auth } from "@repo/auth";
import { storageService } from "@repo/services";

/**
 * THE OBJECT ROUTE (ADR-038) — `GET /api/storage/:id`.
 *
 * Object URLs are stable app routes, never driver URLs: the bytes may move to
 * R2 one day, this route stays. Every reference in the system (photo
 * pointers, template backgrounds, logo assets) stores an object ID, so the
 * browser builds `/api/storage/<id>` and this handler does the rest.
 *
 * Session-authenticated (better-auth cookie), and tenancy-checked INSIDE the
 * service: `getForUser` resolves the object's owning organization and demands
 * an active role assignment (not revoked, not expired) for the caller there —
 * a foreign-org id is the same 404 as a made-up one. See ADR-038 for why the
 * response is immutable-cacheable: replacement writes a NEW object id, so an
 * id's bytes never change.
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
      const object = await storageService.getForUser(session.user.id, id);

      if (!object) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      // Only images are ever stored (the upload contract's allowlist); the
      // serving route re-asserts it so a stray row can never become a
      // non-image response.
      if (!object.contentType.startsWith("image/")) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      res
        .status(200)
        .set("Content-Type", object.contentType)
        .set("Content-Length", String(object.data.length))
        // Private: the bytes are tenant data. Immutable: ids are never
        // re-pointed — replacement mints a new id.
        .set("Cache-Control", "private, max-age=31536000, immutable")
        .send(object.data);
    } catch (error) {
      // The declared-but-unbuilt R2 driver lands here as a named error —
      // honest 500, message in the server log, nothing leaked.
      console.error("[storage] serving object failed:", error);
      res.status(500).json({ error: "Something went wrong." });
    }
  });
}
