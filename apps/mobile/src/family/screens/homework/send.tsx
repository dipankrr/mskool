import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";

import { AppIcon } from "../../../components/app-icon";
import { trpc } from "../../../lib/trpc";
import { useFamilyChild } from "../../child-context";
import { useFormat } from "../../i18n/format";
import { nextOpen } from "../../lib/homework";
import type { PortalDetail } from "../../lib/homework";
import { Enter } from "../../motion";
import { useFamilyTheme } from "../../theme";
import { FButton, FHand, FHeader, FMascot, FScreen, FStamp, FText } from "../../ui";
import { isoParts } from "./detail";
import { MAX_PAGES, useSendPhotos } from "./use-send-photos";

/**
 * Send (or swap) the child's pages: pick from the camera or gallery, see them
 * in order, send. Each page uploads as soon as it's picked; a failed one is
 * tapped to try again. After sending, a stamp and a straight path to the next
 * homework.
 */
export function FamilyHomeworkSend() {
  const { t } = useTranslation("homework");
  const theme = useFamilyTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { child } = useFamilyChild();
  const studentId = child?.studentId ?? "";
  const input = { studentId, studentAssignmentId: id ?? "" };
  const utils = trpc.useUtils();
  const photos = useSendPhotos(input);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<PortalDetail | null>(null);
  // Swapping keeps what was typed last time.
  const [typed, setTyped] = useState(() => utils.portalHomework.get.getData(input)?.submission?.bodyText ?? "");
  const send = trpc.portalHomework.send.useMutation({
    onSuccess: (next) => {
      utils.portalHomework.get.setData(input, next);
      void utils.portalHomework.list.invalidate();
      setSent(next);
    },
  });

  if (sent) return <Sent detail={sent} studentId={studentId} />;

  const add = async (source: "camera" | "library") => {
    setProblem(null);
    const key = await photos.add(source);
    if (key) setProblem(t(key));
  };
  const close = () => (router.canGoBack() ? router.back() : router.replace("/family/homework"));
  const ready = photos.objectIds.length;
  const text = typed.trim();
  const field = theme.components.field;

  return (
    <FScreen
      testID="family-homework-send"
      header={<FHeader title={t("send.title")} onBack={close} backLabel={t("send.close")} />}
    >
      <FText variant="meta" color="muted">
        {t("send.hint")}
      </FText>

      <View style={[styles.grid, { gap: theme.space.sm }]}>
        {photos.pages.map((page, i) => (
          <Enter key={page.key} style={{ width: `${(100 - 6) / 3}%` }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={page.status === "failed" ? t("send.retry", { n: i + 1 }) : undefined}
              disabled={page.status !== "failed"}
              onPress={() => photos.retry(page.key)}
              style={{ aspectRatio: 0.78, borderRadius: theme.components.homework.photo.radius, overflow: "hidden", backgroundColor: theme.color.surfaceSunk }}
            >
              <Image source={{ uri: page.uri }} style={[styles.fill, page.status === "ready" ? null : styles.dim]} contentFit="cover" />
              <View style={[styles.badge, { backgroundColor: theme.color.ink, borderRadius: theme.radius.full }]}>
                <FText variant="caption" color="onAccent">
                  {String(i + 1)}
                </FText>
              </View>
              {page.status === "failed" ? (
                <View style={[styles.cover, { backgroundColor: theme.tone.critical.bg }]}>
                  <AppIcon name="refresh" size={26} color={theme.tone.critical.fg} />
                </View>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("send.remove", { n: i + 1 })}
                hitSlop={8}
                onPress={() => photos.remove(page.key)}
                style={[styles.remove, { backgroundColor: theme.color.scrim, borderRadius: theme.radius.full }]}
              >
                <AppIcon name="close" size={14} color={theme.color.onAccent} />
              </Pressable>
            </Pressable>
          </Enter>
        ))}
        {photos.pages.length < MAX_PAGES ? (
          <Pressable
            testID="hw-add-page"
            accessibilityRole="button"
            onPress={() => void add("library")}
            style={[
              styles.center,
              {
                width: `${(100 - 6) / 3}%`,
                aspectRatio: 0.78,
                borderRadius: theme.components.homework.photo.radius,
                borderWidth: 2,
                borderStyle: "dashed",
                borderColor: theme.components.homework.howTo.border,
                gap: theme.space.xs,
              },
            ]}
          >
            <AppIcon name="add" size={26} color={theme.color.muted} />
            <FText variant="meta" color="muted">
              {t("send.addPage")}
            </FText>
          </Pressable>
        ) : null}
      </View>

      <View style={[styles.row, { gap: theme.space.sm }]}>
        <FButton testID="hw-camera" label={t("send.camera")} icon="camera" variant="secondary" onPress={() => void add("camera")} style={styles.flex} />
        <FButton testID="hw-gallery" label={t("send.gallery")} icon="viewCards" variant="secondary" onPress={() => void add("library")} style={styles.flex} />
      </View>

      <View style={{ gap: theme.space.sm }}>
        <FText variant="label">{t("send.typeLabel")}</FText>
        <TextInput
          testID="hw-typed"
          value={typed}
          onChangeText={setTyped}
          placeholder={t("send.typeHint")}
          placeholderTextColor={field.placeholder}
          accessibilityLabel={t("send.typeLabel")}
          multiline
          maxLength={10000}
          style={[
            theme.text("body"),
            {
              minHeight: 110,
              textAlignVertical: "top",
              backgroundColor: field.bg,
              color: field.text,
              borderRadius: field.radius,
              paddingHorizontal: field.paddingX,
              paddingVertical: theme.space.md,
            },
          ]}
        />
      </View>

      <View style={[styles.row, { gap: theme.space.md, backgroundColor: theme.tone.info.bg, borderRadius: theme.radius.lg, padding: theme.space.lg }]}>
        <AppIcon name="info" size={20} color={theme.tone.info.fg} />
        <FText variant="meta" style={styles.flex}>
          {t("send.tip")}
        </FText>
      </View>

      {problem || photos.failed >= 0 || send.isError ? (
        <FText variant="meta" color="critical">
          {problem ?? (send.isError ? t("send.failed") : t("send.failedPage", { n: photos.failed + 1 }))}
        </FText>
      ) : null}

      <View style={{ gap: theme.space.sm }}>
        <FButton
          testID="hw-send-pages"
          label={photos.busy ? t("send.uploading") : ready > 0 ? t("send.button", { count: ready }) : t("send.answerOnly")}
          icon="check"
          block
          loading={send.isPending}
          disabled={(ready === 0 && !text) || photos.busy || photos.failed >= 0 || send.isPending}
          onPress={() => send.mutate({ ...input, fileObjectIds: photos.objectIds, ...(text ? { bodyText: text } : {}) })}
        />
        <FText variant="meta" color="muted" align="center">
          {t("send.limit", { max: MAX_PAGES })}
        </FText>
      </View>
    </FScreen>
  );
}

/** The reward moment: a stamp, a word from Bookie, and the next homework. */
function Sent({ detail, studentId }: { detail: PortalDetail; studentId: string }) {
  const { t } = useTranslation("homework");
  const theme = useFamilyTheme();
  const format = useFormat();
  const list = trpc.portalHomework.list.useQuery({ studentId, filter: "all" }, { enabled: studentId.length > 0 });
  const next = list.data ? nextOpen(list.data, detail.studentAssignmentId) : null;
  const sub = detail.submission;
  const time = sub ? format.time(isoParts(sub.submittedAt).clock) : "";
  const toList = () => router.dismissTo("/family/homework");

  return (
    <FScreen testID="family-homework-sent" contentStyle={styles.sent}>
      <View style={[styles.center, { gap: theme.space.xl, paddingTop: theme.space.huge }]}>
        <Enter>
          <FStamp
            tone="blue"
            kicker={t("sent.kicker", { subject: detail.subjectName })}
            value={t("sent.stamp")}
            sub={sub && sub.files.length > 0 ? t("sent.pages", { count: sub.files.length, time }) : t("sent.answer", { time })}
            footLeft={sub?.isLate ? t("sent.late") : t("sent.early")}
            width={230}
          />
        </Enter>
        <View style={[styles.row, { gap: theme.space.md }]}>
          <FMascot size={64} mood="happy" />
          <FHand size={28}>{t("bookie.sent")}</FHand>
        </View>
        <FText variant="body" color="muted" align="center">
          {t(sub && sub.files.length > 0 ? "sent.body" : "sent.bodyTyped", { name: detail.teacherName })}
        </FText>
      </View>
      <View style={{ gap: theme.space.sm }}>
        {next ? (
          <FButton
            testID="hw-next"
            label={t("sent.next", { title: next.title })}
            block
            onPress={() => router.replace({ pathname: "/family/homework/[id]", params: { id: next.studentAssignmentId } })}
          />
        ) : null}
        <FButton testID="hw-to-list" label={t("sent.toList")} variant={next ? "quiet" : "primary"} block onPress={toList} />
      </View>
    </FScreen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap" },
  row: { flexDirection: "row", alignItems: "center" },
  flex: { flex: 1 },
  fill: { flex: 1 },
  dim: { opacity: 0.5 },
  center: { alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", left: 6, top: 6, minWidth: 22, height: 22, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  remove: { position: "absolute", right: 6, top: 6, width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  cover: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", opacity: 0.85 },
  sent: { flexGrow: 1, justifyContent: "space-between" },
});
