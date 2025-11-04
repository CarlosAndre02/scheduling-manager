CREATE TABLE "meeting" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"start_datetime" timestamp NOT NULL,
	"end_datetime" timestamp NOT NULL,
	"meetingDurationInMinutes" integer NOT NULL,
	"conferenceLink" text NOT NULL,
	"isActive" boolean NOT NULL,
	"userId" text,
	"updated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduling" (
	"id" text PRIMARY KEY NOT NULL,
	"schedulingDatetime" timestamp NOT NULL,
	"name" text NOT NULL,
	"purpose" text NOT NULL,
	"isActive" boolean NOT NULL,
	"hostId" text,
	"guestId" text,
	"meetingId" text,
	"updated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meeting" ADD CONSTRAINT "meeting_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling" ADD CONSTRAINT "scheduling_hostId_user_id_fk" FOREIGN KEY ("hostId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling" ADD CONSTRAINT "scheduling_guestId_user_id_fk" FOREIGN KEY ("guestId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling" ADD CONSTRAINT "scheduling_meetingId_meeting_id_fk" FOREIGN KEY ("meetingId") REFERENCES "public"."meeting"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_user_id_idx" ON "meeting" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "meeting_start_datetime_idx" ON "meeting" USING btree ("start_datetime");--> statement-breakpoint
CREATE INDEX "scheduling_host_id_idx" ON "scheduling" USING btree ("hostId");--> statement-breakpoint
CREATE INDEX "scheduling_guest_id_idx" ON "scheduling" USING btree ("guestId");--> statement-breakpoint
CREATE INDEX "scheduling_meeting_id_idx" ON "scheduling" USING btree ("meetingId");