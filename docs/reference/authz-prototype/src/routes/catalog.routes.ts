import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { p } from '../policies';
import { RESOURCE_ACTIONS, RESOURCE_CATEGORIES } from '../types/permissions';
import { ROLE_TYPES, ROLE_LABELS, DEFAULT_SCOPE_LEVEL } from '../types/roles';
import { SCOPE_TYPES, resourcesForScope } from '../types/hierarchy';

// ============================================================================
// Catalog — the permissions editor UI calls this once on load.
// Returns everything it needs to render the permissions grid:
//   - All resources, grouped by category, with their valid actions
//   - All role types with their default scope levels
//   - Which resources are meaningful at each scope level (for UI filtering)
//
// No authz gate — just needs to be authenticated.
// The permissions editor is only reachable to users who have role_permission:read
// (which the frontend can check before rendering), but the catalog data itself
// is not sensitive.
// ============================================================================

const router = Router();
router.use(authenticate);

router.get('/permissions/catalog', async (_req, res) => {
  // Build resource list with actions, grouped by category
  const categories: Record<string, { resource: string; actions: string[] }[]> = {};

  for (const [category, resources] of Object.entries(RESOURCE_CATEGORIES)) {
    categories[category] = resources.map(resource => ({
      resource,
      actions: [...RESOURCE_ACTIONS[resource]],
    }));
  }

  // Role types with scope-filtered resource lists for the permissions editor
  const roleTypes = ROLE_TYPES.map(rt => ({
    roleType:          rt,
    label:             ROLE_LABELS[rt],
    defaultScopeLevel: DEFAULT_SCOPE_LEVEL[rt],
    // Only show resources that make sense at this role's scope level.
    // Prevents dead configuration in the editor UI.
    relevantResources: resourcesForScope(DEFAULT_SCOPE_LEVEL[rt]),
  }));

  res.json({
    categories,
    roleTypes,
    scopeTypes: SCOPE_TYPES,
  });
});

export default router;
