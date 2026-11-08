import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import * as ImagePicker from "expo-image-picker";

import { CapsuleButton } from "../../components/capsule-button";
import { ChoicePills } from "../../components/choice-pills";
import { FormField } from "../../components/form-field";
import { FormSheet } from "../../components/form-sheet";
import { Notice } from "../../components/notice";
import { SelectField } from "../../components/select-field";
import { SwitchRow } from "../../components/switch-row";
import { ThemedText } from "../../components/themed-text";
import { toFriendlyError } from "../../lib/errors";
import { feesCopy } from "../../lib/fees-copy";
import { trpc } from "../../lib/trpc";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import { prepareImage, putToUploadLink } from "../../lib/image-upload";

const words = feesCopy.printing;
const paperWords = feesCopy.print.paper;

type Paper = keyof typeof paperWords;
type UpiMode = "off" | "upi_id" | "image";
const PAPERS = Object.keys(paperWords) as Paper[];
const KINDS = Object.keys(words.titleDefaults) as (keyof typeof words.titleDefaults)[];

async function pickImage() {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 1,
    exif: false,
  });
  return result.canceled ? null : (result.assets[0] ?? null);
}

/**
 * How this school's fee papers print. The school's name and address come from its
 * record and always print; this adds its own lines, titles and the UPI QR.
 */
export function PrintingSheet({
  organizationId,
  schoolId,
  onClose,
  onDone,
}: {
  organizationId: string;
  schoolId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const utils = trpc.useUtils();
  const current = trpc.fees.printing.get.useQuery({ organizationId, schoolId });
  const save = trpc.fees.printing.update.useMutation();
  const uploadLink = trpc.fees.printing.imageUpload.useMutation();
  const [uploading, setUploading] = useState(false);

  const [draft, setDraft] = useState<{
    headerText: string;
    subText: string;
    footerText: string;
    signatureLabel: string;
    titles: Record<string, string>;
    showAmountInWords: boolean;
    receiptLayout: Paper;
    upiMode: UpiMode;
    upiId: string;
    upiPayeeName: string;
    logoObjectId: string | null;
    upiImageObjectId: string | null;
  } | null>(null);
  const [titlesOpen, setTitlesOpen] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const loaded = current.data;
  const value =
    draft ??
    (loaded
      ? {
          headerText: loaded.headerText,
          subText: loaded.subText,
          footerText: loaded.footerText,
          signatureLabel: loaded.signatureLabel,
          titles: loaded.titles,
          showAmountInWords: loaded.showAmountInWords,
          receiptLayout: loaded.receiptLayout,
          upiMode: loaded.upiMode,
          upiId: loaded.upiId ?? "",
          upiPayeeName: loaded.upiPayeeName ?? "",
          logoObjectId: loaded.logoObjectId,
          upiImageObjectId: loaded.upiImageObjectId,
        }
      : null);

  const patch = (next: Partial<NonNullable<typeof value>>) => {
    if (value) setDraft({ ...value, ...next });
  };

  const uploadImage = async (target: "logoObjectId" | "upiImageObjectId") => {
    setError(null);
    try {
      const asset = await pickImage();
      if (!asset) return;
      setUploading(true);
      // A QR is sent as lossless PNG so no scanner ever sees a blurred code.
      const isQr = target === "upiImageObjectId";
      const image = await prepareImage(asset.uri, asset.width, asset.height, 1200, isQr ? "png" : "jpeg");
      const ticket = await uploadLink.mutateAsync({
        organizationId,
        schoolId,
        data: {
          kind: isQr ? "upi_qr" : "logo",
          file: { contentType: image.contentType, sizeBytes: image.sizeBytes },
        },
      });
      await putToUploadLink(ticket, image);
      // Saving the settings checks the file and links it (ADR-063).
      patch({ [target]: ticket.objectId });
    } catch (cause) {
      setError(cause);
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!value) return;
    setError(null);
    try {
      await save.mutateAsync({
        organizationId,
        schoolId,
        data: {
          headerText: value.headerText.trim(),
          subText: value.subText.trim(),
          footerText: value.footerText.trim(),
          signatureLabel: value.signatureLabel.trim(),
          titles: Object.fromEntries(
            Object.entries(value.titles).filter(([, title]) => title.trim().length > 0),
          ),
          showAmountInWords: value.showAmountInWords,
          receiptLayout: value.receiptLayout,
          upiMode: value.upiMode,
          upiId: value.upiId.trim() || null,
          upiPayeeName: value.upiPayeeName.trim() || null,
          logoObjectId: value.logoObjectId,
          upiImageObjectId: value.upiImageObjectId,
        },
      });
      await utils.fees.printing.get.invalidate();
      onDone();
    } catch (cause) {
      setError(cause);
    }
  };

  return (
    <FormSheet
      title={words.title}
      onClose={onClose}
      testIDPrefix="fee-printing-sheet"
      footer={
        <View style={styles.footer}>
          <CapsuleButton
            title={words.save}
            icon="check"
            size="compact"
            loading={save.isPending}
            disabled={!value || uploading}
            onPress={() => void submit()}
            testID="fee-printing-save"
          />
        </View>
      }
    >
      {!value ? (
        current.error ? (
          <Notice tone="critical" message={toFriendlyError(current.error).message} />
        ) : (
          <ThemedText variant="meta">{words.loading}</ThemedText>
        )
      ) : (
        <>
          <ThemedText variant="meta">{words.intro}</ThemedText>

          <View style={styles.row}>
            <View style={styles.rowText}>
              <ThemedText variant="bodyStrong">{words.logo}</ThemedText>
              <ThemedText variant="meta">
                {value.logoObjectId ? words.logoSet : words.logoNone}
              </ThemedText>
            </View>
            {value.logoObjectId ? (
              <CapsuleButton
                title={words.remove}
                variant="secondary"
                size="mini"
                onPress={() => patch({ logoObjectId: null })}
                testID="fee-printing-logo-remove"
              />
            ) : null}
            <CapsuleButton
              title={value.logoObjectId ? words.replace : words.upload}
              variant="secondary"
              size="mini"
              loading={uploading}
              onPress={() => void uploadImage("logoObjectId")}
              testID="fee-printing-logo"
            />
          </View>

          <FormField
            label={words.headerLabel}
            value={value.headerText}
            onChangeText={(text) => patch({ headerText: text })}
            multiline
            numberOfLines={3}
            maxLength={300}
            help={words.headerHelp}
            testID="fee-printing-header"
          />
          <FormField
            label={words.subLabel}
            value={value.subText}
            onChangeText={(text) => patch({ subText: text })}
            multiline
            numberOfLines={3}
            maxLength={300}
            help={words.subHelp}
            testID="fee-printing-sub"
          />
          <FormField
            label={words.footerLabel}
            value={value.footerText}
            onChangeText={(text) => patch({ footerText: text })}
            multiline
            numberOfLines={3}
            maxLength={300}
            help={words.footerHelp}
            testID="fee-printing-footer"
          />
          <FormField
            label={words.signatureLabel}
            value={value.signatureLabel}
            onChangeText={(text) => patch({ signatureLabel: text })}
            placeholder={words.signatureDefault}
            maxLength={60}
            testID="fee-printing-signature"
          />
          <SwitchRow
            label={words.wordsLabel}
            value={value.showAmountInWords}
            onChange={(next) => patch({ showAmountInWords: next })}
            help={words.wordsHelp}
            testID="fee-printing-words"
          />
          <SelectField
            label={words.paperLabel}
            valueLabel={paperWords[value.receiptLayout]}
            placeholder={words.paperLabel}
            options={PAPERS.map((id) => ({ id, label: paperWords[id] }))}
            currentId={value.receiptLayout}
            onSelect={(id) => patch({ receiptLayout: id as Paper })}
            testID="fee-printing-paper"
          />

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: titlesOpen }}
            onPress={() => setTitlesOpen((open) => !open)}
            style={styles.toggle}
            testID="fee-printing-titles-toggle"
          >
            <ThemedText variant="bodyStrong" color={colors.accentDeep}>
              {titlesOpen ? words.titlesHide : words.titlesShow}
            </ThemedText>
          </Pressable>
          {titlesOpen
            ? KINDS.map((kind) => (
                <FormField
                  key={kind}
                  label={words.titleDefaults[kind]}
                  value={value.titles[kind] ?? ""}
                  onChangeText={(text) => patch({ titles: { ...value.titles, [kind]: text } })}
                  placeholder={words.titleDefaults[kind]}
                  maxLength={60}
                  testID={`fee-printing-title-${kind}`}
                />
              ))
            : null}

          <ChoicePills
            label={words.qrLabel}
            value={value.upiMode}
            options={[
              { value: "off" as const, label: words.qr.off },
              { value: "upi_id" as const, label: words.qr.upi_id },
              { value: "image" as const, label: words.qr.image },
            ]}
            onChange={(mode) => patch({ upiMode: mode })}
            help={words.qrHelp[value.upiMode]}
            testIDPrefix="fee-printing-qr"
          />
          {value.upiMode === "upi_id" ? (
            <>
              <FormField
                label={words.upiIdLabel}
                value={value.upiId}
                onChangeText={(text) => patch({ upiId: text })}
                placeholder="school@bank"
                autoCapitalize="none"
                maxLength={100}
                testID="fee-printing-upi-id"
              />
              <FormField
                label={words.payeeLabel}
                value={value.upiPayeeName}
                onChangeText={(text) => patch({ upiPayeeName: text })}
                help={words.payeeHelp}
                maxLength={100}
                testID="fee-printing-payee"
              />
            </>
          ) : null}
          {value.upiMode === "image" ? (
            <View style={styles.row}>
              <View style={styles.rowText}>
                <ThemedText variant="bodyStrong">{words.qrImage}</ThemedText>
                <ThemedText variant="meta">
                  {value.upiImageObjectId ? words.qrImageSet : words.qrImageNone}
                </ThemedText>
              </View>
              <CapsuleButton
                title={value.upiImageObjectId ? words.replace : words.upload}
                variant="secondary"
                size="mini"
                loading={uploading}
                onPress={() => void uploadImage("upiImageObjectId")}
                testID="fee-printing-qr-image"
              />
            </View>
          ) : null}
        </>
      )}

      {error ? (
        <Notice tone="critical" message={toFriendlyError(error).message} testID="fee-printing-error" />
      ) : null}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  toggle: {
    minHeight: 44,
    justifyContent: "center",
  },
});
