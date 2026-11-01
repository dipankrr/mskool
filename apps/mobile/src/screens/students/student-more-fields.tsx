import { StyleSheet } from "react-native";

import { Card } from "../../components/card";
import { FormField } from "../../components/form-field";
import { SectionLabel } from "../../components/section-label";
import { SelectField } from "../../components/select-field";
import { copy } from "../../lib/copy";
import { spacing } from "../../theme/tokens";
import {
  normaliseStudentDigits,
  type StudentBloodGroup,
  type StudentForm,
  type StudentFormField,
} from "./student-form";

const BLOOD_GROUPS = Object.keys(copy.studentForm.bloodGroups) as StudentBloodGroup[];

/**
 * Everything about a student beyond the basics, shared by the edit form and the
 * admit flow's full form so the two can't drift apart.
 */
export function StudentMoreFields({
  form,
  set,
  touch,
  fieldError,
  editable = true,
}: {
  form: StudentForm;
  set: (field: StudentFormField, value: string | null) => void;
  touch: (field: StudentFormField) => void;
  fieldError: (field: StudentFormField) => string | undefined;
  editable?: boolean;
}) {
  return (
    <>
      <SectionLabel>{copy.studentForm.sections.contact}</SectionLabel>
      <Card style={styles.card}>
        <FormField
          label={copy.studentForm.fields.phone}
          value={form.phone}
          onChangeText={(phone) => set("phone", phone)}
          onBlur={() => touch("phone")}
          error={fieldError("phone")}
          keyboardType="phone-pad"
          maxLength={20}
          editable={editable}
          testID="student-phone"
        />
        <FormField
          label={copy.studentForm.fields.email}
          value={form.email}
          onChangeText={(email) => set("email", email)}
          onBlur={() => touch("email")}
          error={fieldError("email")}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          editable={editable}
          testID="student-email"
        />
      </Card>

      <SectionLabel>{copy.studentForm.sections.address}</SectionLabel>
      <Card style={styles.card}>
        <FormField
          label={copy.studentForm.fields.addressLine1}
          value={form.addressLine1}
          onChangeText={(addressLine1) => set("addressLine1", addressLine1)}
          autoCapitalize="words"
          editable={editable}
          testID="student-address-1"
        />
        <FormField
          label={copy.studentForm.fields.addressLine2}
          value={form.addressLine2}
          onChangeText={(addressLine2) => set("addressLine2", addressLine2)}
          autoCapitalize="words"
          editable={editable}
          testID="student-address-2"
        />
        <FormField
          label={copy.studentForm.fields.city}
          value={form.city}
          onChangeText={(city) => set("city", city)}
          autoCapitalize="words"
          editable={editable}
          testID="student-city"
        />
        <FormField
          label={copy.studentForm.fields.state}
          value={form.state}
          onChangeText={(state) => set("state", state)}
          autoCapitalize="words"
          editable={editable}
          testID="student-state"
        />
        <FormField
          label={copy.studentForm.fields.pincode}
          value={form.pincode}
          onChangeText={(pincode) => set("pincode", normaliseStudentDigits(pincode))}
          onBlur={() => touch("pincode")}
          error={fieldError("pincode")}
          keyboardType="number-pad"
          maxLength={6}
          editable={editable}
          testID="student-pincode"
        />
      </Card>

      <SectionLabel>{copy.studentForm.sections.medical}</SectionLabel>
      <Card style={styles.card}>
        <SelectField
          label={copy.studentForm.fields.bloodGroup}
          valueLabel={
            form.bloodGroup
              ? copy.studentForm.bloodGroups[form.bloodGroup]
              : copy.studentForm.bloodGroupNone
          }
          placeholder={copy.studentForm.bloodGroupNone}
          options={[
            { id: "", label: copy.studentForm.bloodGroupNone },
            ...BLOOD_GROUPS.map((group) => ({
              id: group,
              label: copy.studentForm.bloodGroups[group],
            })),
          ]}
          currentId={form.bloodGroup ?? ""}
          onSelect={(bloodGroup) =>
            set("bloodGroup", (bloodGroup || null) as StudentBloodGroup | null)
          }
          disabled={!editable}
          testID="student-blood-group"
        />
        <FormField
          label={copy.studentForm.fields.medical}
          value={form.medicalConditions}
          onChangeText={(medicalConditions) => set("medicalConditions", medicalConditions)}
          help={copy.studentForm.fields.medicalHelp}
          autoCapitalize="sentences"
          editable={editable}
          testID="student-medical"
        />
        <FormField
          label={copy.studentForm.fields.emergencyName}
          value={form.emergencyContactName}
          onChangeText={(emergencyContactName) =>
            set("emergencyContactName", emergencyContactName)
          }
          autoCapitalize="words"
          editable={editable}
          testID="student-emergency-name"
        />
        <FormField
          label={copy.studentForm.fields.emergencyPhone}
          value={form.emergencyContactPhone}
          onChangeText={(emergencyContactPhone) =>
            set("emergencyContactPhone", emergencyContactPhone)
          }
          onBlur={() => touch("emergencyContactPhone")}
          error={fieldError("emergencyContactPhone")}
          keyboardType="phone-pad"
          maxLength={20}
          editable={editable}
          testID="student-emergency-phone"
        />
      </Card>

      <SectionLabel>{copy.studentForm.sections.background}</SectionLabel>
      <Card style={styles.card}>
        <FormField
          label={copy.studentForm.fields.nationality}
          value={form.nationality}
          onChangeText={(nationality) => set("nationality", nationality)}
          autoCapitalize="words"
          editable={editable}
          testID="student-nationality"
        />
        <FormField
          label={copy.studentForm.fields.religion}
          value={form.religion}
          onChangeText={(religion) => set("religion", religion)}
          autoCapitalize="words"
          editable={editable}
          testID="student-religion"
        />
        <FormField
          label={copy.studentForm.fields.category}
          value={form.category}
          onChangeText={(category) => set("category", category)}
          help={copy.studentForm.fields.categoryHelp}
          autoCapitalize="characters"
          editable={editable}
          testID="student-category"
        />
        <FormField
          label={copy.studentForm.fields.motherTongue}
          value={form.motherTongue}
          onChangeText={(motherTongue) => set("motherTongue", motherTongue)}
          autoCapitalize="words"
          editable={editable}
          testID="student-mother-tongue"
        />
        <FormField
          label={copy.studentForm.fields.aadhaar}
          value={form.aadhaarNumber}
          onChangeText={(aadhaarNumber) =>
            set("aadhaarNumber", normaliseStudentDigits(aadhaarNumber))
          }
          onBlur={() => touch("aadhaarNumber")}
          help={copy.studentForm.fields.aadhaarHelp}
          error={fieldError("aadhaarNumber")}
          keyboardType="number-pad"
          maxLength={12}
          editable={editable}
          testID="student-aadhaar"
        />
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
  },
});
