-- Iteratia 4: plati. O singura plata per comanda (order_id UNIQUE), cheie de idempotenta unica, banii in cenți.

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE', 'PAYPAL', 'COD');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'CAPTURED', 'REFUNDING', 'REFUNDED', 'DECLINED', 'FAILED');

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL,
    "external_id" TEXT,
    "refund_external_id" TEXT,
    "failure_reason" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_order_id_key" ON "payments"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_external_id_key" ON "payments"("provider", "external_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reguli de integritate pe care Prisma nu le poate exprima in schema.
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0);
-- O plata pe care furnizorul a primit-o (autorizata, incasata, in rambursare, rambursata) are id-ul tranzactiei lui.
ALTER TABLE "payments" ADD CONSTRAINT "payments_external_id_when_authorized" CHECK (
    "status" NOT IN ('AUTHORIZED', 'CAPTURED', 'REFUNDING', 'REFUNDED') OR "external_id" IS NOT NULL
);
ALTER TABLE "payments" ADD CONSTRAINT "payments_refund_id_when_refunded" CHECK (
    "status" <> 'REFUNDED' OR "refund_external_id" IS NOT NULL
);
