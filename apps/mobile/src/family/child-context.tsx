import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTranslation } from "react-i18next";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/trpc";

import { trpc } from "../lib/trpc";

export type FamilyChild = inferRouterOutputs<AppRouter>["portal"]["children"]["list"][number];

const STORAGE_KEY = "family.child";

type Value = {
  children: FamilyChild[];
  child: FamilyChild | null;
  select: (studentId: string) => void;
  /** "Aarav, Class 6 · A": the header line for the chosen child. */
  line: string;
  query: ReturnType<typeof trpc.portal.children.list.useQuery>;
};

const ChildContext = createContext<Value | null>(null);

/**
 * Which child the family app is showing. The list comes from the server; the
 * choice is remembered on the phone, and falls back to the first child when
 * the remembered one is gone (a revoked link, a new login).
 */
export function FamilyChildProvider({ children: content }: { children: ReactNode }) {
  const { t } = useTranslation("family");
  const query = trpc.portal.children.list.useQuery(undefined, { staleTime: 5 * 60_000 });
  const [savedId, setSavedId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((id) => setSavedId(id))
      .catch(() => setSavedId(null));
  }, []);

  const list = useMemo(() => query.data ?? [], [query.data]);
  const child = list.find((c) => c.studentId === savedId) ?? list[0] ?? null;

  const select = useCallback((studentId: string) => {
    setSavedId(studentId);
    void AsyncStorage.setItem(STORAGE_KEY, studentId).catch(() => undefined);
  }, []);

  const line = child ? childLine(t, child) : "";

  const value = useMemo(
    () => ({ children: list, child, select, line, query }),
    [list, child, select, line, query],
  );
  return <ChildContext.Provider value={value}>{content}</ChildContext.Provider>;
}

export function childClass(t: ReturnType<typeof useTranslation<"family">>["t"], child: FamilyChild): string {
  return child.sectionName
    ? t("switcher.classSection", { class: child.className, section: child.sectionName })
    : t("switcher.classOnly", { class: child.className });
}

function childLine(t: ReturnType<typeof useTranslation<"family">>["t"], child: FamilyChild): string {
  return t("switcher.line", { name: child.firstName, class: childClass(t, child) });
}

export function useFamilyChild(): Value {
  const value = useContext(ChildContext);
  if (!value) throw new Error("useFamilyChild must be used inside FamilyChildProvider.");
  return value;
}
