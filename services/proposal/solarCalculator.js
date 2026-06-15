// ─────────────────────────────────────────────────────────────────────────────
// Solar Calculator Service
// ─────────────────────────────────────────────────────────────────────────────

const SOLAR_CONSTANTS = require("./solarConstants");

// ─── AI Engine: Core Calculations ────────────────────────────────────────────
const calculateSolarSystem = (monthlyBill, existingKW = 0) => {
    // SAFE NUMBER CONVERSION
  monthlyBill = Number(monthlyBill) || 0;
  existingKW = Number(existingKW) || 0;
  const { peakSunHoursPerDay, systemEfficiency, pricePerKWh, costPerWatt,
    subsidyRateUpTo3kW, subsidyRateAbove3kW, escalationRate,
    panelWattage, co2PerUnit, degradationRate, systemLifeYears } = SOLAR_CONSTANTS;

  // Units consumed
  const monthlyUnits = monthlyBill / pricePerKWh;
  const dailyUnits = monthlyUnits / 30;

  // System size needed
  let systemKW = dailyUnits / (peakSunHoursPerDay * systemEfficiency);
  systemKW = Math.max(1, Math.round(systemKW * 2) / 2); // round to 0.5kW steps
  systemKW = Math.max(0, systemKW - existingKW);

  // Panels
  const panelCount = Math.ceil((systemKW * 1000) / panelWattage);
  const actualSystemKW = (panelCount * panelWattage) / 1000;

  // Costs
  const grossCost = actualSystemKW * 1000 * costPerWatt;
  let subsidy = 0;
  if (actualSystemKW <= 3) {
    subsidy = grossCost * subsidyRateUpTo3kW;
  } else {
    subsidy = (3 * 1000 * costPerWatt * subsidyRateUpTo3kW) +
              ((actualSystemKW - 3) * 1000 * costPerWatt * subsidyRateAbove3kW);
  }
  subsidy = Math.min(subsidy, 78000); // PM Surya Ghar cap
  const netCost = grossCost - subsidy;

  // Daily generation
  const unitsPerDay = actualSystemKW * peakSunHoursPerDay * systemEfficiency;
  const monthlyEnergySavings = unitsPerDay * 30 * pricePerKWh;
  const annualEnergySavings = monthlyEnergySavings * 12;
  const co2PerYear = (unitsPerDay * 365 * co2PerUnit) / 1000; // tonnes

  // 25-year savings with tariff escalation and degradation
  let totalSavings = 0;
  for (let y = 1; y <= systemLifeYears; y++) {
    const degradedGeneration = unitsPerDay * 365 * Math.pow(1 - degradationRate, y - 1);
    const escalatedPrice = pricePerKWh * Math.pow(1 + escalationRate, y - 1);
    totalSavings += degradedGeneration * escalatedPrice;
  }

  // Payback
  // const paybackYears = parseFloat((netCost / annualEnergySavings).toFixed(1));
  const paybackYears =
  annualEnergySavings > 0
    ? parseFloat((netCost / annualEnergySavings).toFixed(1))
    : 0;

  // IRR approximation (simple)
  // const irr = parseFloat(((annualEnergySavings / netCost) * 100).toFixed(1));
  const irr =
  netCost > 0 && Number.isFinite(annualEnergySavings)
    ? parseFloat(((annualEnergySavings / netCost) * 100).toFixed(1))
    : 0;

  // Cost breakdown
  const costBreakdown = [
    { item: `Solar Panels (${panelCount} × ${panelWattage}Wp)`, quantity: panelCount, unitCost: Math.round(panelWattage * 28), totalCost: Math.round(panelCount * panelWattage * 28) },
    { item: "String Inverter / Hybrid Inverter", quantity: 1, unitCost: Math.round(actualSystemKW * 1000 * 5.5), totalCost: Math.round(actualSystemKW * 1000 * 5.5) },
    { item: "Mounting Structure (GI/Aluminium)", quantity: 1, unitCost: Math.round(actualSystemKW * 1000 * 4), totalCost: Math.round(actualSystemKW * 1000 * 4) },
    { item: "DC/AC Cables & Junction Boxes", quantity: 1, unitCost: Math.round(actualSystemKW * 1000 * 1.5), totalCost: Math.round(actualSystemKW * 1000 * 1.5) },
    { item: "Net Meter & DISCOM Charges", quantity: 1, unitCost: 5000, totalCost: 5000 },
    { item: "Installation & Civil Work", quantity: 1, unitCost: Math.round(actualSystemKW * 1000 * 3), totalCost: Math.round(actualSystemKW * 1000 * 3) },
    { item: "Monitoring System & Wi-Fi Logger", quantity: 1, unitCost: 3500, totalCost: 3500 },
  ];

  // EMI options
  const emiOptions = [
    { tenure: 24, interestRate: 9.5 },
    { tenure: 36, interestRate: 10.0 },
    { tenure: 60, interestRate: 10.5 },
  ].map(({ tenure, interestRate }) => {
    const r = interestRate / 100 / 12;
    const emi = Math.round((netCost * r * Math.pow(1 + r, tenure)) / (Math.pow(1 + r, tenure) - 1));
    return {
      tenure,
      emi,
      interestRate,
      totalPayable: emi * tenure,
    };
  });


  console.log("==== SOLAR CALC DEBUG ====");
console.log("monthlyBill:", monthlyBill);
console.log("existingKW:", existingKW);
console.log("grossCost:", grossCost);
console.log("subsidy:", subsidy);
console.log("netCost:", netCost);
console.log("annualEnergySavings:", annualEnergySavings);
console.log("irr:", irr);
console.log("==========================");

  return {
    systemSizeKW: parseFloat(actualSystemKW.toFixed(2)),
    panelCount,
    panelWattage,
    inverterType: actualSystemKW <= 5 ? "String Inverter (On-Grid)" : "Central Inverter (On-Grid)",
    installationCost: Math.round(grossCost),
    subsidyAmount: Math.round(subsidy),
    netCost: Math.round(netCost),
    monthlyEnergySavings: Math.round(monthlyEnergySavings),
    annualEnergySavings: Math.round(annualEnergySavings),
    co2OffsetTonsPerYear: parseFloat(co2PerYear.toFixed(2)),
    unitsGeneratedPerDay: parseFloat(unitsPerDay.toFixed(1)),
    paybackYears,
    roi25Years: Math.round(totalSavings),
    irr,
    emiOptions,
    subsidyEligible: actualSystemKW <= 10,
    subsidyScheme: "PM Surya Ghar Muft Bijli Yojana",
    netMeteringAvailable: true,
    costBreakdown,
  };
};

module.exports = { calculateSolarSystem };