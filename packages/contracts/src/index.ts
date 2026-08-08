/**
 * @repo/contracts — the shared vocabulary.
 *
 * Zod schemas derived from the Drizzle tables via drizzle-zod, so validation
 * and the database cannot drift: rename a column and this package stops
 * compiling, which is the point of the type chain (AGENTS.md).
 */

// Auth: registration and profile input shapes used by the web app's forms.
export * from "./contracts/auth.contract";

// The tenant: organizations (the Trust) and the schools beneath them.
export * from "./contracts/organization.contract";


