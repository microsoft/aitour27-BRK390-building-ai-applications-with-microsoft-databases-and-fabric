import type { VisualizationSpec } from "@microsoft/fabric-visuals";
import type { ColumnMetadataMap } from "@/lib/to-data-table";
import portfolioSummaryQuery from "./portfolio-summary.dax?raw";
import productPerformanceQuery from "./product-performance.dax?raw";
import regionPerformanceQuery from "./region-performance.dax?raw";
import revenueTrendQuery from "./revenue-trend.dax?raw";
import campaignPerformanceQuery from "./campaign-performance.dax?raw";
import regionPerformanceSpec from "./region-performance.json";
import revenueTrendSpec from "./revenue-trend.json";

/** Connection alias registered in `fabric.yaml`. */
const connection = "caldovaModel";

export const portfolioSummaryColumns: ColumnMetadataMap = {
    "[Revenue USD]": { name: "revenueUsd", displayName: "Revenue", format: "$#,##0" },
    "[Units]": { name: "units", displayName: "Units", format: "#,##0" },
    "[Plan Variance Pct]": {
        name: "planVariancePct",
        displayName: "Vs plan",
        format: '0.0"%"',
    },
    "[Products Tracked]": {
        name: "productsTracked",
        displayName: "Products",
        format: "#,##0",
    },
    "[Active Campaigns]": {
        name: "activeCampaigns",
        displayName: "Active campaigns",
        format: "#,##0",
    },
    "[Campaign Spend USD]": {
        name: "campaignSpendUsd",
        displayName: "Campaign spend",
        format: "$#,##0",
    },
    "[Campaign Revenue USD]": {
        name: "campaignRevenueUsd",
        displayName: "Attributed revenue",
        format: "$#,##0",
    },
};

export const productPerformanceColumns: ColumnMetadataMap = {
    "products[productName]": { name: "productName", displayName: "Product" },
    "products[category]": { name: "category", displayName: "Category" },
    "[Actual Units]": { name: "actualUnits", displayName: "Actual units", format: "#,##0" },
    "[Plan Units]": { name: "planUnits", displayName: "Plan units", format: "#,##0" },
    "[Variance Pct]": {
        name: "variancePct",
        displayName: "Vs plan",
        format: '0.00"%"',
    },
};

export const regionPerformanceColumns: ColumnMetadataMap = {
    "regions[regionName]": { name: "regionName", displayName: "Region" },
    "[Actual Units]": { name: "actualUnits", displayName: "Actual units", format: "#,##0" },
    "[Plan Units]": { name: "planUnits", displayName: "Plan units", format: "#,##0" },
    "[Variance Pct]": {
        name: "variancePct",
        displayName: "Vs plan",
        format: '0.00"%"',
    },
};

export const revenueTrendColumns: ColumnMetadataMap = {
    "sales_order_lines[orderDate]": { name: "orderDate", displayName: "Date" },
    "products[category]": { name: "category", displayName: "Category" },
    "[Revenue USD]": { name: "revenueUsd", displayName: "Revenue", format: "$#,##0" },
    "[Units]": { name: "units", displayName: "Units", format: "#,##0" },
};

export const campaignPerformanceColumns: ColumnMetadataMap = {
    "CampaignSignals[campaignId]": { name: "campaignId", displayName: "Campaign" },
    "CampaignSignals[regionId]": { name: "regionId", displayName: "Region" },
    "[Spend USD]": { name: "spendUsd", displayName: "Spend", format: "$#,##0" },
    "[Attributed Units]": {
        name: "attributedUnits",
        displayName: "Attributed units",
        format: "#,##0",
    },
    "[Attributed Revenue USD]": {
        name: "attributedRevenueUsd",
        displayName: "Attributed revenue",
        format: "$#,##0",
    },
    "[Margin Pct]": { name: "marginPct", displayName: "Margin", format: '0.0"%"' },
};

export function portfolioSummary() {
    return {
        connection,
        query: portfolioSummaryQuery,
        columnMetadata: portfolioSummaryColumns,
    };
}

export function productPerformance() {
    return {
        connection,
        query: productPerformanceQuery,
        columnMetadata: productPerformanceColumns,
    };
}

export function regionPerformance() {
    return {
        connection,
        query: regionPerformanceQuery,
        columnMetadata: regionPerformanceColumns,
        vegaLiteSpec: regionPerformanceSpec as VisualizationSpec,
    };
}

export function revenueTrend() {
    return {
        connection,
        query: revenueTrendQuery,
        columnMetadata: revenueTrendColumns,
        vegaLiteSpec: revenueTrendSpec as VisualizationSpec,
    };
}

export function campaignPerformance() {
    return {
        connection,
        query: campaignPerformanceQuery,
        columnMetadata: campaignPerformanceColumns,
    };
}
