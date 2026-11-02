-- `fee_refund:approve` was never checked by any route. Refunds now go by
-- `fee_refund:create` alone, so whoever could approve keeps a working permission.
INSERT INTO "org_role_permissions" ("organization_id", "role_type", "permission")
SELECT "organization_id", "role_type", 'fee_refund:create'
FROM "org_role_permissions"
WHERE "permission" = 'fee_refund:approve'
ON CONFLICT ("organization_id", "role_type", "permission") DO NOTHING;--> statement-breakpoint
DELETE FROM "org_role_permissions" WHERE "permission" = 'fee_refund:approve';
