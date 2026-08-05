ALTER TABLE "meeting" DROP CONSTRAINT "meeting_userId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "scheduling" DROP CONSTRAINT "scheduling_hostId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "scheduling" DROP CONSTRAINT "scheduling_guestId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "scheduling" DROP CONSTRAINT "scheduling_meetingId_meeting_id_fk";
--> statement-breakpoint
ALTER TABLE "meeting" ALTER COLUMN "start_datetime" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meeting" ALTER COLUMN "end_datetime" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meeting" ALTER COLUMN "userId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meeting" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meeting" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "scheduling" ALTER COLUMN "schedulingDatetime" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scheduling" ALTER COLUMN "hostId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduling" ALTER COLUMN "guestId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduling" ALTER COLUMN "meetingId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduling" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scheduling" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scheduling" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling" ADD CONSTRAINT "scheduling_hostId_user_id_fk" FOREIGN KEY ("hostId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling" ADD CONSTRAINT "scheduling_guestId_user_id_fk" FOREIGN KEY ("guestId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling" ADD CONSTRAINT "scheduling_meetingId_meeting_id_fk" FOREIGN KEY ("meetingId") REFERENCES "public"."meeting"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scheduling_active_slot_idx" ON "scheduling" USING btree ("meetingId","schedulingDatetime") WHERE "isActive";