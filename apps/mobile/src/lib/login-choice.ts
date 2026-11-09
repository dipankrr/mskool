import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Which sign-in the phone last chose on the welcome screen. With a choice
 * saved, the login route opens straight on that form; with none (first
 * launch, after signing out, or after tapping back) it shows the welcome
 * screen. Storage failures read as "no choice", never as an error.
 */
export type LoginChoice = "family" | "staff";

const KEY = "login.mode";

export async function readLoginChoice(): Promise<LoginChoice | null> {
  try {
    const saved = await AsyncStorage.getItem(KEY);
    return saved === "family" || saved === "staff" ? saved : null;
  } catch {
    return null;
  }
}

export async function saveLoginChoice(choice: LoginChoice): Promise<void> {
  await AsyncStorage.setItem(KEY, choice).catch(() => undefined);
}

export async function clearLoginChoice(): Promise<void> {
  await AsyncStorage.removeItem(KEY).catch(() => undefined);
}
