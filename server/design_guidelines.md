# AI Security Management System - Design Guidelines

## Design Approach

**Framework**: Material Design adapted for security/monitoring applications
**References**: Linear's data density + Vercel's dashboard clarity + security monitoring interfaces (Verkada, Cloudflare's dashboards)
**Principle**: Information-first design prioritizing rapid scanning, quick actions, and status clarity

---

## Typography

**Font Family**: Inter (via Google Fonts CDN)
- **Headers**: 600 weight, sizes: text-2xl (dashboard titles), text-lg (section headers)
- **Body**: 400 weight, text-sm for most interface text, text-xs for metadata
- **Data/Metrics**: 500 weight, tabular-nums for consistent number alignment
- **Monospace**: JetBrains Mono for timestamps, IDs

---

## Layout System

**Spacing Units**: Tailwind 2, 4, 6, 8 (consistent rhythm)
- Component padding: p-4 to p-6
- Section gaps: gap-6 for grids, gap-4 for cards
- Dashboard margins: Main content area with px-8 py-6

**Grid Structure**: 
- Video grid: 3-4 columns on desktop (grid-cols-3 lg:grid-cols-4)
- Customer cards: 2-3 columns (grid-cols-2 lg:grid-cols-3)
- Dashboard stats: 4 columns (grid-cols-4)

---

## Core Components

### Navigation Sidebar
- Fixed left sidebar (w-64), dark background
- Role indicator at top with avatar/name
- Main sections: Dashboard, Video Review, Customers, Reports
- Bottom: Settings, dark mode toggle, logout

### Video Grid Display
- Card-based layout with 16:9 aspect ratio video thumbnails
- Overlay controls: timestamp badge (top-right), duration (bottom-left)
- Hover state reveals play button and clip info
- Selected state: 2px border accent

### Classification Action Bar
Three prominent buttons below active video:
1. **Suspect** - amber/warning styling
2. **Confirm Theft** - red/critical styling  
3. **Clear** - green/success styling
- Each button: px-6 py-3, rounded-lg, with icon + label
- Disabled state when no video selected

### Customer Profile Cards
- Compact cards with: Customer photo (64x64), name, ID number
- Points display: Large numeric value with label
- Status badges: pill-shaped, small text (Frequent/New/Flagged)
- Last visit timestamp
- Quick action: "View History" link

### Dashboard Panels
**Manager View**: 
- Top stats row: Total incidents, Active cases, Resolved today, Response time
- Chart area: Incident trends graph
- Recent activity feed
- Quick filters toolbar

**AI Trainer View**:
- Classification accuracy metrics
- Pending review queue counter
- Training dataset stats
- Model performance indicators

### Status Badges
- Rounded-full, px-3 py-1, text-xs font-medium
- Semantic colors: Red (theft), Amber (suspect), Green (clear), Blue (pending)

---

## Dark Mode Specifications

**Background Layers**:
- Main bg: slate-950
- Card surfaces: slate-900
- Elevated elements: slate-800
- Borders: slate-700/30

**Text Hierarchy**:
- Primary: slate-50
- Secondary: slate-400
- Muted: slate-500

**Accent Colors** (same in light/dark):
- Primary actions: blue-500
- Warning: amber-500
- Error: red-500
- Success: green-500

**Video Player Controls**: Semi-transparent slate-900/90 backdrop-blur

---

## Images

**Customer Profile Photos**: 
- Placeholder avatars using UI Avatars or similar service
- Circular cropping, 64x64 for cards, 128x128 for detail views
- Fallback: initials on colored background

**No hero images** - This is an application interface, not a marketing site. Focus on functional data display.

---

## Key Interactions

- **Video Selection**: Single-click to select, double-click to play fullscreen
- **Filter Toggles**: Instant visual feedback with selected state
- **Classification**: Confirmation dialog for "Confirm Theft" action
- **Search**: Real-time filtering with loading states
- **Pagination**: Show "X of Y results" with prev/next controls

**Animation**: Minimal - only smooth transitions (duration-200) for state changes. No decorative animations.