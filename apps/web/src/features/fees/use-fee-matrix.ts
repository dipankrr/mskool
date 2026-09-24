"use client";

import { useActiveContext } from "@/features/session/active-context";
import { trpc } from "@/lib/trpc/client";
import type { FeeMatrixCellInput, FeeMatrixListInput } from "@/lib/trpc/types";

const THIRTY_SECONDS = 30 * 1000;

const EMPTY_LIST_INPUT = {
  academicYearId: "",
  page: 1,
  pageSize: 50,
  sort: "student",
  view: "all",
} as const;

const EMPTY_CELL_INPUT = {
  academicYearId: "",
  studentId: "",
  month: "0000-00",
} as const;

function hasAcademicYearId(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function useFeeMatrixList(input: FeeMatrixListInput | undefined) {
  const { scopeArgs } = useActiveContext();
  const enabled = hasAcademicYearId(input?.academicYearId);
  const query = trpc.fees.matrix.list.useQuery(
    {
      ...scopeArgs(),
      ...(input ?? EMPTY_LIST_INPUT),
    },
    {
      enabled,
      staleTime: THIRTY_SECONDS,
    },
  );

  return { ...query, isLoading: enabled && query.isLoading };
}

export function useFeeMatrixCell(input: FeeMatrixCellInput | undefined) {
  const { scopeArgs } = useActiveContext();
  const enabled =
    hasAcademicYearId(input?.academicYearId) &&
    Boolean(input?.studentId) &&
    Boolean(input?.month);
  const query = trpc.fees.matrix.cell.useQuery(
    {
      ...scopeArgs(),
      ...(input ?? EMPTY_CELL_INPUT),
    },
    {
      enabled,
      staleTime: THIRTY_SECONDS,
      retry: false,
    },
  );

  return { ...query, isLoading: enabled && query.isLoading };
}
