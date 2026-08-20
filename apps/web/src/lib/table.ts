"use client";

import {
  createSortedRowModel,
  createTableHook,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  type ColumnDef,
  type RowData,
} from "@tanstack/react-table";

/**
 * THE ONE TABLE ENGINE CONFIGURATION FOR THIS APP.
 *
 * **This is v9, not v8.** `pnpm add` resolved 9.1.2, and the version every
 * DataTable tutorial on the web describes is v8. The differences that matter:
 * `useTable` replaces `useReactTable`, row models are registered as *feature
 * slots* instead of `getCoreRowModel` options, and `table.FlexRender` replaces
 * calling `flexRender` by hand. Copying a v8 snippet here produces code that
 * type-checks against nothing. The library ships its own guidance —
 * `node_modules/@tanstack/react-table/skills/` and
 * `node_modules/@tanstack/table-core/skills/` — and that is the reference.
 *
 * `createTableHook` exists precisely for the "configure once, use everywhere"
 * shape this app wants: features are declared here, and `useAppTable` /
 * `createAppColumnHelper` come back already bound to them. A screen that built its
 * own `tableFeatures` would get a table whose columns are not assignable to
 * anyone else's.
 *
 * **Only sorting is registered.** In v9 a feature's state and methods do not exist
 * until its plugin is, which is the point — filtering and pagination stay out of
 * the bundle until a screen needs them. The reference lists in Phases 1-2 are
 * small and server-ordered; the student, attendance, fee and marks grids in Phases
 * 3-5 are where `columnFilteringFeature` and `rowPaginationFeature` get added, next
 * to their row-model slots.
 *
 * The four `sortFns` are registered because a column's default `sortingFn` is
 * `'auto'`, and `'auto'` resolves only *registered* functions. Leaving them out
 * makes every sortable header fail at runtime while type-checking cleanly.
 */
export const { appFeatures, useAppTable, createAppColumnHelper } = createTableHook({
  features: tableFeatures({
    rowSortingFeature,
    sortedRowModel: createSortedRowModel(),
    sortFns: {
      alphanumeric: sortFn_alphanumeric,
      basic: sortFn_basic,
      datetime: sortFn_datetime,
      text: sortFn_text,
    },
  }),
});

export type AppFeatures = typeof appFeatures;

/**
 * Columns for `DataTable`, built with `createAppColumnHelper<Row>()`.
 *
 * `any` for the cell value is the library's own signature for a heterogeneous
 * column array — the helper's `columns()` returns exactly this. Each column keeps
 * its own value type internally; only the array that holds them is loose.
 *
 * `RowData` is the library's constraint (`Record<string, any> | Array<any>`), and
 * repeating it here is what lets a caller's row type flow through unchanged.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DataTableColumns<TRow extends RowData> = Array<ColumnDef<AppFeatures, TRow, any>>;
