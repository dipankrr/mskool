/**
 * A REFUSAL THE USER SHOULD READ.
 *
 * A plain `Error` thrown by a service reaches the client as a generic 500
 * ("Something went wrong on our side") unless its text happens to match a
 * regex in the transport layer's translation list. That list says itself that
 * the next domain should introduce a shared error type instead of appending
 * again - this is that type.
 *
 * Throw one when the request is understood and the answer is "no, because..."
 * and the sentence is written for the person who asked. The transport maps
 * `code` to the matching status and passes `message` through untouched, so
 * the message must never carry a developer-facing string. It is a plain
 * `Error` subclass with a stable `name`, so the transport can recognise it
 * without importing this package.
 *
 *   BAD_REQUEST  the input is wrong (a term from another year)
 *   CONFLICT     the state forbids it (no rule set yet, already published)
 *   NOT_FOUND    the thing is not there for this caller
 */
export type RefusalCode = "BAD_REQUEST" | "CONFLICT" | "NOT_FOUND";

export class ServiceRefusal extends Error {
  readonly code: RefusalCode;

  constructor(code: RefusalCode, message: string) {
    super(message);
    this.name = "ServiceRefusal";
    this.code = code;
  }
}

/** `throw refuse("CONFLICT", "...")` reads better than `throw new ServiceRefusal(...)`. */
export function refuse(code: RefusalCode, message: string): ServiceRefusal {
  return new ServiceRefusal(code, message);
}
