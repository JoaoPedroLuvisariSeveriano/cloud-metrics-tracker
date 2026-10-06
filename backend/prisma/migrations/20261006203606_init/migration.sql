-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'VIEWER');

-- CreateEnum
CREATE TYPE "ServiceStatus" AS ENUM ('ACTIVE', 'UNAVAILABLE', 'STALE');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "external_id" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "status" "ServiceStatus" NOT NULL DEFAULT 'ACTIVE',
    "region_code" VARCHAR(100),
    "country" VARCHAR(100),
    "region" VARCHAR(100),
    "city" VARCHAR(100),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "last_seen_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_snapshots" (
    "id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "collected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cpu_percent" DECIMAL(6,3),
    "memory_gb" DECIMAL(12,4),
    "disk_gb" DECIMAL(12,4),
    "network_gb" DECIMAL(12,4),
    "collection_interval_seconds" INTEGER,
    "energy_kwh" DECIMAL(18,9),
    "co2e_grams" DECIMAL(18,6),
    "carbon_intensity_gco2" DECIMAL(10,4),
    "raw_payload" JSONB,
    "is_stale" BOOLEAN NOT NULL DEFAULT false,
    "error_message" TEXT,

    CONSTRAINT "metric_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carbon_intensities" (
    "id" UUID NOT NULL,
    "region_code" VARCHAR(100) NOT NULL,
    "country" VARCHAR(100),
    "intensity_gco2" DECIMAL(10,4) NOT NULL,
    "renewable_share_percent" DECIMAL(5,2),
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "carbon_intensities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "services_external_id_key" ON "services"("external_id");

-- CreateIndex
CREATE INDEX "services_status_idx" ON "services"("status");

-- CreateIndex
CREATE INDEX "services_external_id_idx" ON "services"("external_id");

-- CreateIndex
CREATE INDEX "idx_snapshots_service_time" ON "metric_snapshots"("service_id", "collected_at" DESC);

-- CreateIndex
CREATE INDEX "idx_snapshots_time" ON "metric_snapshots"("collected_at" DESC);

-- CreateIndex
CREATE INDEX "idx_snapshots_stale" ON "metric_snapshots"("is_stale");

-- CreateIndex
CREATE INDEX "idx_carbon_region_time" ON "carbon_intensities"("region_code", "recorded_at" DESC);

-- AddForeignKey
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
