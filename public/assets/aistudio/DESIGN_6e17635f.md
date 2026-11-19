---
name: Obsidian Telemetry
colors:
  surface: '#031427'
  surface-dim: '#031427'
  surface-bright: '#2a3a4f'
  surface-container-lowest: '#000f21'
  surface-container-low: '#0b1c30'
  surface-container: '#102034'
  surface-container-high: '#1b2b3f'
  surface-container-highest: '#26364a'
  on-surface: '#d3e4fe'
  on-surface-variant: '#c2c6d6'
  inverse-surface: '#d3e4fe'
  inverse-on-surface: '#213145'
  outline: '#8c909f'
  outline-variant: '#424754'
  surface-tint: '#adc6ff'
  primary: '#adc6ff'
  on-primary: '#002e6a'
  primary-container: '#4d8eff'
  on-primary-container: '#00285d'
  inverse-primary: '#005ac2'
  secondary: '#4edea3'
  on-secondary: '#003824'
  secondary-container: '#00a572'
  on-secondary-container: '#00311f'
  tertiary: '#ffb3ad'
  on-tertiary: '#68000a'
  tertiary-container: '#ff5451'
  on-tertiary-container: '#5c0008'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#adc6ff'
  on-primary-fixed: '#001a42'
  on-primary-fixed-variant: '#004395'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#ffdad7'
  tertiary-fixed-dim: '#ffb3ad'
  on-tertiary-fixed: '#410004'
  on-tertiary-fixed-variant: '#930013'
  background: '#031427'
  on-background: '#d3e4fe'
  surface-variant: '#26364a'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 36px
    fontWeight: '600'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.005em
  body-lg:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: 0em
  body-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0.01em
  metric-stat:
    fontFamily: JetBrains Mono
    fontSize: 24px
    fontWeight: '500'
    lineHeight: 28px
    letterSpacing: -0.03em
  label-code:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0em
  label-caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.06em
  badge-mono:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.02em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-tablet: 0.75rem
  gutter-mobile: 0.5rem
  margin: 1.5rem
  margin-mobile: 1rem
  space-2xs: 0.125rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
  space-2xl: 2rem
---

## Brand & Style
The design system embodies enterprise-grade operational authority, architectural precision, and real-time clarity. Designed for site reliability engineers, DevOps leads, and infrastructure architects, the interface prioritizes immediate signal-to-noise separation under high-stress incident scenarios.

The aesthetic fuses modern high-density SaaS utility with precision aerospace instrumentation:
- **Atmosphere:** Deep void telemetry—calm, focused, dark-mode-first environment engineered for 24/7 mission control and SOC dashboards.
- **Hierarchy:** High-contrast tactical accents against layered obsidian-slate containers. Semantic status signals (emerald, amber, crimson) command focal hierarchy without polluting baseline scanning paths.
- **Density:** Compact, compact-data layouts that optimize screen real estate for large fleets of nodes, protocols, and latency distributions without visual fatigue.
- **Emotional Response:** Uncompromising reliability, microscopic precision, and absolute situational control.

## Colors
The palette is calibrated for high-contrast dark environments to maintain strict WCAG AAA contrast ratios for vital telemetry data while eliminating eye strain during prolonged monitoring sessions.

### Base Surfaces
- **Canvas Base:** `#090D16` — Deepest void; ground level for global viewports and background canvasing.
- **Surface Layer 1:** `#0D121F` — Structural surface for navigation, persistent sidebars, and base panel grouping.
- **Surface Layer 2:** `#131B2E` — Component container level for cards, data table rows, modal overlays, and elevated modules.
- **Surface Hover / Active:** `#1E293B` — Interactive surface state for table row hovers, active tabs, and input fills.

### Structural Borders
- **Border Subtle:** `#1E293B` — Standard divider for grid cells, table horizontal borders, and panel framing.
- **Border Strong:** `#26354D` — Focused outlines, active card strokes, and interactive container bounds.

### Telemetry & Semantic Accents
- **Primary Interactive (Electric Blue):** `#3B82F6` (Base), `#2563EB` (Hover/Pressed), `#60A5FA` (Text link / Focus ring). Reserved for navigation selection, primary actions, and telemetry selection cursors.
- **Operational / Healthy (Neon Emerald):** `#10B981` (Base), `#059669` (Subtle tint), `#34D399` (High-contrast glow/text), `#064E3B` (Background pill tint). Indicates 100% uptime, healthy probe checks, and nominal SLA.
- **Degraded / Warning (Signal Amber):** `#F59E0B` (Base), `#78350F` (Surface tint). Indicates elevated latency, packet loss, or SSL expiry warnings.
- **Critical / Outage (Laser Crimson):** `#EF4444` (Base), `#F87171` (Glow/text), `#450A0A` (Surface tint). Signifies service downtime, probe timeouts, and open incidents.

### Typography & Neutrals
- **Text Bright:** `#F8FAFC` — Primary values, active headers, and metric numerals.
- **Text Default:** `#E2E8F0` — Default UI text, table cell content, and form inputs.
- **Text Muted:** `#94A3B8` — Column headers, secondary metadata, breadcrumbs, and inactive icons.
- **Text Dim:** `#64748B` — Monospace timestamps, protocol tags, and subtle boundary labels.

## Typography
The system employs a dual-typeface structure designed for rapid tabular parsing and visual ergonomics.

### Font Roles
- **Primary Interface (Inter):** Deployed for all structural titles, navigation links, contextual tooltips, action labels, and narrative status descriptions. Tight tracking (-0.01em to -0.02em) on headlines produces a compact, contemporary enterprise presentation.
- **Precision Data (JetBrains Mono):** Mandated for all machine-generated content: IP addresses (v4 & v6), round-trip latency values, HTTP status codes, protocol chips, SLA percentages, and ISO timestamps. Fixed-width glyph metrics preserve vertical alignment down table columns and prevent jitter during live data feeds.

### Style Directives
- Metric stats employ tabular figures (`font-variant-numeric: tabular-nums`) across both typefaces.
- Column table headers always use `label-caps` in uppercase transform with subtle tracking (`0.06em`) and muted tone (`#94A3B8`) to distinguish keys from dynamic values.

## Layout & Spacing
The layout follows a fluid-density grid system tailored for variable multi-monitor workstations down to mobile incident response.

### Grid & Viewport Model
- **Desktop (>= 1280px):** 12-column layout with fixed 240px collapsable left operational rail, 16px (`gutter`) column separation, and 24px (`margin`) outer edge boundaries.
- **Tablet / Small Display (768px - 1279px):** 8-column layout with icon-rail navigation (64px) or top bar, 12px (`gutter-tablet`), and 16px page margins.
- **Mobile (< 768px):** 4-column reflow where tabular node lists collapse into structured card stacks with preserved telemetry priority; 8px gutters and 16px page margins.

### Spacing Philosophy
- Base unit is built on a tight 4px scale.
- Density overrides: High-density views (e.g., node ping rosters and log streams) utilize `space-xs` (4px) and `space-sm` (8px) internal padding to maximize row visibility without scrolling.
- Global overview cards and incident hero zones leverage `space-lg` (16px) and `space-xl` (24px) to ensure operational status is instantly identifiable at a glance.

## Elevation & Depth
Depth is produced via subtle tonal surface stratification and laser-thin structural outlines rather than heavy drop shadows. This maintains a clean, instrumentation-grade screen surface.

### Layer Hierarchy
- **Level 0 (Canvas):** `#090D16` — Global application canvas.
- **Level 1 (Sub-Containers):** `#0D121F` + 1px solid `#1E293B` — Primary data tables, metric card frames, and left navigation sidebar.
- **Level 2 (Active Elements & Modals):** `#131B2E` + 1px solid `#26354D` — Floating inspection panels, flyouts, dropdown lists, and filter overlays.

### Ambient Shadow Strategy
- Shadows are used sparingly to prevent muddy dark-mode contrast.
- **Floating Overlays & Menus:** `0 4px 20px -2px rgba(0, 0, 0, 0.75), 0 0 1px 1px rgba(38, 53, 77, 0.6)`.
- **Status Luminescence (Glows):** Critical incidents and live operational indicators utilize targeted chromatic glows:
  - Healthy Node: `0 0 8px 0 rgba(16, 185, 129, 0.35)`
  - Outage Incident: `0 0 10px 1px rgba(239, 68, 68, 0.45)`

## Shapes
A controlled, modern architectural shape profile:
- Primary interface cards, data table containers, filter bars, and modal bodies utilize standard `rounded` (`0.25rem` / 4px) to maintain a technical, clean, and dense feel.
- Interactive elements like action buttons, inputs, and tab segments share this 4px radius.
- Status badges, protocol tags (HTTP, TCP, DNS), and live uptime indicator pills utilize fully pill-shaped borders (`9999px`) to create clear shape differentiation between static bounding boxes and semantic state tags.

## Components

### 1. High-Density Data Tables
- **Container:** Background `#0D121F`, outer border 1px `#1E293B`, rounded 4px.
- **Header:** Background `#090D16`, text `label-caps` in `#94A3B8`, height 36px, border-bottom 1px solid `#1E293B`.
- **Rows:** Height 44px (compact mode) or 52px (standard mode). Alternate borders 1px solid `#1E293B` with hover transition to `#131B2E`.
- **Cells:** Vertical alignment center. Numerical and latency values render right-aligned in `JetBrains Mono`.

### 2. Status Pills & Semantic Indicators
- **Operational (Green):** Background `#064E3B` at 40% opacity, border 1px solid `#059669`, text `#34D399` (`badge-mono`). Includes a 6px pulsing circular dot (`#10B981`) on the leading edge.
- **Degraded (Amber):** Background `#78350F` at 35% opacity, border 1px solid `#D97706`, text `#FBBF24`.
- **Outage (Red):** Background `#450A0A` at 50% opacity, border 1px solid `#DC2626`, text `#F87171` with active perimeter glow.
- **Maintenance (Blue/Slate):** Background `#1E293B`, border 1px solid `#475569`, text `#94A3B8`.

### 3. Latency Mini Sparklines
- **Dimensions:** Width 72px to 120px, height 20px.
- **Stroke:** 1.5px continuous path. Color mapped dynamically to health status (Emerald `#10B981` under 150ms; transitioning to Crimson `#EF4444` on request drops).
- **Fill:** Downward linear gradient from stroke color at 20% alpha to 0% alpha at baseline.
- **Tooltip:** Monospace latency snapshot with timestamp on hover marker.

### 4. Protocol & Port Badges
- **Tokens:** `HTTP`, `HTTPS`, `TCP`, `UDP`, `DNS`, `SSL`, `ICMP`.
- **Styling:** Monospace (`badge-mono`), height 20px, horizontal padding 6px, radius 2px. Background `#090D16`, border 1px solid `#26354D`, text `#94A3B8`.
- **SSL Indicator:** Includes tiny lock icon with amber warning if expiration is within 14 days.

### 5. Metric Stat Cards
- **Structure:** Background `#0D121F`, border 1px solid `#1E293B`, internal padding 16px.
- **Header:** Label in `label-caps` (`#94A3B8`), top-right placement for delta trend badge (+0.04% in `#10B981` or -1.2% in `#EF4444`).
- **Value:** `metric-stat` in `#F8FAFC`.
- **Footer:** Micro-bar representing the 90-day SLA aggregate ratio with segmented daily availability blocks.

### 6. Incident Timeline Stepping Nodes
- **Track:** 2px vertical spine `#1E293B`.
- **Step Node:** 10px circular anchor. Active stage highlighted with `#3B82F6` or `#EF4444` depending on status resolution.
- **Content Block:** Incident update timestamp in `JetBrains Mono` (`#64748B`), incident status label (Investigating, Identified, Monitoring, Resolved), and markdown body in `Inter` (`#E2E8F0`).

### 7. Interactive Controls & Inputs
- **Buttons:**
  - *Primary:* Background `#2563EB`, text `#FFFFFF`, hover `#1D4ED8`, height 34px, padding 0 14px, rounded 4px.
  - *Secondary / Utility:* Background `#131B2E`, border 1px solid `#26354D`, text `#E2E8F0`, hover background `#1E293B`.
  - *Danger:* Background `#450A0A`, border 1px solid `#EF4444`, text `#F87171`.
- **Filter Bar:** Flex row with integrated search input, multi-protocol selector dropdowns, region tag toggles (e.g., `US-East`, `EU-Central`), and live auto-refresh interval selector (`5s`, `15s`, `1m`, `Paused`).
- **Toggle Switches:** Width 36px, height 20px, track background `#1E293B` (inactive) / `#2563EB` (active), thumb diameter 14px white circle.