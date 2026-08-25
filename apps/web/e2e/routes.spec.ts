import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * THE BROWSER HALF OF THE NET (A2).
 *
 * d8eca60 fixed three client-side defects — the useClass rewrite, the nav
 * permission filter, and the sections query's enabled gate — that no API-level
 * test could have caught: the server 403'd exactly the input it was given, and
 * the wrong input was assembled in the browser. Only walking the rendered paths
 * as every seeded role can see that class of bug. This spec does exactly that,
 * one walk per role.
 *
 * What is asserted on every route:
 *   1. `main` renders and is non-empty (the page actually mounted);
 *   2. no console error and no uncaught exception;
 *   3. none of the friendly error wordings from lib/copy.ts appears — for
 *      routes the role may read. For a route it may not (Branches, for the two
 *      teachers) the friendly FORBIDDEN wording MUST appear: the graceful
 *      degradation is itself part of the contract, so it is pinned too;
 *   4. the navigation shows Branches only for roles holding `school:read` —
 *      the exact defect the nav filter fix closed.
 */

const API_URL = process.env.E2E_API_URL ?? "http://localhost:4000";

/**
 * Verbatim from apps/web/src/lib/copy.ts. Deliberately copied, not imported:
 * an e2e suite must pin the user-visible contract, not track the source file
 * that happens to hold it today.
 */
const FRIENDLY_ERROR_TEXTS = [
  "You don't have permission to do this.",
  "This record is no longer available.",
  "Your session expired. Please sign in again.",
  "Some details need fixing.",
  "That conflicts with something already saved.",
  "Couldn't load this list",
  "Couldn't reach the server.",
  "Something went wrong on our side.",
  "Something went wrong. Please try again.",
];

const ROLES = [
  {
    name: "org_admin",
    storageState: "../../auth-orgadmin.json",
    seesBranches: true,
  },
  {
    name: "principal",
    storageState: "../../auth-principal.json",
    seesBranches: true,
  },
  {
    name: "class_teacher",
    storageState: "../../auth-classteacher.json",
    seesBranches: false,
  },
  {
    name: "subject_teacher",
    storageState: "../../auth-subjectteacher.json",
    seesBranches: false,
  },
] as const;

/** The one tRPC GET helper the fixture resolution needs. */
async function trpcQuery(
  request: APIRequestContext,
  path: string,
  input: unknown,
): Promise<any> {
  // A z.undefined() input (me.get) is omitted rather than sent as `{}`.
  const qs =
    input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await request.get(`${API_URL}/trpc/${path}${qs}`);
  expect(res.ok(), `${path} must succeed while resolving fixtures`).toBeTruthy();
  const body = await res.json();
  return body.result.data;
}

/**
 * Resolves the fixture through each role's OWN session, which is also a
 * per-role assertion in disguise: subject_teacher reaches Class 6 only because
 * listClasses widens her section grant to class level — the workaround the web
 * app's useClass depends on. If that ever breaks, this fails before any route
 * is walked.
 */
async function resolveFixture(request: APIRequestContext) {
  const me = await trpcQuery(request, "me.get", undefined);
  const organizationId = me.memberships[0]?.organization?.id;
  expect(organizationId, "me.get returns a membership").toBeTruthy();

  const classes = await trpcQuery(request, "academic.class.list", {
    organizationId,
  });
  expect(
    classes.length,
    `${me.user.email} can see at least one class`,
  ).toBeGreaterThan(0);

  return { organizationId, classId: classes[0].id as string };
}

for (const role of ROLES) {
  test.describe(`${role.name}`, () => {
    test.use({ storageState: role.storageState });

    test("walks every route without an authorization failure", async ({
      page,
    }) => {
      const { classId } = await resolveFixture(page.request);

      const routes: Array<{ path: string; mayRead: boolean }> = [
        { path: "/", mayRead: true },
        { path: "/branches", mayRead: role.seesBranches },
        { path: "/sessions", mayRead: true },
        { path: "/classes", mayRead: true },
        { path: `/classes/${classId}`, mayRead: true },
        { path: "/profile", mayRead: true },
      ];

      // Console noise that is NOT an application failure: Chromium logs every
      // non-2xx resource fetch here, including the dev server's occasional
      // static-asset misses. Uncaught exceptions and app-level console.error
      // still surface below.
      let consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => {
        consoleErrors.push(`uncaught exception: ${error}`);
      });

      for (const route of routes) {
        consoleErrors = [];

        await page.goto(route.path);
        await expect(
          page.locator("main"),
          `${role.name} on ${route.path}: main mounts`,
        ).toBeVisible();
        await expect(page.locator("main")).not.toBeEmpty();

        // Let React Query settle before judging what rendered.
        await page.waitForLoadState("networkidle");

        const mainText = await page.locator("main").innerText();

        if (route.mayRead) {
          for (const text of FRIENDLY_ERROR_TEXTS) {
            expect(
              mainText,
              `${role.name} on ${route.path} must render without error wording`,
            ).not.toContain(text);
          }
        } else {
          expect(
            mainText,
            `${role.name} on ${route.path} must degrade to the friendly forbidden wording`,
          ).toContain(FRIENDLY_ERROR_TEXTS[0]);
        }

        // The d8eca60 nav fix: destinations the caller cannot read are hidden,
        // not shown-and-broken. Bottom tabs are display:none at this viewport,
        // so :visible selects the sidebar links only.
        const branchesLink = page.locator('a[href="/branches"]:visible');
        if (role.seesBranches) {
          await expect(
            branchesLink.first(),
            `${role.name} on ${route.path}: Branches visible in nav`,
          ).toBeVisible();
        } else {
          await expect(
            branchesLink,
            `${role.name} on ${route.path}: Branches hidden from nav`,
          ).toHaveCount(0);
        }

        expect(
          consoleErrors,
          `${role.name} on ${route.path}: no console errors`,
        ).toEqual([]);
      }
    });
  });
}
