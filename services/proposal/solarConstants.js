// ─────────────────────────────────────────────────────────────────────────────
// Solar Constants
// ─────────────────────────────────────────────────────────────────────────────

const SOLAR_CONSTANTS = {
  peakSunHoursPerDay: 5.5,          // India average
  systemEfficiency: 0.8,             // 80% after losses
  pricePerKWh: 8,                    // ₹8 per unit (adjust per DISCOM)
  costPerWatt: 42,                   // ₹42/Wp installed
  subsidyRateUpTo3kW: 0.30,         // 30% PM Surya Ghar subsidy ≤3kW
  subsidyRateAbove3kW: 0.20,        // 20% for 3–10kW
  escalationRate: 0.05,              // 5% annual tariff escalation
  panelWattage: 545,                 // Wp per panel
  co2PerUnit: 0.82,                  // kg CO2 per kWh (India grid)
  degradationRate: 0.005,            // 0.5% annual degradation
  systemLifeYears: 25,
};

module.exports = SOLAR_CONSTANTS;