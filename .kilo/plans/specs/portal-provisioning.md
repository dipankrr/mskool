# Screen Spec — Portal Provisioning: staff credential admin + the family login door

Per `.agents/skills/frontend-product-ux-skill/` — workflow-first; spec
precedes code for the ADR-007 completion slice. High-trust domain: every
action here is credential-shaped (a quiet account-takeover path if the UX
is sloppy), so consequences are stated and reasons are required.

## Users / roles

- **Principal / VP** (primary): activates a family login, re-issues a
  forgotten password, changes the phone on record. Holds
  `portal_access:activate | reset_password | change_phone`.
- **Family login** (consumer, not this screen): signs in by phone at the
  login form's Family tab; the must-change gate forces the first real
  password.

## Top workflows

```text
Staff: student register → row action "Portal login" → Activate dialog
       (phone + initial password, consequence stated) → the family can sign in
Staff: same dialog → Reset password (sessions die, the family must change again)
Staff: same dialog → Change phone (required reason, audit + session revocation)
Family: /login → Family tab → pick school → phone + password
        → must-change screen (forced) → /portal/results
```

## Important states

- No login yet → "Activate" (primary action).
- Active login → phone shown masked-ish (username is the phone; it is the
  family's own data, not a secret), with Reset / Change phone as secondary.
- must_change_password set → the portal layout forces /change-password
  until cleared (better-auth's change-password clears it via the account
  hook; the act proves possession of the current password).
- A student under MULTIPLE family logins → reset/change name the login
  (the API refuses to guess; the dialog surfaces the list).

## Screens & surfaces

1. `/students` row actions → "Portal login" opens `PortalAccessDialog`
   (activate / reset / change-phone in one component; states decide which
   affordances render).
2. `/login` — two tabs (Staff email / Family phone+school picker backed by
   the public org resolver; remembered school in localStorage).
3. `/change-password` — the forced first-login gate (current + new +
   confirm; better-auth /change-password).
4. `(portal)` route group: `PortalShell` (family chrome, me.portal
   children), `/portal/results` (moved from (dashboard)), attendance and
   fees as honest "coming next" stubs.
5. `me.get` extended: `mustChangePassword` + `portal.studentIds` — the
   client's routing signal (family → portal; no-access family in the staff
   shell → redirected home).

## New backend (with the screen — plan rule)

- `health.orgBySlug` / `health.orgsByNamePrefix` — the login page's
  public org resolvers (name+slug only; both public by nature). The
  second ungated route; ADR-worthy note recorded in the router comment.
- `databaseHooks.account.update.after` — clears must_change_password on
  every better-auth password change (its endpoint updates the ACCOUNT
  row, not the user row — the hook rides that).

## Validation & security rules

Phone: 10 digits (contract). Password: better-auth's floor, mirrored in
the contract (min 8). Change-phone reason: required, min 3, recorded in
the audit row. No staff screen ever displays a password — one-time entry
only. Reset/change kill sessions: the dialog SAYS so before commit.

## Accessibility

Tabs are buttons with aria-pressed; dialogs labelled; the login form's
phone input is `type=tel inputMode=numeric`; errors are text, not color.

## Responsive

Login card single column; portal shell collapses nav to a top menu button
(md breakpoint), content full width; dialogs are FormDialog (bottom sheet
on phone).

## Explicitly out (recorded, not silently dropped)

- Portal attendance + fees views (links exist as honest stubs; slices
  land next per TASKS.md).
- Subdomain-based org resolution on the login page (the picker carries
  dev/preview; production can add subdomain detection later without
  changing the credential shape).
- Staff-side listing of ALL portal logins (per-student row action only;
  an org-wide credentials view is its own slice with its own permissions
  review).
