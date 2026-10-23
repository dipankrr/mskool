/**
 * Display grouping for the read-only permission list (Step 1).
 *
 * Permission strings are `resource:action` — `attendance:create`,
 * `academic_year:read_history`. The profile answers "what can this account
 * do?" and "why can't I see fees?", so it shows the same vocabulary an
 * administrator grants, one group per resource, sorted so the same account
 * always reads the same way.
 *
 * Unknown shapes are kept, not dropped. A permission this app does not
 * recognise is still evidence of a grant; silently hiding it would make the
 * list lie. The `.` separator is tolerated because older notes and seeded
 * grants in the repo write `fee.list`; the server vocabulary is `:`.
 */

export type PermissionAction = {
  /** Raw action token, e.g. `read_history`. */
  key: string;
  /** Display words, e.g. `read history`. */
  label: string;
};

export type PermissionGroup = {
  /** Raw resource token, e.g. `academic_year`. */
  resource: string;
  /** Display words, e.g. `Academic year`. */
  label: string;
  actions: PermissionAction[];
};

/** Tokens that read as initials, not words. */
const ACRONYMS = new Set(["id"]);

function byText(a: string, b: string): number {
  // Plain comparison, not localeCompare: Hermes' ICU data varies by platform
  // build, and a permission list must not reorder itself between devices.
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `read_history` -> `read history`, `id_card` -> `ID card`. */
function wordsOf(token: string): string {
  return token
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) =>
      ACRONYMS.has(part.toLowerCase()) ? part.toUpperCase() : part,
    )
    .join(" ");
}

function sentenceCase(value: string): string {
  return value.length === 0
    ? value
    : value.charAt(0).toUpperCase() + value.slice(1);
}

export function displayResource(resource: string): string {
  return sentenceCase(wordsOf(resource));
}

export function displayAction(action: string): string {
  return wordsOf(action);
}

function splitPermission(permission: string): {
  resource: string;
  action: string;
} {
  const colon = permission.indexOf(":");
  const dot = permission.indexOf(".");
  const index = colon >= 0 ? colon : dot;
  // A leading separator is malformed; keep the whole token rather than
  // inventing a resource name.
  if (index <= 0) return { resource: permission, action: "" };
  return {
    resource: permission.slice(0, index),
    action: permission.slice(index + 1),
  };
}

export function groupPermissions(
  permissions: readonly string[],
): PermissionGroup[] {
  const groups = new Map<string, Map<string, PermissionAction>>();

  for (const raw of permissions) {
    const permission = raw.trim();
    if (permission.length === 0) continue;

    const { resource, action } = splitPermission(permission);
    let actions = groups.get(resource);
    if (!actions) {
      actions = new Map();
      groups.set(resource, actions);
    }

    const key = action.trim();
    if (key.length > 0 && !actions.has(key)) {
      actions.set(key, { key, label: displayAction(key) });
    }
  }

  return [...groups.entries()]
    .sort(([a], [b]) => byText(a, b))
    .map(([resource, actions]) => ({
      resource,
      label: displayResource(resource),
      actions: [...actions.values()].sort((a, b) => byText(a.key, b.key)),
    }));
}
