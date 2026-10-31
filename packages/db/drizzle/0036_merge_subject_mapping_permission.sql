-- ADR-054: `subject_mapping:*` merges into `subject:*`. Saved matrices are per
-- org (ADR-036), so each grant is converted, not dropped: a role an org gave
-- only `subject_mapping:create` keeps that ability as `subject:create`.
INSERT INTO "org_role_permissions" ("organization_id", "role_type", "permission")
SELECT "organization_id", "role_type", replace("permission", 'subject_mapping:', 'subject:')
FROM "org_role_permissions"
WHERE "permission" LIKE 'subject_mapping:%'
ON CONFLICT ("organization_id", "role_type", "permission") DO NOTHING;--> statement-breakpoint
DELETE FROM "org_role_permissions" WHERE "permission" LIKE 'subject_mapping:%';
