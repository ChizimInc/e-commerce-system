-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('NEW', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "DeliveryMethod" AS ENUM ('STANDARD', 'EXPRESS', 'STORE_PICKUP');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CARD', 'PAYPAL', 'CASH_ON_DELIVERY');

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'NEW',
    "total_amount" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL,
    "delivery_method" "DeliveryMethod" NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "shipping_recipient" TEXT NOT NULL,
    "shipping_street" TEXT NOT NULL,
    "shipping_city" TEXT NOT NULL,
    "shipping_postal_code" TEXT NOT NULL,
    "shipping_country" TEXT NOT NULL,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "order_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unit_price_amount" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("order_id","item_id")
);

-- CreateIndex
CREATE INDEX "orders_customer_id_created_at_idx" ON "orders"("customer_id", "created_at");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reguli de integritate pe care Prisma nu le poate exprima in schema.
ALTER TABLE "orders" ADD CONSTRAINT "orders_total_non_negative" CHECK ("total_amount" >= 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_price_non_negative" CHECK ("unit_price_amount" >= 0);
