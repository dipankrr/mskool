import { useRef, useState } from "react";
import { Keyboard, Pressable, StyleSheet, TextInput, View } from "react-native";

import { AppIcon } from "../../components/app-icon";
import { CapsuleButton } from "../../components/capsule-button";
import { Card } from "../../components/card";
import { ChoicePills } from "../../components/choice-pills";
import { DateField } from "../../components/date-field";
import { ErrorCard } from "../../components/error-card";
import { FormField } from "../../components/form-field";
import { Notice } from "../../components/notice";
import { SectionLabel } from "../../components/section-label";
import { SelectField } from "../../components/select-field";
import { Skeleton } from "../../components/skeleton";
import { ThemedText } from "../../components/themed-text";
import { copy } from "../../lib/copy";
import { toFriendlyError } from "../../lib/errors";
import { formatReadableDate, todayIso } from "../../lib/format";
import { colors } from "../../theme/brand-admin";
import { spacing } from "../../theme/tokens";
import {
  filledSlots,
  normaliseParentPhone,
  primarySlot,
  relationFor,
  studentFullName,
  type FamilyErrors,
  type FamilyField,
  type FamilyForm,
  type FamilySlot,
  type GuardianRelation,
  type MoreGroup,
  type RegisterRow,
} from "./admit-logic";
import { GUARDIAN_RELATIONS, guardianRelationLabel } from "./people-logic";
import type { StudentForm, StudentFormField } from "./student-form";
import { PhotoSourceSheet, StudentPhotoView, type PickedImage } from "./student-photo";

/** Where the birth-date picker opens: about the age of a child starting school. */
function typicalBirthDate(): string {
  const today = todayIso();
  return `${Number(today.slice(0, 4)) - 6}${today.slice(4)}`;
}

// ------------------------------------------------------------------- student

/** Held on the phone until the student exists to attach it to. */
function PhotoField({
  photo,
  name,
  onPhoto,
}: {
  photo: PickedImage | null;
  name: string;
  onPhoto: (photo: PickedImage | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const label = photo ? copy.admit.photo.change : copy.admit.photo.add;
  const openSheet = () => {
    Keyboard.dismiss();
    setError(null);
    setOpen(true);
  };
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={copy.admit.photo.hint}
        onPress={openSheet}
        style={({ pressed }) => [styles.photoRow, pressed ? styles.photoPressed : null]}
        testID="admit-photo"
      >
        <StudentPhotoView uri={photo?.uri ?? null} name={name.trim() || null} size={64} />
        <View style={styles.photoText}>
          <ThemedText variant="bodyStrong">{label}</ThemedText>
          <ThemedText variant="meta">
            {photo ? copy.admit.photo.chosen : copy.admit.photo.optional}
          </ThemedText>
        </View>
      </Pressable>
      {error ? (
        <Notice
          tone="critical"
          message={toFriendlyError(error).message}
          style={styles.photoError}
          testID="admit-photo-error"
        />
      ) : null}
      <PhotoSourceSheet
        visible={open}
        hasPhoto={photo !== null}
        onDismiss={() => setOpen(false)}
        onPicked={onPhoto}
        onRemove={() => onPhoto(null)}
        onError={setError}
      />
    </>
  );
}

export function StudentStep({
  form,
  set,
  touch,
  fieldError,
  suggestion,
  duplicate,
  photo,
  onPhoto,
  focusName,
}: {
  form: StudentForm;
  set: (field: StudentFormField, value: string | null) => void;
  touch: (field: StudentFormField) => void;
  fieldError: (field: StudentFormField) => string | undefined;
  /** The next number in sequence, if the register shows one. */
  suggestion: string | null;
  duplicate: RegisterRow | null;
  photo: PickedImage | null;
  /** Absent when the account can't save a photo, so it isn't offered. */
  onPhoto?: (photo: PickedImage | null) => void;
  /** Open on the name, which suits one short step but not a long form. */
  focusName: boolean;
}) {
  const lastNameRef = useRef<TextInput>(null);
  const [showMiddle, setShowMiddle] = useState(form.middleName.length > 0);

  return (
    <>
      <Card style={styles.card}>
        {onPhoto ? (
          <PhotoField photo={photo} name={studentFullName(form)} onPhoto={onPhoto} />
        ) : null}
        <View style={styles.nameRow}>
          <View style={styles.nameCell}>
            <FormField
              label={copy.studentForm.fields.firstName}
              value={form.firstName}
              onChangeText={(value) => set("firstName", value)}
              onBlur={() => touch("firstName")}
              error={fieldError("firstName")}
              autoCapitalize="words"
              autoCorrect={false}
              autoFocus={focusName && form.firstName.length === 0}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => lastNameRef.current?.focus()}
              testID="admit-first-name"
            />
          </View>
          <View style={styles.nameCell}>
            <FormField
              inputRef={lastNameRef}
              label={copy.studentForm.fields.lastName}
              value={form.lastName}
              onChangeText={(value) => set("lastName", value)}
              onBlur={() => touch("lastName")}
              error={fieldError("lastName")}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="done"
              testID="admit-last-name"
            />
          </View>
        </View>
        {showMiddle ? (
          <FormField
            label={copy.studentForm.fields.middleName}
            value={form.middleName}
            onChangeText={(value) => set("middleName", value)}
            autoCapitalize="words"
            autoCorrect={false}
            testID="admit-middle-name"
          />
        ) : (
          <Pressable
            testID="admit-add-middle-name"
            accessibilityRole="button"
            onPress={() => setShowMiddle(true)}
            hitSlop={8}
            style={styles.textLink}
          >
            <AppIcon name="add" size={16} color={colors.accentDeep} />
            <ThemedText variant="caption" color={colors.accentDeep}>
              {copy.admit.student.addMiddleName}
            </ThemedText>
          </Pressable>
        )}
        <DateField
          label={copy.studentForm.fields.dateOfBirth}
          value={form.dateOfBirth}
          onChange={(value) => {
            set("dateOfBirth", value);
            touch("dateOfBirth");
          }}
          error={fieldError("dateOfBirth")}
          maximumDate={todayIso()}
          initialDate={typicalBirthDate()}
          testID="admit-dob"
        />
        <ChoicePills
          label={copy.studentForm.fields.gender}
          value={form.gender}
          options={(["male", "female", "other"] as const).map((gender) => ({
            value: gender,
            label: copy.studentForm.genders[gender],
          }))}
          onChange={(value) => {
            set("gender", value);
            touch("gender");
          }}
          error={fieldError("gender")}
          testIDPrefix="admit-gender"
        />
      </Card>

      {duplicate ? (
        <Notice
          tone="caution"
          message={copy.admit.student.possibleDuplicate(
            `${duplicate.firstName} ${duplicate.lastName}`,
            duplicate.admissionNumber,
          )}
          style={styles.notice}
          testID="admit-duplicate"
        />
      ) : null}

      <SectionLabel>{copy.admit.student.admissionLabel}</SectionLabel>
      <Card style={styles.card}>
        <FormField
          label={copy.studentForm.fields.admissionNumber}
          value={form.admissionNumber}
          onChangeText={(value) => set("admissionNumber", value)}
          onBlur={() => touch("admissionNumber")}
          help={copy.admit.student.numberHelp}
          error={fieldError("admissionNumber")}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={50}
          testID="admit-admission-number"
        />
        {suggestion && form.admissionNumber.trim() !== suggestion ? (
          <View style={styles.suggestion}>
            <CapsuleButton
              title={copy.admit.student.suggest(suggestion)}
              variant="secondary"
              size="compact"
              onPress={() => set("admissionNumber", suggestion)}
              testID="admit-suggest-number"
            />
          </View>
        ) : null}
        <DateField
          label={copy.students.fields.admissionDate}
          value={form.admissionDate}
          onChange={(value) => set("admissionDate", value)}
          maximumDate={todayIso()}
          testID="admit-admission-date"
        />
      </Card>
    </>
  );
}

// --------------------------------------------------------------------- class

export type ClassOption = { id: string; name: string };
export type SectionOption = { id: string; name: string; strength: number | null };

export function ClassStep({
  sessionName,
  classes,
  sections,
  classId,
  sectionId,
  loading,
  error,
  onRetry,
  onClass,
  onSection,
}: {
  sessionName: string | null;
  classes: ClassOption[];
  /** The chosen class's sections. */
  sections: SectionOption[];
  classId: string | null;
  sectionId: string | null;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onClass: (id: string) => void;
  onSection: (id: string | null) => void;
}) {
  if (!sessionName) {
    return (
      <Notice
        tone="neutral"
        title={copy.admit.class.noSessionTitle}
        message={copy.admit.class.noSessionBody}
        testID="admit-no-session"
      />
    );
  }
  if (loading) {
    return (
      <View style={styles.skeleton}>
        <Skeleton height={160} />
      </View>
    );
  }
  if (error) {
    return <ErrorCard cause={error} onRetry={onRetry} testID="admit-class-error" />;
  }
  if (classes.length === 0) {
    return (
      <Notice
        tone="neutral"
        title={copy.admit.class.noClassesTitle}
        message={copy.admit.class.noClassesBody}
        testID="admit-no-classes"
      />
    );
  }

  return (
    <>
      <Card style={styles.card}>
        <ChoicePills
          label={copy.admit.class.classLabel}
          value={classId}
          options={classes.map((option) => ({ value: option.id, label: option.name }))}
          onChange={onClass}
          testIDPrefix="admit-class"
        />
      </Card>
      {classId ? (
        <Card style={[styles.card, styles.cardGap]}>
          {sections.length > 0 ? (
            <ChoicePills
              label={copy.admit.class.sectionLabel}
              value={sectionId ?? "later"}
              options={[
                ...sections.map((option) => ({
                  value: option.id,
                  label: copy.admit.class.sectionName(option.name),
                  note:
                    option.strength === null
                      ? undefined
                      : copy.admit.class.strength(option.strength),
                })),
                { value: "later", label: copy.admit.class.sectionLater },
              ]}
              onChange={(value) => onSection(value === "later" ? null : value)}
              testIDPrefix="admit-section"
            />
          ) : (
            <ThemedText variant="meta" style={styles.cardText}>
              {copy.admit.class.noSections}
            </ThemedText>
          )}
        </Card>
      ) : null}
    </>
  );
}

// -------------------------------------------------------------------- family

function FamilyCard({
  slot,
  family,
  errorFor,
  touch,
  onChange,
  children,
}: {
  slot: FamilySlot;
  family: FamilyForm;
  errorFor: (field: FamilyField) => string | undefined;
  touch: (field: FamilyField) => void;
  onChange: (slot: FamilySlot, part: "name" | "phone", value: string) => void;
  children?: React.ReactNode;
}) {
  const phoneRef = useRef<TextInput>(null);
  const label = copy.admit.family.slots[slot];
  return (
    <>
      <SectionLabel style={styles.groupLabel}>{label}</SectionLabel>
      <Card style={styles.card}>
        {children}
        <FormField
          label={copy.admit.family.name}
          value={family[slot].name}
          onChangeText={(value) => onChange(slot, "name", value)}
          onBlur={() => touch(`${slot}.name`)}
          error={errorFor(`${slot}.name`)}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => phoneRef.current?.focus()}
          testID={`admit-${slot}-name`}
        />
        <FormField
          inputRef={phoneRef}
          label={copy.admit.family.phone}
          value={family[slot].phone}
          onChangeText={(value) => onChange(slot, "phone", normaliseParentPhone(value))}
          onBlur={() => touch(`${slot}.phone`)}
          error={errorFor(`${slot}.phone`)}
          keyboardType="phone-pad"
          maxLength={14}
          testID={`admit-${slot}-phone`}
        />
      </Card>
    </>
  );
}

export function FamilyStep({
  family,
  errors,
  showAll,
  onChange,
  onRelation,
  onPrimary,
}: {
  family: FamilyForm;
  errors: FamilyErrors;
  /** Show every error, not just the fields already left. */
  showAll: boolean;
  onChange: (slot: FamilySlot, part: "name" | "phone", value: string) => void;
  onRelation: (relation: GuardianRelation) => void;
  onPrimary: (slot: FamilySlot) => void;
}) {
  const [touched, setTouched] = useState<Set<FamilyField>>(new Set());
  const [showOther, setShowOther] = useState(filledSlots(family).includes("other"));
  const touch = (field: FamilyField) =>
    setTouched((current) => new Set(current).add(field));
  const errorFor = (field: FamilyField) =>
    showAll || touched.has(field) ? errors[field] : undefined;
  const filled = filledSlots(family);

  return (
    <>
      <Notice message={copy.admit.family.intro} testID="admit-family-intro" />
      {(["father", "mother"] as const).map((slot) => (
        <FamilyCard
          key={slot}
          slot={slot}
          family={family}
          errorFor={errorFor}
          touch={touch}
          onChange={onChange}
        />
      ))}
      {showOther ? (
        <FamilyCard
          slot="other"
          family={family}
          errorFor={errorFor}
          touch={touch}
          onChange={onChange}
        >
          <SelectField
            label={copy.admit.family.relation}
            valueLabel={family.otherRelation ? guardianRelationLabel(family.otherRelation) : null}
            placeholder={copy.admit.family.relationPlaceholder}
            options={GUARDIAN_RELATIONS.filter(
              (relation) => relation !== "father" && relation !== "mother",
            ).map((relation) => ({
              id: relation,
              label: guardianRelationLabel(relation),
            }))}
            currentId={family.otherRelation ?? ""}
            onSelect={(relation) => onRelation(relation as GuardianRelation)}
            error={errorFor("otherRelation")}
            testID="admit-other-relation"
          />
        </FamilyCard>
      ) : (
        <View style={styles.addOther}>
          <CapsuleButton
            title={copy.admit.family.addOther}
            icon="add"
            variant="secondary"
            size="compact"
            onPress={() => setShowOther(true)}
            testID="admit-add-other"
          />
        </View>
      )}
      {filled.length > 1 ? (
        <Card style={[styles.card, styles.primaryCard]}>
          <ChoicePills
            label={copy.admit.family.primaryLabel}
            value={primarySlot(family)}
            options={filled.map((slot) => ({
              value: slot,
              label: copy.admit.family.slots[slot],
            }))}
            onChange={onPrimary}
            testIDPrefix="admit-primary"
          />
        </Card>
      ) : null}
    </>
  );
}

// -------------------------------------------------------------------- review

function ReviewGroup({
  title,
  onEdit,
  testID,
  children,
}: {
  title: string;
  onEdit?: () => void;
  testID: string;
  children: React.ReactNode;
}) {
  return (
    <Card style={styles.reviewCard} testID={testID}>
      <View style={styles.reviewHead}>
        <ThemedText variant="bodyStrong">{title}</ThemedText>
        {onEdit ? (
          <Pressable
            testID={`${testID}-edit`}
            accessibilityRole="button"
            accessibilityLabel={`${copy.admit.review.edit} ${title}`}
            accessibilityHint={copy.admit.review.editHint(title.toLowerCase())}
            onPress={onEdit}
            hitSlop={12}
          >
            <ThemedText variant="caption" color={colors.accentDeep}>
              {copy.admit.review.edit}
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
      {children}
    </Card>
  );
}

function ReviewLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.reviewLine}>
      <ThemedText variant="meta" style={styles.reviewLabel}>
        {label}
      </ThemedText>
      <ThemedText variant="body" style={styles.reviewValue}>
        {value}
      </ThemedText>
    </View>
  );
}

export function ReviewStep({
  form,
  family,
  placement,
  showClass,
  showFamily,
  photo,
  moreGroups,
  onEdit,
  onEditMore,
}: {
  form: StudentForm;
  family: FamilyForm;
  /** "Class 6 · Section A", or null when not placed. */
  placement: string | null;
  showClass: boolean;
  showFamily: boolean;
  photo: PickedImage | null;
  /** Optional groups already filled in, by way of the full form. */
  moreGroups: MoreGroup[];
  onEdit: (step: "student" | "class" | "family") => void;
  onEditMore: () => void;
}) {
  const filled = filledSlots(family);
  const primary = primarySlot(family);

  return (
    <>
      <ReviewGroup
        title={copy.admit.review.student}
        onEdit={() => onEdit("student")}
        testID="admit-review-student"
      >
        {photo ? (
          <StudentPhotoView uri={photo.uri} name={studentFullName(form)} size={64} />
        ) : null}
        <ReviewLine label={copy.admit.review.name} value={studentFullName(form)} />
        <ReviewLine
          label={copy.admit.review.born}
          value={formatReadableDate(form.dateOfBirth)}
        />
        <ReviewLine
          label={copy.admit.review.gender}
          value={form.gender ? copy.studentForm.genders[form.gender] : ""}
        />
        <ReviewLine label={copy.admit.review.number} value={form.admissionNumber.trim()} />
        <ReviewLine
          label={copy.admit.review.admittedOn}
          value={formatReadableDate(form.admissionDate)}
        />
      </ReviewGroup>

      {showClass ? (
        <ReviewGroup
          title={copy.admit.review.class}
          onEdit={() => onEdit("class")}
          testID="admit-review-class"
        >
          <ThemedText variant={placement ? "body" : "meta"}>
            {placement ?? copy.admit.review.noClass}
          </ThemedText>
        </ReviewGroup>
      ) : null}

      {showFamily ? (
        <ReviewGroup
          title={copy.admit.review.family}
          onEdit={() => onEdit("family")}
          testID="admit-review-family"
        >
          {filled.length === 0 ? (
            <ThemedText variant="meta">{copy.admit.review.noFamily}</ThemedText>
          ) : (
            filled.map((slot) => (
              <ReviewLine
                key={slot}
                label={guardianRelationLabel(relationFor(slot, family))}
                value={[
                  family[slot].name.trim(),
                  family[slot].phone.trim(),
                  filled.length > 1 && slot === primary ? copy.admit.review.primary : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ))
          )}
        </ReviewGroup>
      ) : null}

      {moreGroups.length > 0 ? (
        <ReviewGroup
          title={copy.admit.review.more}
          onEdit={onEditMore}
          testID="admit-review-more"
        >
          <ThemedText variant="body">
            {moreGroups
              .map((group) => copy.admit.fullForm.groups[group])
              .join(", ")
              .replace(/^./, (first) => first.toUpperCase())}
          </ThemedText>
        </ReviewGroup>
      ) : null}

      <Notice
        tone="caution"
        message={copy.admit.review.permanent(form.admissionNumber.trim())}
        style={styles.notice}
        testID="admit-permanent"
      />
    </>
  );
}

const styles = StyleSheet.create({
  photoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 72,
    paddingVertical: spacing.xs,
  },
  photoPressed: {
    opacity: 0.7,
  },
  photoText: {
    flex: 1,
    gap: spacing.xxs,
  },
  photoError: {
    marginTop: spacing.sm,
  },
  nameRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  nameCell: {
    flex: 1,
    minWidth: 0,
  },
  groupLabel: {
    marginTop: spacing.xl,
  },
  card: {
    marginTop: spacing.sm,
    paddingTop: spacing.xs,
  },
  cardGap: {
    marginTop: spacing.md,
  },
  cardText: {
    marginTop: spacing.sm,
  },
  primaryCard: {
    marginTop: spacing.xl,
  },
  notice: {
    marginTop: spacing.lg,
  },
  skeleton: {
    gap: spacing.md,
  },
  textLink: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing.xs,
    marginTop: spacing.md,
    minHeight: 32,
  },
  suggestion: {
    alignItems: "flex-start",
    marginTop: spacing.sm,
  },
  addOther: {
    alignItems: "flex-start",
    marginTop: spacing.lg,
  },
  reviewCard: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  reviewHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 28,
  },
  reviewLine: {
    flexDirection: "row",
    gap: spacing.md,
  },
  reviewLabel: {
    width: 104,
    paddingTop: 2,
  },
  reviewValue: {
    flex: 1,
  },
});
