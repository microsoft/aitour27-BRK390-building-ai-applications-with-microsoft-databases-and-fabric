/**
 * Preview-only stand-in for the Fabric-backed query hook. Fixtures mirror the
 * column names and magnitudes returned by the live semantic model so the layout
 * can be reviewed without the Fabric embed handshake.
 */
interface QueryColumn {
    name: string;
}

interface QueryTable {
    columns: QueryColumn[];
    rows: unknown[][];
}

function table(columns: string[], rows: unknown[][]): QueryTable {
    return { columns: columns.map((name) => ({ name })), rows };
}

const summary = table(
    [
        "[Revenue USD]",
        "[Units]",
        "[Plan Variance Pct]",
        "[Products Tracked]",
        "[Active Campaigns]",
        "[Campaign Spend USD]",
        "[Campaign Revenue USD]",
    ],
    [[41932053, 5645222, 4.173891995887569, 6, 6, 3950000, 800000]],
);

const products = table(
    [
        "products[productName]",
        "products[category]",
        "[Actual Units]",
        "[Plan Units]",
        "[Variance Pct]",
    ],
    [
        ["Hydration Sunscreen", "Sun Care", 690829, 620468, 11.339988524790964],
        ["Hydration Sunscreen Kids", "Sun Care", 220805, 220741, 0.028993254538123868],
        ["Daily Moisturiser", "Skin Health", 156713, 156680, 0.02106203727342354],
        ["Vitamin D Supplement", "Supplements", 70095, 70081, 0.01997688389149698],
        ["After Sun Recovery Gel", "Sun Care", 291384, 291430, -0.01578423635178259],
        ["Lip Care Balm", "Sun Care", 326151, 326221, -0.021457846061412354],
    ],
);

const regions = table(
    ["regions[regionName]", "[Actual Units]", "[Plan Units]", "[Variance Pct]"],
    [
        ["Coastal Region", 407307, 381040, 6.893501994541255],
        ["Southern Region", 334904, 315401, 6.183556805463521],
        ["Island Region", 205768, 194945, 5.551822308856344],
        ["Delta Region", 291688, 277968, 4.935819950497899],
        ["Northern Region", 268913, 268815, 0.03645629894165132],
        ["Central Region", 247397, 247452, -0.022226532822527196],
    ],
);

const campaigns = table(
    [
        "CampaignSignals[campaignId]",
        "CampaignSignals[regionId]",
        "[Spend USD]",
        "[Attributed Units]",
        "[Attributed Revenue USD]",
        "[Margin Pct]",
    ],
    [
        ["CMP-2027-COASTAL-FIELD", "REG-COASTAL", 968000, 38000, 304000, 49.5],
        ["CMP-2027-SOUTH-DIGITAL", "REG-SOUTH", 809000, 27000, 216000, 50.34],
        ["CMP-2027-DELTA-DIGITAL", "REG-DELTA", 646000, 20000, 160000, 51.2],
        ["CMP-2027-ISLAND-PARTNER", "REG-ISLAND", 447000, 15000, 120000, 52.05],
        ["CMP-2027-CENTRAL-PARTNER", "REG-CENTRAL", 500000, 0, 0, null],
        ["CMP-2027-NORTH-DIGITAL", "REG-NORTH", 580000, 0, 0, null],
    ],
);

function buildTrend(): QueryTable {
    const rows: unknown[][] = [];
    const start = new Date("2027-01-04T00:00:00");
    const categories: Array<[string, number, number]> = [
        ["Sun Care", 150000, 40000],
        ["Skin Health", 17000, 2000],
        ["Supplements", 18500, 1800],
    ];

    for (let day = 0; day < 215; day += 1) {
        const date = new Date(start.getTime() + day * 86_400_000);
        const season = Math.sin((day / 215) * Math.PI);
        for (const [category, base, swing] of categories) {
            const revenue = base + swing * season + (day % 7) * 220;
            rows.push([
                date.toISOString(),
                category,
                Math.round(revenue),
                Math.round(revenue / 7),
            ]);
        }
    }

    return table(
        [
            "sales_order_lines[orderDate]",
            "products[category]",
            "[Revenue USD]",
            "[Units]",
        ],
        rows,
    );
}

const trend = buildTrend();

function resolve(query: string): QueryTable {
    if (query.includes("Plan Variance Pct")) return summary;
    if (query.includes("'products'[productName]")) return products;
    if (query.includes("'regions'[regionName]")) return regions;
    if (query.includes("CampaignSignals")) return campaigns;
    return trend;
}

export function useSemanticModelQuery(options: { connection: string; query: string }) {
    return {
        data: {
            status: "success" as const,
            table: resolve(options.query),
            fromCache: false,
            cachedAt: undefined,
        },
        isLoading: false,
        error: undefined,
        refetch: async () => {},
    };
}

export function clearQueryCache(): void {}
