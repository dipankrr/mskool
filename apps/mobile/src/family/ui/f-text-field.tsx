import { forwardRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import type { StyleProp, TextInputProps, ViewStyle } from "react-native";

import { AppIcon } from "../../components/app-icon";
import { useFamilyTheme } from "../theme";
import { FText } from "./f-text";

/**
 * A labelled input: label above, a soft rounded box, a hint or an error
 * below. Look from `components.field`. `secure` adds a show/hide button
 * (its labels arrive translated).
 */
export const FTextField = forwardRef<
  TextInput,
  Omit<TextInputProps, "style" | "secureTextEntry"> & {
    label: string;
    hint?: string;
    error?: string | null;
    secure?: { show: string; hide: string };
    style?: StyleProp<ViewStyle>;
  }
>(function FTextField({ label, hint, error, secure, style, onFocus, onBlur, ...input }, ref) {
  const theme = useFamilyTheme();
  const f = theme.components.field;
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const borderColor = error ? f.errorBorder : focused ? f.focusBorder : "transparent";

  return (
    <View style={[{ gap: f.gap }, style]}>
      <FText variant="label">{label}</FText>
      <View
        style={[
          styles.box,
          {
            minHeight: f.height,
            borderRadius: f.radius,
            backgroundColor: f.bg,
            paddingHorizontal: f.paddingX,
            borderColor,
          },
        ]}
      >
        <TextInput
          ref={ref}
          {...input}
          accessibilityLabel={label}
          accessibilityHint={error ?? hint}
          secureTextEntry={secure ? !revealed : undefined}
          placeholderTextColor={f.placeholder}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[styles.input, theme.text("bodyStrong"), { color: f.text }]}
        />
        {secure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? secure.hide : secure.show}
            hitSlop={10}
            onPress={() => setRevealed((value) => !value)}
          >
            <AppIcon name={revealed ? "lock" : "key"} size={20} color={theme.color.muted} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <FText variant="meta" color="critical" accessibilityLiveRegion="polite">
          {error}
        </FText>
      ) : hint ? (
        <FText variant="meta" color="muted">
          {hint}
        </FText>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  box: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    gap: 8,
  },
  input: {
    flex: 1,
    paddingVertical: 12,
  },
});
