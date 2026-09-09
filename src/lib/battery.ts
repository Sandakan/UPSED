/**
 * VoltWatch Battery & Telemetry Math Engine
 *
 * Implements calibrated cell-level State-of-Charge (SoC) curves and
 * Peukert load-derated discharge runtime estimation aligned with
 * industrial UPS specifications (e.g. Megatec / Voltronic / ViewPower).
 */

export type BatteryChemistry = 'VRLA_SLA' | 'GEL' | 'LIFEPO4';

export interface ChemistrySpec {
  name: string;
  description: string;
  nominalCellVoltage: number;
  cutoffCellVoltage: number;
  floatCellVoltage: number;
  peukertExponent: number;
}

export const CHEMISTRY_SPECS: Record<BatteryChemistry, ChemistrySpec> = {
  VRLA_SLA: {
    name: 'Standard Lead-Acid (VRLA / AGM)',
    description: 'Standard sealed maintenance-free lead-acid battery used in 99% of desktop & online UPS units.',
    nominalCellVoltage: 2.0,
    cutoffCellVoltage: 1.75, // Empty under load
    floatCellVoltage: 2.28,  // Float / 100% ceiling (27.36V on 24V pack)
    peukertExponent: 1.25,
  },
  GEL: {
    name: 'Gel Cell Lead-Acid',
    description: 'Deep-cycle gel electrolyte battery for high temperature stability.',
    nominalCellVoltage: 2.0,
    cutoffCellVoltage: 1.80,
    floatCellVoltage: 2.30,
    peukertExponent: 1.20,
  },
  LIFEPO4: {
    name: 'Lithium Iron Phosphate (LiFePO4)',
    description: 'High lifecycle lithium cells with flat discharge curves.',
    nominalCellVoltage: 3.2,
    cutoffCellVoltage: 2.80,
    floatCellVoltage: 3.45,
    peukertExponent: 1.05,
  },
};

/**
 * Common UPS Power Factor classes by inverter topology.
 */
export const POWER_FACTOR_PRESETS = [
  {
    pf: 0.6,
    label: 'Standard Desktop / Line-Interactive (PF 0.6)',
    desc: 'Typical home & office line-interactive units (e.g. 1000VA = 600W)',
  },
  {
    pf: 0.8,
    label: 'Business / Server Prosumer (PF 0.8)',
    desc: 'Rackmount & entry server units (e.g. 1000VA = 800W)',
  },
  {
    pf: 0.9,
    label: 'Online Double-Conversion (PF 0.9)',
    desc: 'High-efficiency industrial units e.g. Prolink PRO906/910, Voltronic P01 (e.g. 6000VA = 5400W)',
  },
  {
    pf: 1.0,
    label: 'Enterprise Unity (PF 1.0)',
    desc: 'High-end modern data center UPS (e.g. 1000VA = 1000W)',
  },
];

/**
 * Infer nominal battery pack voltage from live measured voltage.
 */
export function detectNominalVoltage(measuredVoltage: number): number {
  if (measuredVoltage <= 0) return 24;
  if (measuredVoltage < 16) return 12;
  if (measuredVoltage < 32) return 24;
  if (measuredVoltage < 44) return 36;
  if (measuredVoltage < 64) return 48;
  if (measuredVoltage < 88) return 72;
  if (measuredVoltage < 120) return 96;
  // High-voltage banks (e.g., 16 x 12V = 192V nominal for 6kVA-10kVA units)
  if (measuredVoltage >= 160 && measuredVoltage <= 260) return 192;
  if (measuredVoltage > 200) return 240;
  return 24;
}

/**
 * Calculate active wattage from VA and Power Factor.
 */
export function calculateActiveWatts(ratedVa: number, powerFactor: number): number {
  return Math.round(ratedVa * Math.max(0.1, Math.min(1.0, powerFactor)));
}

/**
 * Calculate State of Charge (0-100%) based on measured voltage and chemistry curves.
 * Matches ViewPower calibration (e.g. 27.1V on 24V VRLA -> 96%).
 */
export function calculateBatterySoC(
  measuredVoltage: number,
  nominalVoltage: number = 24,
  chemistry: BatteryChemistry | string = 'VRLA_SLA'
): number {
  if (measuredVoltage <= 0) return 0;

  const chemKey = (chemistry in CHEMISTRY_SPECS ? chemistry : 'VRLA_SLA') as BatteryChemistry;
  const spec = CHEMISTRY_SPECS[chemKey];

  // Number of cells in series
  const cellNominal = spec.nominalCellVoltage;
  const cells = Math.max(1, Math.round(nominalVoltage / cellNominal));

  const cellV = measuredVoltage / cells;
  const vMin = spec.cutoffCellVoltage;
  const vMax = spec.floatCellVoltage;

  if (cellV <= vMin) return 0;
  if (cellV >= vMax) return 100;

  // Linear cell interpolation between cutoff (0%) and float ceiling (100%)
  const soc = ((cellV - vMin) / (vMax - vMin)) * 100;
  return Math.round(Math.max(0, Math.min(100, soc)));
}

/**
 * Estimate backup runtime in minutes considering:
 * - Current SoC
 * - Battery pack total Wh (Nominal V * Ah)
 * - Inverter efficiency (~90% for Online, ~93% for Line-Interactive)
 * - Peukert discharge derating at high C-rates
 */
export function calculateEstimatedRuntime(
  socPct: number,
  nominalVoltage: number = 24,
  capacityAh: number = 9.0,
  loadWatts: number = 0,
  topology: 'Online' | 'LineInteractive' | string = 'Online',
  chemistry: BatteryChemistry | string = 'VRLA_SLA'
): number {
  if (socPct <= 0 || loadWatts <= 0) return 0;

  // Inverter conversion efficiency
  const inverterEfficiency = topology.toLowerCase().includes('line') ? 0.93 : 0.90;

  // Total nominal energy of pack in Watt-hours
  const totalWh = nominalVoltage * Math.max(1, capacityAh);
  const remainingWh = totalWh * (socPct / 100) * inverterEfficiency;

  // Approximate discharge rate (C-rate)
  // Battery current I = loadWatts / (nominalVoltage * efficiency)
  const dischargeCurrentAmps = loadWatts / (nominalVoltage * inverterEfficiency);
  const cRate = dischargeCurrentAmps / Math.max(1, capacityAh);

  // Peukert derating factor:
  // Lead-acid delivered capacity decreases significantly at high C-rates.
  // At ~1C (~1-hour rate), effective capacity is ~58-62%.
  // At ~0.2C (5-hour rate), effective capacity is ~85%.
  let peukertFactor = 1.0;
  if (chemistry !== 'LIFEPO4') {
    if (cRate >= 1.5) {
      peukertFactor = 0.50;
    } else if (cRate >= 0.8) {
      peukertFactor = 0.58; // Typical 1C rate (~180W on 24V 9Ah is ~8.5A -> 0.94C)
    } else if (cRate >= 0.4) {
      peukertFactor = 0.70;
    } else if (cRate >= 0.2) {
      peukertFactor = 0.82;
    } else {
      peukertFactor = 0.92;
    }
  } else {
    // LiFePO4 delivers ~95% across high C-rates
    peukertFactor = 0.95;
  }

  // Runtime in hours = (remainingWh * peukertFactor) / loadWatts
  const runtimeHours = (remainingWh * peukertFactor) / loadWatts;
  const runtimeMinutes = Math.round(runtimeHours * 60);

  return Math.max(1, runtimeMinutes);
}

/**
 * Format runtime minutes into a clean human-readable string (e.g. "35 mins", "1h 15m").
 */
export function formatRuntime(minutes: number): string {
  if (minutes <= 0) return '0m';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

