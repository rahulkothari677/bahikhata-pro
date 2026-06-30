/**
 * Chart color tokens — read from CSS variables defined in globals.css.
 * These adapt automatically to dark mode (CSS variables change in .dark scope).
 *
 * Usage in Recharts:
 *   import { chartColors } from '@/lib/chart-theme'
 *   <CartesianGrid stroke={chartColors.grid} />
 *   <XAxis tick={{ fill: chartColors.tick, fontSize: 11 }} />
 *   <Tooltip contentStyle={chartColors.tooltipStyle} />
 */

export const chartColors = {
  tick: 'var(--chart-tick)',
  grid: 'var(--chart-grid)',
  tooltipBg: 'var(--chart-tooltip-bg)',
  tooltipBorder: 'var(--chart-tooltip-border)',
  tooltipText: 'var(--chart-tooltip-text)',
  get tooltipStyle() {
    return {
      borderRadius: '12px',
      fontSize: 12,
      background: 'var(--chart-tooltip-bg)',
      border: '1px solid var(--chart-tooltip-border)',
      color: 'var(--chart-tooltip-text)',
      boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
      padding: '8px 12px',
      zIndex: 1000,
    }
  },
  // Item style for individual tooltip items — forces text color to match tooltip
  get tooltipItemStyle() {
    return {
      color: 'var(--chart-tooltip-text)',
    }
  },
  // Label style for tooltip header (e.g., date or category name)
  get tooltipLabelStyle() {
    return {
      color: 'var(--chart-tooltip-text)',
      fontWeight: 600,
      marginBottom: '4px',
    }
  },
}

/**
 * Chart series colors — saffron, emerald, amber, teal, rose.
 * Same in light/dark (they're saturated enough to read on either bg).
 */
export const chartSeries = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const
