-- Iteratia 3 partea B: comanda pastreaza rezultatul calculului de pret (subtotal, reducere, TVA, total)
-- si exista o evidenta a comenzilor al caror stoc a fost repus dupa anulare (repunere idempotenta).

-- Comenzile existente nu aveau reduceri sau TVA: subtotalul lor este totalul, iar reducerea si TVA sunt 0.
ALTER TABLE "orders" ADD COLUMN "subtotal_amount" INTEGER;
ALTER TABLE "orders" ADD COLUMN "discount_amount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN "vat_amount" INTEGER NOT NULL DEFAULT 0;
UPDATE "orders" SET "subtotal_amount" = "total_amount";
ALTER TABLE "orders" ALTER COLUMN "subtotal_amount" SET NOT NULL;
ALTER TABLE "orders" ALTER COLUMN "discount_amount" DROP DEFAULT;
ALTER TABLE "orders" ALTER COLUMN "vat_amount" DROP DEFAULT;

-- Reguli de integritate pe care Prisma nu le poate exprima in schema.
ALTER TABLE "orders" ADD CONSTRAINT "orders_price_parts_valid" CHECK (
    "subtotal_amount" >= 0 AND "discount_amount" >= 0 AND "vat_amount" >= 0
    AND "discount_amount" <= "subtotal_amount"
);
ALTER TABLE "orders" ADD CONSTRAINT "orders_total_matches_parts" CHECK (
    "total_amount" = "subtotal_amount" - "discount_amount" + "vat_amount"
);

-- CreateTable
CREATE TABLE "order_stock_restorations" (
    "order_id" UUID NOT NULL,
    "restored_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_stock_restorations_pkey" PRIMARY KEY ("order_id")
);

-- AddForeignKey
ALTER TABLE "order_stock_restorations" ADD CONSTRAINT "order_stock_restorations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
