# Frontend UI Requirements

This document outlines the design requirements and recommendations for building a frontend UI for the Cloudflare Crawler API.

## Overview

The frontend should provide a comprehensive interface for:
1. Managing crawl configurations
2. Creating and monitoring crawl runs
3. Browsing crawled content
4. Viewing errors and diagnostics

---

## UI Screens

### 1. Dashboard

**Purpose:** Overview of all crawl activity

**Components:**
- Summary cards showing:
  - Active runs count
  - Total pages crawled (24h)
  - Error rate
  - Queue depth across all runs
- Recent runs list with quick actions
- System health indicator

**Data Sources:**
- `GET /api/runs?status=running,paused&limit=10`
- Aggregate from multiple run stats

---

### 2. Configurations Manager

**Purpose:** Create and manage reusable crawl configurations

**Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│ Configurations                              [+ New Config]   │
├─────────────────────────────────────────────────────────────┤
│ Search: [____________]  [Filter ▼]                          │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Default Configuration                              ⚙️ 🗑️ │ │
│ │ Standard crawl configuration with balanced settings     │ │
│ │ Last updated: 2024-01-15                                │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Aggressive Crawl                                   ⚙️ 🗑️ │ │
│ │ Fast crawling with minimal delays                       │ │
│ │ Last updated: 2024-01-14                                │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Configuration Editor (Modal/Drawer):**
```
┌─────────────────────────────────────────────────────────────┐
│ Edit Configuration                                    [X]    │
├─────────────────────────────────────────────────────────────┤
│ Name: [Aggressive Crawl________________]                     │
│ Description: [Fast crawling with minimal delays___]          │
│                                                              │
│ ┌─ Rate Limiting ─────────────────────────────────── [v] ─┐ │
│ │ Min Domain Delay:    [500] ms                           │ │
│ │ Max Domain Delay:    [30000] ms                         │ │
│ │ Error Backoff:       [2] x                              │ │
│ │ Jitter Factor:       [0.1]                              │ │
│ │ Max Concurrent:      [32]                               │ │
│ │ Global Rate Limit:   [0] req/min (0 = unlimited)        │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌─ Content Filtering ─────────────────────────────── [>] ─┐ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌─ Crawl Behavior ────────────────────────────────── [>] ─┐ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌─ Domain Scope ──────────────────────────────────── [>] ─┐ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│                               [Cancel]  [Save Configuration] │
└─────────────────────────────────────────────────────────────┘
```

**Field Recommendations:**

| Section | Field | Input Type | Notes |
|---------|-------|------------|-------|
| Rate Limiting | minDomainDelayMs | Slider + Input | 100-10000ms |
| Rate Limiting | maxConcurrentRequests | Slider | 1-100 |
| Content Filtering | maxContentSizeBytes | Dropdown | 1MB, 5MB, 10MB, 50MB |
| Content Filtering | allowedContentTypes | Multi-select chips | |
| Crawl Behavior | maxDepth | Slider | 1-50 |
| Crawl Behavior | userAgent | Text + Presets | |
| Domain Scope | allowedDomains | Tag input | Add/remove domains |
| Domain Scope | excludePatterns | Tag input | Regex patterns |

---

### 3. Runs Manager

**Purpose:** Create, monitor, and manage crawl runs

**List View:**
```
┌─────────────────────────────────────────────────────────────┐
│ Crawl Runs                                   [+ New Run]     │
├─────────────────────────────────────────────────────────────┤
│ Status: [All ▼]  Config: [All ▼]  Search: [__________]      │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 🟢 Example.com Full Crawl                          ▶️ ⏸️ │ │
│ │ Config: Default  •  Started: 2h ago                     │ │
│ │ ████████████████████░░░░░░░░░░ 65% (2,450 / 3,769)     │ │
│ │ 45 pages/min  •  ETA: 29 min  •  5 errors              │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ⏸️ Blog Archive Crawl                              ▶️ ⏹️ │ │
│ │ Config: Polite  •  Paused: 1h ago                       │ │
│ │ ██████████░░░░░░░░░░░░░░░░░░░░ 33% (500 / 1,500)       │ │
│ │ Paused - Click to resume                                │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ✅ Product Pages Scan                                   │ │
│ │ Config: Aggressive  •  Completed: Yesterday             │ │
│ │ ██████████████████████████████ 100% (10,234 pages)     │ │
│ │ Duration: 3h 24min  •  12 errors                        │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Status Icons:**
- 🟢 Running
- ⏸️ Paused
- ⏳ Pending
- ✅ Completed
- ❌ Failed
- 🚫 Cancelled

**Run Detail View:**
```
┌─────────────────────────────────────────────────────────────┐
│ ← Back    Example.com Full Crawl              [⏸️] [🗑️]     │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────┬─────────────┬─────────────┬──────────────┐  │
│ │   QUEUED    │   FETCHED   │   FAILED    │    SPEED     │  │
│ │    3,769    │    2,450    │      5      │  45 p/min    │  │
│ └─────────────┴─────────────┴─────────────┴──────────────┘  │
│                                                              │
│ Progress ████████████████████░░░░░░░░░░ 65%  ETA: 29 min    │
│                                                              │
│ ┌─ Real-time Stats ───────────────────────────────────────┐ │
│ │ Bytes Downloaded: 156.2 MB                              │ │
│ │ Avg Response Time: 234 ms                               │ │
│ │ Domains Discovered: 1                                   │ │
│ │ Current Depth: 4                                        │ │
│ │ Queue Size: 1,319                                       │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌─ Domain Breakdown ──────────────────────────────────────┐ │
│ │ Domain          Pages    Errors    Avg Time    Size     │ │
│ │ example.com     2,450    5         234ms       156.2MB  │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌─ Recent Errors (5) ─────────────────────────────────────┐ │
│ │ 🔴 404 example.com/old-page         2 min ago           │ │
│ │ 🔴 500 example.com/broken           5 min ago           │ │
│ │ 🔴 404 example.com/removed          8 min ago           │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ Tabs: [Pages] [Errors] [Settings]                           │
└─────────────────────────────────────────────────────────────┘
```

**New Run Dialog:**
```
┌─────────────────────────────────────────────────────────────┐
│ Create New Crawl Run                                  [X]    │
├─────────────────────────────────────────────────────────────┤
│ Name: [_________________________________]                    │
│ Description: [_________________________________] (optional)  │
│                                                              │
│ Configuration:                                               │
│ ○ Use existing: [Default Configuration ▼]                   │
│ ○ Create new configuration                                  │
│                                                              │
│ Seed URLs:                                                   │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ https://example.com                                  [x]│ │
│ │ https://example.com/products                         [x]│ │
│ │ [+ Add URL]                                             │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│ ☑️ Start immediately after creation                          │
│                                                              │
│                              [Cancel]  [Create & Start]      │
└─────────────────────────────────────────────────────────────┘
```

---

### 4. Pages Browser

**Purpose:** Browse and search crawled content

```
┌─────────────────────────────────────────────────────────────┐
│ Crawled Pages                                                │
├─────────────────────────────────────────────────────────────┤
│ Run: [All Runs ▼]  Domain: [All ▼]  Status: [All ▼]         │
│ Search URL: [__________________________] [Search]            │
├─────────────────────────────────────────────────────────────┤
│ │ URL                    │ Status │ Size   │ Time   │ Date │
│ ├────────────────────────┼────────┼────────┼────────┼──────│
│ │ example.com/           │ 200 ✓  │ 45 KB  │ 234ms  │ 2m   │
│ │ example.com/about      │ 200 ✓  │ 32 KB  │ 189ms  │ 2m   │
│ │ example.com/contact    │ 200 ✓  │ 28 KB  │ 156ms  │ 3m   │
│ │ example.com/old-page   │ 404 ✗  │ 1 KB   │ 89ms   │ 5m   │
│ │ example.com/products   │ 200 ✓  │ 67 KB  │ 312ms  │ 5m   │
├─────────────────────────────────────────────────────────────┤
│ Showing 1-50 of 2,450           [< Prev] Page 1 [Next >]    │
└─────────────────────────────────────────────────────────────┘
```

**Row Actions:**
- Click to view page details
- Quick preview button
- Download HTML button
- Copy URL button

**Page Detail Modal:**
```
┌─────────────────────────────────────────────────────────────┐
│ Page Details                                          [X]    │
├─────────────────────────────────────────────────────────────┤
│ URL: https://example.com/products                           │
│ Status: 200 OK                                              │
│ Content Size: 67,234 bytes                                  │
│ Response Time: 312 ms                                       │
│ Fetched: 2024-01-15 14:32:45                               │
│ Content Hash: abc123def456...                               │
│                                                              │
│ ┌─ HTML Preview ──────────────────────────────────────────┐ │
│ │ <!DOCTYPE html>                                         │ │
│ │ <html>                                                  │ │
│ │   <head>                                                │ │
│ │     <title>Products - Example</title>                   │ │
│ │   ...                                                   │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                              │
│                         [Download HTML]  [Open in Browser]   │
└─────────────────────────────────────────────────────────────┘
```

---

## Component Specifications

### Progress Indicators

**Progress Bar:**
- Show percentage, current/total counts
- Color coding: Blue (running), Yellow (paused), Green (complete), Red (failed)
- Animate smoothly between updates

**Stats Counters:**
- Animate number changes
- Format large numbers (1,234 or 1.2K)
- Show trend indicators (↑ ↓)

### Form Inputs

**URL Input:**
- Validate URL format in real-time
- Support paste of multiple URLs (one per line)
- Show validation errors inline

**Domain Input:**
- Tag-style input with autocomplete from known domains
- Support wildcards (*.example.com)
- Validate domain format

**Regex Pattern Input:**
- Syntax highlighting
- Live testing against sample URLs
- Show match count

### Polling Behavior

| View | Status | Interval |
|------|--------|----------|
| Run List | Any active runs | 5s |
| Run Detail | Running | 2s |
| Run Detail | Paused | 10s |
| Run Detail | Completed | Stop |
| Dashboard | Always | 10s |

### Error Handling

**Display:**
- Toast notifications for API errors
- Inline error messages for form validation
- Error boundary for component crashes

**Retry:**
- Automatic retry for transient errors (3 attempts)
- Manual retry button for persistent failures
- Clear error state after successful action

---

## State Management

### Recommended Store Structure

```typescript
interface CrawlerStore {
  // Configurations
  configs: CrawlConfig[];
  selectedConfigId: string | null;
  configsLoading: boolean;

  // Runs
  runs: CrawlRun[];
  selectedRunId: string | null;
  runsLoading: boolean;

  // Pages
  pages: PageRecord[];
  pagesLoading: boolean;
  pagesFilter: {
    runId?: string;
    domain?: string;
    status?: number[];
  };

  // UI State
  modals: {
    createRun: boolean;
    editConfig: boolean;
    pagePreview: boolean;
  };

  // Actions
  fetchConfigs: () => Promise<void>;
  createConfig: (config: CreateConfigRequest) => Promise<void>;
  fetchRuns: () => Promise<void>;
  createRun: (run: CreateRunRequest) => Promise<void>;
  controlRun: (id: string, action: 'start' | 'pause' | 'resume' | 'cancel') => Promise<void>;
}
```

---

## Accessibility Requirements

- All interactive elements must be keyboard accessible
- ARIA labels for icons and non-text elements
- Color contrast ratio of at least 4.5:1
- Screen reader announcements for dynamic updates
- Focus management for modals and dialogs

---

## Responsive Design

| Breakpoint | Layout Adjustments |
|------------|-------------------|
| Desktop (>1200px) | Full layout with sidebars |
| Tablet (768-1200px) | Collapsible sidebar, simplified cards |
| Mobile (<768px) | Single column, bottom navigation |

---

## Technology Recommendations

### Framework
- React 18+ with TypeScript
- Next.js 14 for SSR/routing (optional)

### State Management
- TanStack Query for server state
- Zustand for client state
- Or: Redux Toolkit with RTK Query

### UI Components
- shadcn/ui (recommended for consistency)
- Or: Radix UI primitives + Tailwind CSS

### Charts/Visualization
- Recharts for progress/stats charts
- D3.js for domain network visualization (optional)

### Form Handling
- React Hook Form
- Zod for validation

---

## API Client Integration

The types from `src/types.ts` should be exported and shared with the frontend:

```bash
# Option 1: NPM package
npm publish @crawler/types

# Option 2: Copy types file
cp src/types.ts ../frontend/src/types/crawler.ts

# Option 3: Generate from OpenAPI (if spec exists)
openapi-typescript api.yaml -o src/types/api.ts
```

---

## Performance Considerations

1. **Virtual Scrolling:** Use for pages list (react-virtual)
2. **Debounced Search:** 300ms debounce on search inputs
3. **Optimistic Updates:** Immediate UI feedback for actions
4. **Stale-While-Revalidate:** Show cached data while fetching
5. **Lazy Loading:** Load configuration sections on expand
