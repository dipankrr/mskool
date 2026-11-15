DROP INDEX "attendance_week_patterns_school_year_uq";--> statement-breakpoint
ALTER TABLE "attendance_week_patterns" ADD COLUMN "from_date" date;--> statement-breakpoint
ALTER TABLE "attendance_week_patterns" ADD COLUMN "to_date" date;--> statement-breakpoint
UPDATE "attendance_week_patterns" p SET "from_date" = y."start_date", "to_date" = y."end_date" FROM "academic_years" y WHERE y."id" = p."academic_year_id";--> statement-breakpoint
ALTER TABLE "attendance_week_patterns" ALTER COLUMN "from_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_week_patterns" ALTER COLUMN "to_date" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_week_patterns_school_year_from_uq" ON "attendance_week_patterns" USING btree ("school_id","academic_year_id","from_date");
