import { createEnv } from "@repo/env";
import { z } from "zod";

// The ONLY file in this package allowed to touch process.env directly.
export const env = createEnv({
  /**
   * ADR-038: which storage driver holds object bytes. `postgres` (default)
   * keeps them in `storage_objects.data`; `r2` is DECLARED, NOT BUILT — the
   * storage service refuses it with a named error until that driver lands.
   * The seam exists so the future swap is an env flip plus a byte copy,
   * never a URL migration.
   */
  STORAGE_DRIVER: z.enum(["postgres", "r2"]).default("postgres"),
});
