/**
 * @repo/services — business logic. Classes plus an exported singleton each.
 *
 * No HTTP awareness here: no request, no response, no tRPC types. Services
 * take a DataScope as a required argument and filter every query by it
 * (hard rule 1), which is what makes a missing tenancy filter a compile error.
 */

export * from "./organization.service";

// The signed-in caller's own access. Takes an already-loaded auth cache rather
// than a DataScope: here the scope is the answer, not an argument.
export * from "./identity.service";


