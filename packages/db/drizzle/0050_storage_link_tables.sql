CREATE TABLE "id_card_template_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_site_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "id_card_template_assets" ADD CONSTRAINT "id_card_template_assets_template_id_id_card_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."id_card_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "id_card_template_assets" ADD CONSTRAINT "id_card_template_assets_object_id_storage_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."storage_objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "id_card_template_assets" ADD CONSTRAINT "id_card_template_assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_site_media" ADD CONSTRAINT "public_site_media_site_id_org_public_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."org_public_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_site_media" ADD CONSTRAINT "public_site_media_object_id_storage_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."storage_objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_site_media" ADD CONSTRAINT "public_site_media_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "id_card_template_assets_uq" ON "id_card_template_assets" USING btree ("template_id","object_id");--> statement-breakpoint
CREATE INDEX "id_card_template_assets_object_idx" ON "id_card_template_assets" USING btree ("object_id");--> statement-breakpoint
CREATE UNIQUE INDEX "public_site_media_uq" ON "public_site_media" USING btree ("site_id","object_id");--> statement-breakpoint
CREATE INDEX "public_site_media_object_idx" ON "public_site_media" USING btree ("object_id");