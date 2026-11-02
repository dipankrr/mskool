CREATE TYPE "public"."fee_print_upi_mode" AS ENUM('off', 'upi_id', 'image');--> statement-breakpoint
CREATE TYPE "public"."fee_receipt_layout" AS ENUM('a4_full', 'a4_half_two', 'a4_half_top', 'a4_half_bottom', 'thermal_58', 'thermal_80');--> statement-breakpoint
CREATE TABLE "fee_print_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"logo_object_id" uuid,
	"header_text" varchar(300) DEFAULT '' NOT NULL,
	"sub_text" varchar(300) DEFAULT '' NOT NULL,
	"footer_text" varchar(300) DEFAULT '' NOT NULL,
	"signature_label" varchar(60) DEFAULT '' NOT NULL,
	"titles" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"show_amount_in_words" boolean DEFAULT true NOT NULL,
	"receipt_layout" "fee_receipt_layout" DEFAULT 'a4_half_two' NOT NULL,
	"upi_mode" "fee_print_upi_mode" DEFAULT 'off' NOT NULL,
	"upi_id" varchar(100),
	"upi_payee_name" varchar(100),
	"upi_image_object_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fee_print_settings" ADD CONSTRAINT "fee_print_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_print_settings" ADD CONSTRAINT "fee_print_settings_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_print_settings" ADD CONSTRAINT "fee_print_settings_logo_object_id_storage_objects_id_fk" FOREIGN KEY ("logo_object_id") REFERENCES "public"."storage_objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_print_settings" ADD CONSTRAINT "fee_print_settings_upi_image_object_id_storage_objects_id_fk" FOREIGN KEY ("upi_image_object_id") REFERENCES "public"."storage_objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fee_print_settings_school_uq" ON "fee_print_settings" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "fee_print_settings_org_idx" ON "fee_print_settings" USING btree ("organization_id");