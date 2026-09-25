type Dataset = {
  clock: {productionApprovedAt: string; operatingDays: number[]};
  decisionCase: {caseId: string};
  heroProductId: string;
  products: Array<{productId: string; name: string}>;
  productionLines: Array<{lineId: string; plantId: string}>;
  capacityModel: {lineId: string; baselineUnitsPerOperatingDay: number; planUnitsPerOperatingDay: number};
};

export function staffingDatasetContext(dataset: Dataset) {
  const line = dataset.productionLines.find(candidate => candidate.lineId === dataset.capacityModel.lineId);
  const product = dataset.products.find(candidate => candidate.productId === dataset.heroProductId);
  if (!line || !product) throw new Error('The staffing line and product must exist in the shared dataset.');
  const approved = new Date(dataset.clock.productionApprovedAt);
  if (!Number.isFinite(approved.getTime())) throw new Error('The production decision date is invalid.');
  const planning = new Date(approved);
  planning.setUTCDate(1);
  planning.setUTCMonth(planning.getUTCMonth() + 4);
  const monthEnd = new Date(Date.UTC(planning.getUTCFullYear(), planning.getUTCMonth() + 1, 0)).getUTCDate();
  planning.setUTCDate(Math.min(approved.getUTCDate(), monthEnd));
  planning.setUTCHours(9, 0, 0, 0);
  const start = new Date(planning);
  start.setUTCDate(start.getUTCDate() + 3);
  start.setUTCHours(6, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 14);
  const operatingDates: string[] = [];
  for (const day = new Date(start); day < end; day.setUTCDate(day.getUTCDate() + 1)) {
    if (dataset.clock.operatingDays.includes(day.getUTCDay() || 7)) operatingDates.push(day.toISOString().slice(0, 10));
  }
  if (!operatingDates.length) throw new Error('The staffing window has no operating days.');
  return {
    sourceCaseId: dataset.decisionCase.caseId,
    sourceDecisionAt: approved.toISOString(),
    productId: product.productId, productName: product.name,
    factoryId: line.plantId, lineId: line.lineId,
    scenarioAsOf: planning.toISOString(), windowStart: start.toISOString(), windowEnd: end.toISOString(),
    operatingDates, productionDays: operatingDates.length,
    dailyOutput: dataset.capacityModel.baselineUnitsPerOperatingDay,
    machineDailyLimit: dataset.capacityModel.planUnitsPerOperatingDay,
  };
}