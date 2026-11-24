-- Iteratia 5, partea 2: notificari. Preferinte per utilizator si istoric/outbox al notificarilor simulate (fara date de contact).

-- CreateEnum
CREATE TYPE "NotificationChannelType" AS ENUM ('EMAIL', 'SMS', 'PUSH');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('ORDER_STATUS', 'PROMO');

-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "channels" "NotificationChannelType"[],
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "notifications_log" (
    "id" UUID NOT NULL,
    "seq" SERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" "NotificationChannelType" NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "order_id" UUID,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_log_seq_key" ON "notifications_log"("seq");

-- CreateIndex
CREATE INDEX "notifications_log_user_id_seq_idx" ON "notifications_log"("user_id", "seq");

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications_log" ADD CONSTRAINT "notifications_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Reguli de integritate pe care Prisma nu le poate exprima in schema.
ALTER TABLE "notifications_log" ADD CONSTRAINT "notifications_log_body_not_empty" CHECK (length("body") > 0);
