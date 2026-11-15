import { View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { todayIso } from "../../../lib/format";
import { trpc } from "../../../lib/trpc";
import { useFamilyChild } from "../../child-context";
import { useFamilyTheme } from "../../theme";
import { FEmptyState, FErrorState, FOfflineNote, FScreen, FSkeleton, useFamilyTabBarSpace } from "../../ui";
import { FamilyTabHeader } from "../tab-header";
import { useFeeDocument } from "./use-fee-document";
import { FeesView } from "./view";

/**
 * Family Fees: the same figures as the admin student fee page, read-only and
 * in the family look (owner F1 to F4). This file fetches and handles the
 * loading, error and "not set" states; `view.tsx` draws the screen.
 */
export function FamilyFees() {
  const { t } = useTranslation("fees");
  const { t: tf } = useTranslation("family");
  const theme = useFamilyTheme();
  const space = useFamilyTabBarSpace();
  const { child } = useFamilyChild();
  const studentId = child?.studentId ?? "";

  const summary = trpc.portalFees.summary.useQuery({ studentId }, { enabled: studentId.length > 0 });
  const statement = useFeeDocument();
  const data = summary.data;
  const header = <FamilyTabHeader title={tf("tabs.fees")} />;

  if (summary.isError && !data) {
    return (
      <FScreen bottomSpace={space} header={header}>
        <FErrorState onRetry={() => void summary.refetch()} />
      </FScreen>
    );
  }

  if (data && !data.feeAssigned) {
    return (
      <FScreen bottomSpace={space} header={header} onRefresh={() => void summary.refetch()} refreshing={summary.isRefetching}>
        <FEmptyState title={t("notSet.title")} body={t("notSet.body")} />
      </FScreen>
    );
  }

  return (
    <FScreen
      testID="family-fees"
      bottomSpace={space}
      header={header}
      refreshing={summary.isRefetching}
      onRefresh={() => void summary.refetch()}
    >
      {summary.isError && data ? <FOfflineNote /> : null}
      {data ? (
        <FeesView
          key={studentId}
          data={data}
          today={todayIso()}
          onPayment={(id) => router.push({ pathname: "/family/payment/[id]", params: { id } })}
          statement={{
            busy: statement.busy,
            error: !!statement.error,
            share: () => void statement.share({ kind: "statement", studentId }, t("statement")),
          }}
        />
      ) : (
        <View style={{ gap: theme.space.lg }}>
          <FSkeleton height={132} radius="xl" />
          <FSkeleton height={72} radius="lg" />
          <FSkeleton height={72} radius="lg" />
        </View>
      )}
    </FScreen>
  );
}
