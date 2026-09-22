import { describe, expect, it } from "vitest";
import {
    campaignPerformance,
    portfolioSummary,
    productPerformance,
    regionPerformance,
    revenueTrend,
} from "@/queries";

describe("portfolio query factories", () => {
    it("summarises the portfolio without filtering to a single product", () => {
        const request = portfolioSummary();

        expect(request.connection).toBe("caldovaModel");
        expect(request.query).toContain("[Total Revenue USD]");
        expect(request.query).toContain("Plan Variance Pct");
        expect(request.query).not.toContain("PROD-HS-100");
        expect(request.columnMetadata["[Revenue USD]"].name).toBe("revenueUsd");
    });

    it("excludes the model blank row from the tracked product count", () => {
        const request = portfolioSummary();

        expect(request.query).toContain("NOT ISBLANK('products'[productId])");
    });

    it("ranks every product against the baseline plan", () => {
        const request = productPerformance();

        expect(request.query).toContain("'products'[productName]");
        expect(request.query).toContain("MINX(ALL('ForecastActualDaily'[forecastVersion])");
        expect(request.query).toContain("ORDER BY [Variance Pct] DESC");
        expect(request.query).not.toContain("products'[hero]");
        expect(request.columnMetadata["[Variance Pct]"].name).toBe("variancePct");
    });

    it("reports regional variance for all markets", () => {
        const request = regionPerformance();

        expect(request.query).toContain("'regions'[regionName]");
        expect(request.query).not.toContain("signalAffected");
        expect(request.vegaLiteSpec).toHaveProperty("encoding.x.field", "variancePct");
    });

    it("trends revenue by category across the catalogue", () => {
        const request = revenueTrend();

        expect(request.query).toContain("'products'[category]");
        expect(request.columnMetadata["sales_order_lines[orderDate]"].name).toBe("orderDate");
        expect(request.vegaLiteSpec).toHaveProperty("encoding.color.field", "category");
    });

    it("reads campaign performance from telemetry rather than the mismatched master keys", () => {
        const request = campaignPerformance();

        expect(request.query).toContain("'CampaignSignals'[campaignId]");
        expect(request.query).not.toContain("'campaigns'[campaignName]");
        expect(request.columnMetadata["[Spend USD]"].name).toBe("spendUsd");
    });
});
