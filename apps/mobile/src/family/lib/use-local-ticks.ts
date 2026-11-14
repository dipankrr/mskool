import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const EMPTY: ReadonlySet<string> = new Set();
/** Old ticks fall off the end; a child never has this many open at once. */
const KEEP = 200;

function storageKey(studentId: string): string {
  return `family.home.ticks.${studentId}`;
}

/**
 * Ticks that live on this phone only: bag items, and homework that sends
 * nothing back to the teacher. They are a reminder for the family, so they
 * never reach the server. Kept per child.
 */
export function useLocalTicks(studentId: string): {
  ticks: ReadonlySet<string>;
  toggle: (id: string) => void;
} {
  const [state, setState] = useState<{ studentId: string; ticks: ReadonlySet<string> }>({ studentId: "", ticks: EMPTY });

  useEffect(() => {
    if (!studentId) return;
    let alive = true;
    AsyncStorage.getItem(storageKey(studentId))
      .then((raw) => {
        if (!alive) return;
        const list: unknown = raw ? JSON.parse(raw) : [];
        const ids = Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : [];
        setState({ studentId, ticks: new Set(ids) });
      })
      .catch(() => {
        if (alive) setState({ studentId, ticks: EMPTY });
      });
    return () => {
      alive = false;
    };
  }, [studentId]);

  const toggle = useCallback(
    (id: string) => {
      if (!studentId) return;
      setState((current) => {
        const next = new Set(current.studentId === studentId ? current.ticks : EMPTY);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        const ids = [...next].slice(-KEEP);
        void AsyncStorage.setItem(storageKey(studentId), JSON.stringify(ids)).catch(() => undefined);
        return { studentId, ticks: new Set(ids) };
      });
    },
    [studentId],
  );

  // Another child's ticks never show while this child's are loading.
  return { ticks: state.studentId === studentId ? state.ticks : EMPTY, toggle };
}
