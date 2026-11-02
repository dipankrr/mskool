-- No route ever checked these. Nothing that works today loses anything.
DELETE FROM "org_role_permissions" WHERE "permission" IN (
  'fee_payment:update', 'fee_payment:delete', 'fee_payment:export', 'fee_waiver:read'
);
