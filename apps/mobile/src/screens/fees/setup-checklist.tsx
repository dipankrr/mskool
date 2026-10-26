import { router } from "expo-router";

import { Card } from "../../components/card";
import { LinkRow } from "../../components/link-row";
import { useActiveContext } from "../../hooks/use-active-context";
import { usePermissions } from "../../hooks/use-permissions";
import { copy } from "../../lib/copy";
import { trpc } from "../../lib/trpc";
import { SectionHead } from "./status";

/**
 * The year-setup checklist (stage 1 → 2 of the fee flow): fee types → fee
 * charts → late-fee rule → bill students. It shows on the Fees tab only while
 * something is unfinished and only to someone who can fix it, and every step
 * opens the screen that does it. A finished year shows nothing.
 */
export function FeeSetupChecklist({
  studentCount,
  billedCount,
}: {
  /** From the matrix's "all" cohort: everyone enrolled this session. */
  studentCount: number;
  billedCount: number;
}) {
  const { organizationId, academicYear, ready } = useActiveContext();
  const { has } = usePermissions();
  const canSetup = has("fee_structure:read") && has("fee_head:read");

  const enabled =
    ready && canSetup && Boolean(organizationId) && Boolean(academicYear?.id);

  const heads = trpc.fees.head.list.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled, staleTime: 60_000 },
  );
  const structures = trpc.fees.structure.list.useQuery(
    {
      organizationId: organizationId ?? "",
      academicYearId: academicYear?.id ?? "",
      includeHistory: false,
    },
    { enabled, staleTime: 60_000 },
  );
  const rules = trpc.fees.structure.listLateFeeRules.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled, staleTime: 60_000 },
  );

  if (!enabled || !heads.data || !structures.data || !rules.data) return null;

  const hasHeads = heads.data.length > 0;
  const hasCharts = structures.data.length > 0;
  const hasRule = rules.data.length > 0;
  const unbilled = Math.max(0, studentCount - billedCount);
  const allBilled = studentCount > 0 && unbilled === 0;

  // The late-fee rule is optional: it never keeps the checklist on screen.
  if (hasHeads && hasCharts && allBilled) return null;

  const steps = [
    {
      key: "heads",
      done: hasHeads,
      title: copy.fees.checklist.heads,
      detail: hasHeads
        ? copy.fees.checklist.headsDone(heads.data.length)
        : copy.fees.checklist.headsTodo,
      route: "/fees/setup/heads" as const,
    },
    {
      key: "charts",
      done: hasCharts,
      title: copy.fees.checklist.charts,
      detail: hasCharts
        ? copy.fees.checklist.chartsDone(structures.data.length)
        : copy.fees.checklist.chartsTodo,
      route: "/fees/setup/structures" as const,
    },
    {
      key: "rule",
      done: hasRule,
      title: copy.fees.checklist.rule,
      detail: hasRule
        ? copy.fees.checklist.ruleDone
        : copy.fees.checklist.ruleTodo,
      route: "/fees/setup/structures" as const,
    },
    {
      key: "bill",
      done: allBilled,
      title: copy.fees.checklist.bill,
      detail: allBilled
        ? copy.fees.checklist.billDone
        : copy.fees.checklist.billTodo(unbilled),
      route: "/fees/setup/structures" as const,
    },
  ];

  return (
    <>
      <SectionHead
        title={copy.fees.checklist.title(academicYear?.name ?? "")}
        hint={copy.fees.checklist.hint}
      />
      <Card padless>
        {steps.map((step, index) => (
          <LinkRow
            key={step.key}
            first={index === 0}
            icon={step.done ? "checkCircle" : "warning"}
            title={step.title}
            detail={step.detail}
            onPress={() => router.push(step.route)}
            testID={`fees-checklist-${step.key}`}
          />
        ))}
      </Card>
    </>
  );
}
