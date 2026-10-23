import { useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import type { NavigationAction } from "expo-router/react-navigation";

import { copy } from "../lib/copy";

/**
 * "Discard changes?" on the way out of a dirty form (Step 1 chunk B).
 *
 * `usePreventRemove` intercepts back, the header's back control, the Android
 * hardware back and an upward swipe alike, so the guard is defined once at the
 * navigation layer rather than wired into each control. The action that was
 * prevented is held in a ref and replayed once `discarding` turns the guard
 * off — dispatching it straight from the alert callback would still meet the
 * old guard.
 *
 * Keep editing is the cancel action: a stray back must never throw away typed
 * work. Discard is destructive-styled, but it only means "leave"; nothing has
 * been sent to the server.
 */
export function useUnsavedChanges(dirty: boolean): void {
  const navigation = useNavigation();
  const pendingAction = useRef<NavigationAction | null>(null);
  const [discarding, setDiscarding] = useState(false);

  usePreventRemove(dirty && !discarding, ({ data }) => {
    Alert.alert(copy.forms.discardTitle, copy.forms.discardBody, [
      { text: copy.forms.keepEditing, style: "cancel" },
      {
        text: copy.forms.discard,
        style: "destructive",
        onPress: () => {
          pendingAction.current = data.action;
          setDiscarding(true);
        },
      },
    ]);
  });

  useEffect(() => {
    const action = pendingAction.current;
    if (!discarding || !action) return;
    pendingAction.current = null;
    navigation.dispatch(action);
  }, [discarding, navigation]);
}
