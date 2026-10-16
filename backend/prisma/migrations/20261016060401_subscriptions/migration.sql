-- CreateEnum
CREATE TYPE "PlanInterval" AS ENUM ('WEEK', 'MONTH');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'REVERSED');

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "interval" "PlanInterval" NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'TZS',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "grace_days" INTEGER NOT NULL DEFAULT 3,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_features" (
    "plan_id" UUID NOT NULL,
    "feature_key" VARCHAR(40) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "limit_value" INTEGER,

    CONSTRAINT "plan_features_pkey" PRIMARY KEY ("plan_id","feature_key")
);

-- CreateTable
CREATE TABLE "billing_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "trial_days" INTEGER NOT NULL DEFAULT 14,
    "reminder_days_before" INTEGER NOT NULL DEFAULT 3,
    "payment_instructions" VARCHAR(1000),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "billing_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "plan_id" UUID,
    "trial_ends_at" TIMESTAMPTZ(3) NOT NULL,
    "paid_until" TIMESTAMPTZ(3),
    "grace_days" INTEGER NOT NULL DEFAULT 3,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_periods" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "interval" "PlanInterval" NOT NULL,
    "period_start" TIMESTAMPTZ(3) NOT NULL,
    "period_end" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversed_at" TIMESTAMPTZ(3),

    CONSTRAINT "subscription_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_payments" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "provider_reference" VARCHAR(100) NOT NULL,
    "payer_phone" VARCHAR(32),
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "idempotency_key" VARCHAR(80) NOT NULL,
    "initiated_by_user_id" UUID,
    "decided_by_user_id" UUID,
    "confirmed_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "reversed_at" TIMESTAMPTZ(3),
    "note" VARCHAR(500),
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "provider_event_id" VARCHAR(120) NOT NULL,
    "payload" JSONB NOT NULL,
    "signature_valid" BOOLEAN NOT NULL,
    "outcome" VARCHAR(40) NOT NULL,
    "payment_id" UUID,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_reminders" (
    "subscription_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_reminders_pkey" PRIMARY KEY ("subscription_id","kind","due_at")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_shop_id_key" ON "subscriptions"("shop_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_shop_id_id_key" ON "subscriptions"("shop_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_periods_payment_id_key" ON "subscription_periods"("payment_id");

-- CreateIndex
CREATE INDEX "subscription_periods_subscription_id_period_end_idx" ON "subscription_periods"("subscription_id", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_periods_shop_id_payment_id_key" ON "subscription_periods"("shop_id", "payment_id");

-- CreateIndex
CREATE INDEX "subscription_payments_status_created_at_idx" ON "subscription_payments"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_payments_shop_id_id_key" ON "subscription_payments"("shop_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_payments_provider_provider_reference_key" ON "subscription_payments"("provider", "provider_reference");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_payments_shop_id_idempotency_key_key" ON "subscription_payments"("shop_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_provider_provider_event_id_key" ON "payment_events"("provider", "provider_event_id");

-- AddForeignKey
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_periods" ADD CONSTRAINT "subscription_periods_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_periods" ADD CONSTRAINT "subscription_periods_shop_id_subscription_id_fkey" FOREIGN KEY ("shop_id", "subscription_id") REFERENCES "subscriptions"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_periods" ADD CONSTRAINT "subscription_periods_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_periods" ADD CONSTRAINT "subscription_periods_shop_id_payment_id_fkey" FOREIGN KEY ("shop_id", "payment_id") REFERENCES "subscription_payments"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_shop_id_subscription_id_fkey" FOREIGN KEY ("shop_id", "subscription_id") REFERENCES "subscriptions"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "subscription_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_reminders" ADD CONSTRAINT "subscription_reminders_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written additions (Phase 04).
-- ---------------------------------------------------------------------------

ALTER TABLE "plans" ADD CONSTRAINT "plans_price_non_negative" CHECK ("price" >= 0);
ALTER TABLE "plans" ADD CONSTRAINT "plans_grace_days_range" CHECK ("grace_days" BETWEEN 0 AND 60);
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_limit_positive" CHECK ("limit_value" IS NULL OR "limit_value" >= 0);
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_single_row" CHECK ("id" = 1);
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_ranges" CHECK ("trial_days" BETWEEN 0 AND 90 AND "reminder_days_before" BETWEEN 0 AND 30);
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_grace_days_range" CHECK ("grace_days" BETWEEN 0 AND 60);
ALTER TABLE "subscription_periods" ADD CONSTRAINT "subscription_periods_order" CHECK ("period_end" > "period_start");
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_amount_non_negative" CHECK ("amount" >= 0);

-- Approved defaults (D-005 and D-019, 2026-10-16): 14-day trial, reminders 3
-- days before expiry. Platform staff can change them later.
INSERT INTO "billing_settings" ("id", "trial_days", "reminder_days_before", "updated_at")
VALUES (1, 14, 3, now());

-- Shops created before this migration start a trial now. (Ids here are
-- random v4 UUIDs; the API generates v7 for new rows.)
INSERT INTO "subscriptions" ("id", "shop_id", "trial_ends_at", "grace_days", "created_at", "updated_at")
SELECT gen_random_uuid(), s."id", now() + interval '14 days', 3, now(), now()
FROM "shops" s;

-- Paid periods are history: they can be added and later marked reversed
-- once, but never edited otherwise or deleted.
CREATE FUNCTION subscription_periods_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'subscription_periods rows cannot be deleted';
  END IF;
  IF OLD.reversed_at IS NOT NULL
     OR NEW.reversed_at IS NULL
     OR (to_jsonb(NEW) - 'reversed_at') <> (to_jsonb(OLD) - 'reversed_at') THEN
    RAISE EXCEPTION 'subscription_periods rows can only be marked reversed, once';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER subscription_periods_append_only
BEFORE UPDATE OR DELETE ON "subscription_periods"
FOR EACH ROW EXECUTE FUNCTION subscription_periods_append_only();

-- Received callbacks are evidence: never deleted.
CREATE FUNCTION payment_events_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'payment_events rows cannot be deleted';
END;
$$;

CREATE TRIGGER payment_events_no_delete
BEFORE DELETE ON "payment_events"
FOR EACH ROW EXECUTE FUNCTION payment_events_no_delete();
