import { useState } from "react";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { CapsuleButton } from "../../components/capsule-button";
import { FormSheet } from "../../components/form-sheet";
import { Notice } from "../../components/notice";
import { toFriendlyError } from "../../lib/errors";
import {
  printDocument,
  shareDocument,
  type PrintableDocument,
} from "../../lib/fee-print";
import { feesCopy } from "../../lib/fees-copy";
import { spacing } from "../../theme/tokens";

const words = feesCopy.print;

/**
 * The one way to print or share a fee document: whatever choices the document needs
 * go in `children`, and `load` asks the API for the finished page. Printing writes
 * nothing, so this can be retried freely.
 */
export function PrintSheet({
  title,
  load,
  canSubmit = true,
  onClose,
  children,
  extraAction,
  testIDPrefix,
}: {
  title: string;
  load: () => Promise<PrintableDocument>;
  canSubmit?: boolean;
  onClose: () => void;
  children?: ReactNode;
  extraAction?: ReactNode;
  testIDPrefix: string;
}) {
  const [busy, setBusy] = useState<"print" | "share" | null>(null);
  const [error, setError] = useState<unknown>(null);

  const run = async (kind: "print" | "share") => {
    setError(null);
    setBusy(kind);
    try {
      const document = await load();
      if (kind === "print") await printDocument(document);
      else await shareDocument(document, title);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(null);
    }
  };

  return (
    <FormSheet
      title={title}
      onClose={onClose}
      testIDPrefix={testIDPrefix}
      footer={
        <View style={styles.footer}>
          <CapsuleButton
            title={words.share}
            icon="share"
            variant="secondary"
            size="compact"
            loading={busy === "share"}
            disabled={!canSubmit || busy !== null}
            onPress={() => void run("share")}
            style={styles.half}
            testID={`${testIDPrefix}-share`}
          />
          <CapsuleButton
            title={words.print}
            icon="print"
            size="compact"
            loading={busy === "print"}
            disabled={!canSubmit || busy !== null}
            onPress={() => void run("print")}
            style={styles.half}
            testID={`${testIDPrefix}-print`}
          />
        </View>
      }
    >
      {children}
      {extraAction}
      {error ? (
        <Notice
          tone="critical"
          message={toFriendlyError(error).message}
          testID={`${testIDPrefix}-error`}
        />
      ) : null}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  half: {
    flex: 1,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
  },
});
