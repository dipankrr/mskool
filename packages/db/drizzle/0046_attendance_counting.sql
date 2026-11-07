ALTER TABLE "attendance_policies" ADD COLUMN "late_counts_as_present" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_summary" ADD COLUMN "days_attended" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Until the one-time recompute runs, existing rows follow the default rule
-- (late counts as present). The recompute then also applies joining dates.
UPDATE "attendance_summary" SET "days_attended" = "days_present" + "days_late";--> statement-breakpoint
ALTER TABLE "attendance_summary" drop column "attendance_percentage";--> statement-breakpoint
ALTER TABLE "attendance_summary" ADD COLUMN "attendance_percentage" numeric(5, 2) GENERATED ALWAYS AS (CASE WHEN working_days = 0 THEN 0
          ELSE round((days_attended::decimal / working_days) * 100, 2) END) STORED;
