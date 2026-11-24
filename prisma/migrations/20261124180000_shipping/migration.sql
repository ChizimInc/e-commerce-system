-- Iteratia 5, partea 1: livrari. Costul livrarii intra in totalul comenzii; o singura livrare per comanda, banii in cenți.

-- Comenzile existente nu au avut cost de livrare: coloana porneste de la 0, deci totalurile lor raman corecte.
ALTER TABLE "orders" ADD COLUMN "shipping_amount" INTEGER NOT NULL DEFAULT 0;

-- Totalul include acum si livrarea (pentru randurile vechi, shipping_amount = 0, deci ecuatia ramane adevarata).
ALTER TABLE "orders" DROP CONSTRAINT "orders_total_matches_parts";
ALTER TABLE "orders" ADD CONSTRAINT "orders_total_matches_parts" CHECK (
    "total_amount" = "subtotal_amount" - "discount_amount" + "shipping_amount" + "vat_amount"
);
ALTER TABLE "orders" ADD CONSTRAINT "orders_shipping_non_negative" CHECK ("shipping_amount" >= 0);

-- CreateEnum
CREATE TYPE "ShipmentCourier" AS ENUM ('FAST_COURIER', 'POST_OFFICE', 'STORE_PICKUP');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('PENDING', 'CREATED', 'IN_TRANSIT', 'DELIVERED', 'RETURNED', 'FAILED');

-- CreateTable
CREATE TABLE "shipments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "courier" "ShipmentCourier" NOT NULL,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'PENDING',
    "cost_amount" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL,
    "external_id" TEXT,
    "tracking_number" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shipments_order_id_key" ON "shipments"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_courier_external_id_key" ON "shipments"("courier", "external_id");

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reguli de integritate pe care Prisma nu le poate exprima in schema.
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_cost_non_negative" CHECK ("cost_amount" >= 0);
-- Un colet pe care curierul l-a primit (creat, in tranzit, livrat, returnat) are id la curier si numar de urmarire.
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_ids_when_created" CHECK (
    "status" NOT IN ('CREATED', 'IN_TRANSIT', 'DELIVERED', 'RETURNED')
    OR ("external_id" IS NOT NULL AND "tracking_number" IS NOT NULL)
);
