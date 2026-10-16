-- CreateEnum
CREATE TYPE "PermissionScope" AS ENUM ('SHOP', 'PLATFORM');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "permissions" (
    "code" VARCHAR(64) NOT NULL,
    "module" VARCHAR(32) NOT NULL,
    "scope" "PermissionScope" NOT NULL,
    "delegable" BOOLEAN NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "name" CITEXT NOT NULL,
    "template_key" VARCHAR(32),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "shop_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_code" VARCHAR(64) NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_code")
);

-- CreateTable
CREATE TABLE "membership_roles" (
    "shop_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_roles_pkey" PRIMARY KEY ("membership_id","role_id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invited_by_membership_id" UUID,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "accepted_user_id" UUID,
    "revoked_at" TIMESTAMPTZ(3),
    "resend_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation_roles" (
    "shop_id" UUID NOT NULL,
    "invitation_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,

    CONSTRAINT "invitation_roles_pkey" PRIMARY KEY ("invitation_id","role_id")
);

-- CreateTable
CREATE TABLE "outbox_messages" (
    "id" UUID NOT NULL,
    "shop_id" UUID,
    "type" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMPTZ(3),
    "last_error" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_shop_id_name_key" ON "roles"("shop_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "roles_shop_id_id_key" ON "roles"("shop_id", "id");

-- CreateIndex
CREATE INDEX "role_permissions_shop_id_idx" ON "role_permissions"("shop_id");

-- CreateIndex
CREATE INDEX "membership_roles_shop_id_role_id_idx" ON "membership_roles"("shop_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_shop_id_status_idx" ON "invitations"("shop_id", "status");

-- CreateIndex
CREATE INDEX "invitations_shop_id_email_idx" ON "invitations"("shop_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_shop_id_id_key" ON "invitations"("shop_id", "id");

-- CreateIndex
CREATE INDEX "invitation_roles_shop_id_role_id_idx" ON "invitation_roles"("shop_id", "role_id");

-- CreateIndex
CREATE INDEX "outbox_messages_status_available_at_idx" ON "outbox_messages"("status", "available_at");

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_shop_id_role_id_fkey" FOREIGN KEY ("shop_id", "role_id") REFERENCES "roles"("shop_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_code_fkey" FOREIGN KEY ("permission_code") REFERENCES "permissions"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_shop_id_membership_id_fkey" FOREIGN KEY ("shop_id", "membership_id") REFERENCES "shop_memberships"("shop_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_shop_id_role_id_fkey" FOREIGN KEY ("shop_id", "role_id") REFERENCES "roles"("shop_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_membership_id_fkey" FOREIGN KEY ("invited_by_membership_id") REFERENCES "shop_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation_roles" ADD CONSTRAINT "invitation_roles_shop_id_invitation_id_fkey" FOREIGN KEY ("shop_id", "invitation_id") REFERENCES "invitations"("shop_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation_roles" ADD CONSTRAINT "invitation_roles_shop_id_role_id_fkey" FOREIGN KEY ("shop_id", "role_id") REFERENCES "roles"("shop_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Permission catalog (packages/shared/src/permissions.ts). The integration
-- test permissions.int-spec.ts keeps this table equal to the code.
INSERT INTO "permissions" ("code", "module", "scope", "delegable") VALUES
  ('dashboard.read', 'dashboard', 'SHOP', true),
  ('products.read', 'products', 'SHOP', true),
  ('products.create', 'products', 'SHOP', true),
  ('products.update', 'products', 'SHOP', true),
  ('products.archive', 'products', 'SHOP', true),
  ('products.prices.update', 'products', 'SHOP', true),
  ('inventory.read', 'inventory', 'SHOP', true),
  ('inventory.adjust', 'inventory', 'SHOP', true),
  ('inventory.opening', 'inventory', 'SHOP', true),
  ('suppliers.read', 'purchases', 'SHOP', true),
  ('suppliers.manage', 'purchases', 'SHOP', true),
  ('purchases.read', 'purchases', 'SHOP', true),
  ('purchases.create', 'purchases', 'SHOP', true),
  ('purchases.receive', 'purchases', 'SHOP', true),
  ('purchases.cancel', 'purchases', 'SHOP', true),
  ('supplier_payments.create', 'purchases', 'SHOP', true),
  ('sales.read', 'sales', 'SHOP', true),
  ('sales.read_all', 'sales', 'SHOP', true),
  ('sales.create', 'sales', 'SHOP', true),
  ('sales.discount', 'sales', 'SHOP', true),
  ('sales.credit', 'sales', 'SHOP', true),
  ('sales.refund', 'sales', 'SHOP', true),
  ('sales.void', 'sales', 'SHOP', true),
  ('customers.read', 'customers', 'SHOP', true),
  ('customers.manage', 'customers', 'SHOP', true),
  ('customers.credit.manage', 'customers', 'SHOP', true),
  ('expenses.read', 'expenses', 'SHOP', true),
  ('expenses.create', 'expenses', 'SHOP', true),
  ('expenses.void', 'expenses', 'SHOP', true),
  ('cash_sessions.open', 'cash', 'SHOP', true),
  ('cash_sessions.close', 'cash', 'SHOP', true),
  ('cash_sessions.review', 'cash', 'SHOP', true),
  ('reports.read', 'reports', 'SHOP', true),
  ('reports.profit.read', 'reports', 'SHOP', true),
  ('reports.export', 'reports', 'SHOP', true),
  ('users.read', 'team', 'SHOP', true),
  ('users.invite', 'team', 'SHOP', true),
  ('users.manage', 'team', 'SHOP', true),
  ('roles.manage', 'team', 'SHOP', true),
  ('audit.read', 'team', 'SHOP', true),
  ('subscription.read', 'settings', 'SHOP', true),
  ('subscription.manage', 'settings', 'SHOP', true),
  ('settings.manage', 'settings', 'SHOP', true),
  ('devices.manage', 'settings', 'SHOP', true),
  ('platform.shops.manage', 'platform', 'PLATFORM', false),
  ('platform.plans.manage', 'platform', 'PLATFORM', false),
  ('platform.payments.reconcile', 'platform', 'PLATFORM', false),
  ('platform.support.access', 'platform', 'PLATFORM', false);

-- A shop role may only hold delegable SHOP permissions, whatever the code
-- path that writes it (security model section 5).
CREATE FUNCTION role_permissions_shop_scope_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM permissions
    WHERE code = NEW.permission_code AND scope = 'SHOP' AND delegable
  ) THEN
    RAISE EXCEPTION 'permission % cannot be granted to a shop role', NEW.permission_code;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER role_permissions_shop_scope_only
BEFORE INSERT OR UPDATE ON "role_permissions"
FOR EACH ROW EXECUTE FUNCTION role_permissions_shop_scope_only();
