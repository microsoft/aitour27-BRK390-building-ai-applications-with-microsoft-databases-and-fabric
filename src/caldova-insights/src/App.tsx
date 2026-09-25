import { useMemo } from "react";
import { Moon, Sun } from "lucide-react";
import { DataGrid, type GridColumnDef } from "@microsoft/fabric-datagrid";
import type { QueryTable } from "@microsoft/fabric-app-data";
import { useCssTheme, VegaVisual } from "@microsoft/fabric-visuals";
import {
    campaignPerformance,
    portfolioSummary,
    productPerformance,
    regionPerformance,
    revenueTrend,
} from "@/queries";
import { AssistantPanel } from "@/components/assistant-panel";
import { CaldovaLogo } from "@/components/caldova-logo";
import {
    EmptyState,
    ErrorState,
    LoadingState,
    Panel,
    PanelHeader,
    StatCard,
    StatusBadge,
    VarianceValue,
} from "@/components/panel";
import { useSemanticModelQuery } from "@/hooks/use-semantic-model-query";
import { useThemeContext } from "@/hooks/theme.context";
import { toDataTable } from "@/lib/to-data-table";

const summaryRequest = portfolioSummary();
const productRequest = productPerformance();
const regionRequest = regionPerformance();
const trendRequest = revenueTrend();
const campaignRequest = campaignPerformance();

/** Variance below this magnitude is treated as tracking to plan, not a signal. */
const MATERIAL_VARIANCE_PCT = 0.5;

function readCell(table: QueryTable | undefined, columnName: string): unknown {
    if (!table) return undefined;
    const index = table.columns.findIndex((column) => column.name === columnName);
    return index < 0 ? undefined : table.rows[0]?.[index];
}

function asNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function compact(value: number | undefined): string {
    return value == null
        ? "—"
        : new Intl.NumberFormat("en-US", {
              notation: "compact",
              maximumFractionDigits: 1,
          }).format(value);
}

function currency(value: number | undefined, compactForm = true): string {
    return value == null
        ? "—"
        : new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: "USD",
              notation: compactForm ? "compact" : "standard",
              maximumFractionDigits: compactForm ? 1 : 0,
          }).format(value);
}

function titleCase(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

/** `CMP-2027-COASTAL-FIELD` reads as `Coastal Field` in the campaign table. */
function formatCampaign(value: unknown): string {
    if (typeof value !== "string") return "—";
    return value
        .replace(/^CMP-\d{4}-/, "")
        .split("-")
        .map(titleCase)
        .join(" ");
}

function formatRegionCode(value: unknown): string {
    if (typeof value !== "string") return "—";
    return titleCase(value.replace(/^REG-/, ""));
}

function queryError(
    data: ReturnType<typeof useSemanticModelQuery>["data"],
    error: Error | undefined,
): string | undefined {
    if (error) return error.message;
    return data?.status === "error" ? data.error.message : undefined;
}

function varianceTone(value: number | undefined) {
    if (value == null || Math.abs(value) < MATERIAL_VARIANCE_PCT) return "neutral" as const;
    return value > 0 ? ("positive" as const) : ("negative" as const);
}

function varianceLabel(value: number | undefined): string {
    const tone = varianceTone(value);
    if (tone === "neutral") return "On plan";
    return tone === "positive" ? "Above plan" : "Below plan";
}

function App() {
    const theme = useCssTheme();
    const { isDark, toggleTheme } = useThemeContext();

    const summary = useSemanticModelQuery(summaryRequest);
    const products = useSemanticModelQuery(productRequest);
    const regions = useSemanticModelQuery(regionRequest);
    const trend = useSemanticModelQuery(trendRequest);
    const campaigns = useSemanticModelQuery(campaignRequest);

    const summaryTable = summary.data?.status === "success" ? summary.data.table : undefined;

    const productTable =
        products.data?.status === "success"
            ? toDataTable(products.data.table, productRequest.columnMetadata)
            : undefined;
    const regionTable =
        regions.data?.status === "success"
            ? toDataTable(regions.data.table, regionRequest.columnMetadata)
            : undefined;
    const trendTable =
        trend.data?.status === "success"
            ? toDataTable(trend.data.table, trendRequest.columnMetadata)
            : undefined;
    const campaignTable =
        campaigns.data?.status === "success"
            ? toDataTable(campaigns.data.table, campaignRequest.columnMetadata)
            : undefined;

    const planVariance = asNumber(readCell(summaryTable, "[Plan Variance Pct]"));
    const spend = asNumber(readCell(summaryTable, "[Campaign Spend USD]"));
    const attributed = asNumber(readCell(summaryTable, "[Campaign Revenue USD]"));

    /** Latest order date in the trend, used as the reporting watermark. */
    const asOf = useMemo(() => {
        if (!trendTable || trendTable.rows.length === 0) return undefined;
        const dateIndex = trendTable.columns.findIndex(
            (column) => column.name === "orderDate",
        );
        if (dateIndex < 0) return undefined;

        let latest = 0;
        for (const row of trendTable.rows) {
            const raw = row[dateIndex];
            const time = new Date(String(raw)).getTime();
            if (Number.isFinite(time) && time > latest) latest = time;
        }
        return latest > 0 ? new Date(latest) : undefined;
    }, [trendTable]);

    /** Largest absolute variance drives the width of the inline variance bars. */
    const maxVariance = useMemo(() => {
        if (!productTable) return 1;
        const index = productTable.columns.findIndex(
            (column) => column.name === "variancePct",
        );
        if (index < 0) return 1;
        return Math.max(
            1,
            ...productTable.rows.map((row) => Math.abs(Number(row[index]) || 0)),
        );
    }, [productTable]);

    const productColumns: GridColumnDef[] = useMemo(
        () => [
            // Sized with `width`, not `minWidth`: the grid applies minWidth to
            // header cells only, so a minWidth-sized column drifts out of step
            // with its body cells. See AGENTS.md.
            { id: "productName", header: "Product", sortable: true, width: 190 },
            { id: "category", header: "Category", sortable: true },
            {
                id: "actualUnits",
                header: "Actual units",
                sortable: true,
                numericStyling: true,
                cellRenderer: (value) => (
                    <span className="tabular">{compact(asNumber(value))}</span>
                ),
            },
            {
                id: "planUnits",
                header: "Plan units",
                sortable: true,
                numericStyling: true,
                cellRenderer: (value) => (
                    <span className="tabular text-muted-foreground">
                        {compact(asNumber(value))}
                    </span>
                ),
            },
            {
                id: "variancePct",
                header: "Vs plan",
                sortable: true,
                numericStyling: true,
                width: 190,
                cellRenderer: (value) => {
                    const numeric = asNumber(value);
                    const width =
                        numeric == null
                            ? 0
                            : Math.min(100, (Math.abs(numeric) / maxVariance) * 100);
                    const tone = varianceTone(numeric);
                    return (
                        <div className="flex items-center justify-end gap-200">
                            <span
                                aria-hidden="true"
                                className="h-100 w-[64px] overflow-hidden rounded-full bg-muted"
                            >
                                <span
                                    className={
                                        tone === "positive"
                                            ? "block h-full rounded-full bg-success"
                                            : tone === "negative"
                                              ? "block h-full rounded-full bg-destructive"
                                              : "block h-full rounded-full bg-neutral"
                                    }
                                    style={{ width: `${width}%` }}
                                />
                            </span>
                            <VarianceValue value={numeric} threshold={MATERIAL_VARIANCE_PCT} />
                        </div>
                    );
                },
            },
            {
                id: "status",
                header: "Status",
                sortable: false,
                width: 120,
                cellRenderer: (_value, row) => {
                    const numeric = asNumber(row.variancePct);
                    return (
                        <StatusBadge label={varianceLabel(numeric)} tone={varianceTone(numeric)} />
                    );
                },
            },
        ],
        [maxVariance],
    );

    const campaignColumns: GridColumnDef[] = useMemo(
        () => [
            {
                id: "campaignId",
                header: "Campaign",
                sortable: true,
                width: 130,
                cellRenderer: (value) => formatCampaign(value),
            },
            {
                id: "regionId",
                header: "Region",
                sortable: true,
                cellRenderer: (value) => formatRegionCode(value),
            },
            {
                id: "spendUsd",
                header: "Spend",
                sortable: true,
                numericStyling: true,
                cellRenderer: (value) => (
                    <span className="tabular">{currency(asNumber(value))}</span>
                ),
            },
            {
                id: "attributedUnits",
                header: "Units",
                sortable: true,
                numericStyling: true,
                cellRenderer: (value) => (
                    <span className="tabular">{compact(asNumber(value))}</span>
                ),
            },
            {
                id: "attributedRevenueUsd",
                header: "Revenue",
                sortable: true,
                numericStyling: true,
                cellRenderer: (value) => (
                    <span className="tabular">{currency(asNumber(value))}</span>
                ),
            },
            {
                id: "marginPct",
                header: "Margin",
                sortable: true,
                numericStyling: true,
                cellRenderer: (value) => {
                    const numeric = asNumber(value);
                    return (
                        <span className="tabular">
                            {numeric == null ? "—" : `${numeric.toFixed(1)}%`}
                        </span>
                    );
                },
            },
        ],
        [],
    );

    const summaryError = queryError(summary.data, summary.error);

    return (
        <div className="min-h-full">
            <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
                <div className="mx-auto flex max-w-shell items-center justify-between gap-400 px-500 py-300">
                    <div className="flex items-center gap-400">
                        <CaldovaLogo className="block h-[22px] w-auto text-primary [&>svg]:h-full [&>svg]:w-auto" />
                        <span className="hidden h-600 w-px bg-border sm:block" />
                        <span className="hidden font-heading text-300 font-medium text-muted-foreground sm:block">
                            Commercial Operations
                        </span>
                    </div>

                    <div className="flex items-center gap-300">
                        {asOf ? (
                            <span className="hidden font-monospace text-200 text-muted-foreground md:block">
                                Data as of{" "}
                                {asOf.toLocaleDateString(undefined, {
                                    day: "2-digit",
                                    month: "short",
                                    year: "numeric",
                                })}
                            </span>
                        ) : null}
                        <button
                            type="button"
                            onClick={toggleTheme}
                            aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
                            className="flex h-700 w-700 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            {isDark ? (
                                <Sun className="icon-size-200" aria-hidden="true" />
                            ) : (
                                <Moon className="icon-size-200" aria-hidden="true" />
                            )}
                        </button>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-shell px-500 py-600">
                <div className="mb-500 flex flex-wrap items-baseline gap-x-300 gap-y-100">
                    <h1 className="font-heading text-hero-800 font-semibold tracking-[-0.02em] text-foreground">
                        Portfolio performance
                    </h1>
                    <p className="text-200 leading-300 text-muted-foreground">
                        Baseline plan, rolling 60 days
                    </p>
                </div>

                {summaryError ? (
                    <ErrorState message={summaryError} />
                ) : (
                    <section className="mb-600 grid gap-300 sm:grid-cols-2 xl:grid-cols-5">
                        {summary.isLoading || !summaryTable ? (
                            <div className="sm:col-span-2 xl:col-span-5">
                                <Panel>
                                    <LoadingState label="Loading portfolio metrics…" />
                                </Panel>
                            </div>
                        ) : (
                            <>
                                <StatCard
                                    label="Revenue"
                                    value={currency(asNumber(readCell(summaryTable, "[Revenue USD]")))}
                                    caption="Year to date"
                                />
                                <StatCard
                                    label="Units sold"
                                    value={compact(asNumber(readCell(summaryTable, "[Units]")))}
                                    caption="Year to date"
                                />
                                <StatCard
                                    label="Vs plan"
                                    value={
                                        planVariance == null
                                            ? "—"
                                            : `${planVariance > 0 ? "+" : ""}${planVariance.toFixed(2)}%`
                                    }
                                    caption="Portfolio, rolling 60 days"
                                    tone={
                                        planVariance == null ||
                                        Math.abs(planVariance) < MATERIAL_VARIANCE_PCT
                                            ? "default"
                                            : planVariance > 0
                                              ? "positive"
                                              : "negative"
                                    }
                                />
                                <StatCard
                                    label="Active campaigns"
                                    value={
                                        compact(
                                            asNumber(readCell(summaryTable, "[Active Campaigns]")),
                                        ) ?? "—"
                                    }
                                    caption={`${compact(asNumber(readCell(summaryTable, "[Products Tracked]")))} products tracked`}
                                />
                                <StatCard
                                    label="Campaign spend"
                                    value={currency(spend)}
                                    caption={
                                        spend && attributed
                                            ? `${(attributed / spend).toFixed(2)}x attributed return`
                                            : "Delivery telemetry"
                                    }
                                />
                            </>
                        )}
                    </section>
                )}

                <div className="grid gap-500 xl:grid-cols-12">
                    <div className="flex flex-col gap-500 xl:col-span-8">
                        <Panel>
                            <PanelHeader
                                title="Revenue by category"
                                detail="Daily net revenue across the catalogue"
                            />
                            <div className="h-trend px-400 py-400">
                                {queryError(trend.data, trend.error) ? (
                                    <ErrorState message={queryError(trend.data, trend.error)!} />
                                ) : trend.isLoading || !trendTable ? (
                                    <LoadingState label="Loading revenue trend…" />
                                ) : trendTable.rows.length === 0 ? (
                                    <EmptyState label="No revenue rows available." />
                                ) : (
                                    <VegaVisual
                                        spec={trendRequest.vegaLiteSpec}
                                        data={trendTable}
                                        theme={theme}
                                    />
                                )}
                            </div>
                        </Panel>

                        <Panel>
                            <PanelHeader
                                title="Performance against plan"
                                detail="Every tracked product, ranked by variance to the baseline demand plan"
                            />
                            <div className="min-h-40">
                                {queryError(products.data, products.error) ? (
                                    <ErrorState
                                        message={queryError(products.data, products.error)!}
                                    />
                                ) : products.isLoading || !productTable ? (
                                    <LoadingState label="Loading product performance…" />
                                ) : productTable.rows.length === 0 ? (
                                    <EmptyState label="No product rows available." />
                                ) : (
                                    <DataGrid
                                        data={productTable}
                                        columns={productColumns}
                                        theme={theme}
                                        rowHeight={48}
                                        capabilities={{ pagination: false }}
                                    />
                                )}
                            </div>
                        </Panel>

                        <div className="grid gap-500 lg:grid-cols-12">
                            <Panel className="lg:col-span-5">
                                <PanelHeader
                                    title="Regional variance"
                                    detail="Actual versus plan by market"
                                />
                                <div className="h-panel px-400 py-400">
                                    {queryError(regions.data, regions.error) ? (
                                        <ErrorState
                                            message={queryError(regions.data, regions.error)!}
                                        />
                                    ) : regions.isLoading || !regionTable ? (
                                        <LoadingState label="Loading regions…" />
                                    ) : regionTable.rows.length === 0 ? (
                                        <EmptyState label="No regional rows available." />
                                    ) : (
                                        <VegaVisual
                                            spec={regionRequest.vegaLiteSpec}
                                            data={regionTable}
                                            theme={theme}
                                        />
                                    )}
                                </div>
                            </Panel>

                            <Panel className="lg:col-span-7">
                                <PanelHeader
                                    title="Campaign delivery"
                                    detail="Spend and attributed return from campaign telemetry"
                                />
                                <div className="min-h-40 overflow-x-auto">
                                    {queryError(campaigns.data, campaigns.error) ? (
                                        <ErrorState
                                            message={queryError(campaigns.data, campaigns.error)!}
                                        />
                                    ) : campaigns.isLoading || !campaignTable ? (
                                        <LoadingState label="Loading campaigns…" />
                                    ) : campaignTable.rows.length === 0 ? (
                                        <EmptyState label="No campaign rows available." />
                                    ) : (
                                        <DataGrid
                                            data={campaignTable}
                                            columns={campaignColumns}
                                            theme={theme}
                                            rowHeight={44}
                                            capabilities={{ pagination: false }}
                                        />
                                    )}
                                </div>
                            </Panel>
                        </div>
                    </div>

                    <div className="xl:col-span-4">
                        <div className="xl:sticky xl:top-[72px]">
                            <AssistantPanel />
                        </div>
                    </div>
                </div>

                <footer className="mt-700 border-t border-border pt-400 text-200 text-muted-foreground">
                    Caldova Commercial Operations · Connected to Microsoft Fabric
                </footer>
            </main>
        </div>
    );
}

export default App;
