# PriceIQ — AI-Powered Pricing Optimization Engine

**Consumer & Retail Intelligence · Interactive prototype for the NIQ internal hackathon**

## Project overview

PriceIQ is a retailer-focused pricing intelligence platform. It helps a retailer choose **one selling price per product** — not personalised prices — by combining historical sales, customer-segment price response and demand forecasting into explainable, profit-maximising recommendations.

This repository contains a complete, fully interactive frontend. The proposed machine-learning backend (K-Means segmentation, XGBoost demand model, LLM copilot) is not built yet, so the app runs on a **deterministic mock analytics engine** that mirrors that architecture. It works entirely in the browser.

> **Interactive prototype · illustrative analytics.** All products, sales history and customers are synthetic, generated from a fixed seed. No trained model, live LLM, competitor price feed or retailer inventory system is connected. Uplift figures are estimates, not validated business impact.

## Features

| Page | What it does |
|---|---|
| **Executive Overview** `#/overview` | Historical KPIs (revenue, gross profit) kept separate from estimated profit-opportunity KPIs; revenue and gross-profit trend (weekly/monthly); opportunities by category (click a bar to filter); computed insights; a 220-product opportunities table with search, sort, status/category filters, pagination, CSV export and **Analyze / Simulate** actions |
| **Demand Forecasting** `#/forecast` | Searchable product selector; forecast period of 1–12 weeks; proposed price with a slider; KPIs for predicted demand, units sold, revenue, profit and margin; demand-response curve; segment demand; inventory-constraint indicator; historical weekly sales |
| **Price Optimization** `#/optimization` | Grid-search recommendation hero card; price-vs-profit curve with current and recommended markers; sortable candidate-price table; optional constraints (min/max price, max increase/decrease, inventory); segment response; explanation generated from the calculated values; compare alternatives (revenue-max, volume-max, conservative); CSV export; links to the simulator and Copilot |
| **What-If Simulator** `#/simulator` | Baseline vs scenario price, slider and quick buttons (−10%, −5%, +5%, +10%, Recommended); comparison cards with absolute and % change; demand, revenue and profit bar charts; segment impact; dynamic insights; save, rename, load, delete, compare and clear scenarios (kept in localStorage) |
| **Customer Intelligence** `#/customers` | Four illustrative RFM segments; segment distribution donut; normalised RFM comparison; frequency-vs-monetary scatter; category preferences per segment; product-level segment analysis linked to forecasting |
| **PriceIQ Copilot** `#/copilot` | Guided chat with suggested questions, typing indicator, timestamps, rich response cards, copy-to-clipboard, a product context chip, and conversation kept in sessionStorage. The same chat is also available as an **Ask PriceIQ** drawer on every page |

Across the app:
- Collapsible sidebar; its expanded/collapsed preference is remembered.
- Global product/SKU/category search.
- Computed pricing alerts in a notification panel.
- A global forecast-period selector.
- Browser back/forward support.
- About & Methodology dialog (sidebar, prototype badge, or avatar menu).
- Responsive from 1920px desktop down to mobile.

### One shared engine

Every page and the Copilot call the same service functions. A product's recommended price, demand, revenue and profit are therefore identical everywhere for the same product, period and constraints. The selected product and price scenario also carry across pages: **Analyze** in the Overview → **Simulate This Price** → **Ask PriceIQ Copilot** keeps the same product in context the whole way.

## Technology stack

- HTML5, CSS3, vanilla JavaScript (ES2020 modules). No framework, no npm and no build step to run the app; a small Python script (`tools/build_bundle.py`) regenerates the single-file bundle after code edits.
- [Plotly.js](https://plotly.com/javascript/) 2.35 (basic bundle) for charts.
- [Lucide](https://lucide.dev) icons and the Inter font.
- Plotly, Lucide and Inter load from public CDNs; all application data is generated locally in the browser.

## Project structure

```
index.html                 App shell (repository root)
README.md
assets/images/favicon.svg
tools/build_bundle.py      Rebuilds js/priceiq.bundle.js from the modules
css/
  variables.css            Design tokens (colours, type, spacing, radii, shadows)
  layout.css               Shell, sidebar, header, grids, responsive breakpoints
  components.css           Cards, buttons, forms, KPI cards, tables, modals, toasts, chat, drawer
  pages.css                Page-specific styles
js/
  priceiq.bundle.js        GENERATED single-file bundle loaded by index.html (do not edit)
  app.js                   Bootstrap
  router.js                Hash router (#/page?product=…)
  state.js                 Central store (selected product, period, scenarios, …)
  utils.js                 Formatting, safe division, CSV export, storage, seeded RNG
  data/
    seed-data.js           Segment, category, featured-product and rule definitions
    data-generator.js      Deterministic dataset generator
  services/                Business logic only — no DOM
    product-service.js     Catalog and search
    demand-service.js      predictDemand(): the shared demand engine
    optimization-service.js optimizePrice(), explanations, alternatives
    simulation-service.js  simulatePrice(): baseline vs scenario
    segmentation-service.js Segment summaries, RFM, product segment breakdown
    analytics-service.js   Portfolio history, opportunities, insights, alerts
    copilot-service.js     Intent router and response builder
  components/              Sidebar, header, KPI card, data table, charts, modal/toast,
                           product picker, Copilot chat and drawer, help dialog, UI helpers
  pages/                   overview · forecast · optimization · simulator · customers · copilot
```

## Run locally

**Just double-click `index.html`.** It opens straight from disk (`file://`) with no server. An internet connection is needed the first time so the browser can fetch Plotly, Lucide and the Inter font from their CDNs.

A local server also works if you prefer one:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

### Editing the code

The ES modules under `js/` are the source of truth. Browsers block ES modules on `file://`, so `index.html` loads one classic script, `js/priceiq.bundle.js`, generated from those modules. After changing anything in `js/`, rebuild it (Python 3, no dependencies):

```bash
python tools/build_bundle.py
```

## Deploy to GitHub Pages

1. Create a GitHub repository and push this folder's contents so that `index.html` is at the repository root.
2. In the repository, go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, select `main` and `/ (root)`, then click **Save**.
4. After about a minute the site is live at `https://<user>.github.io/<repository-name>/`.

No configuration is needed. All CSS/JS/asset paths are relative, navigation is hash-based (no server-side routing), and there is no backend, environment variable or API key. Netlify and Vercel also work as a plain static deploy with no build command.

## Suggested 5–7 minute demo

1. **Executive Overview**: portfolio performance, opportunities by category, the opportunities table.
2. Click **Analyze** on a High Opportunity product (e.g. *Scented Soy Candle Gift Set*) to open Price Optimization.
3. Click **Simulate This Price**, then try other prices and the quick buttons.
4. Open **Demand Forecasting** to show segment-level demand response.
5. Open **Customer Intelligence** to explain the illustrative segments.
6. Open **Copilot** and ask *"Why is this price recommended?"*, then *"What happens if I increase the price by 5%?"*.

Featured demo products cover the main outcomes:
- Ceramic Coffee Mug — headline product.
- Personalised Leather Notebook — benefits from a price increase.
- Glass Storage Jar Set — benefits from a price decrease.
- Linen Table Runner — already near optimal.
- Scented Soy Candle Gift Set — inventory constrained.
- Stainless Steel Water Bottle — highly price-sensitive.
- Handmade Ceramic Vase — low price sensitivity.

## Methodology (mock engine)

- **Demand:** `Demand_s(P) = BaselineWeekly_s × Σ SeasonalIndex(week) × (P / P0)^(−e × m_s)`, summed over four segments. `P0` is the current price, `e` the product's base price sensitivity and `m_s` an illustrative segment multiplier. Expected units sold = `min(demand, inventory)`.
- **Optimization:** a deterministic grid search from −20% to +30% around the current price (step £0.05–£0.50 depending on the price band). It never goes below unit cost and respects user constraints. The recommended price is always the evaluated candidate with the highest expected gross profit.
- **Opportunity status:**
  - **High:** expected profit uplift ≥ 5%.
  - **Moderate:** uplift ≥ 2% (High and Moderate both count as pricing opportunities).
  - **Near Optimal:** below 2%.
  - **Inventory Constrained** is an additional badge, shown when demand exceeds stock.
- **Consistency:** portfolio, category and weekly totals all aggregate from the same 45,760 product × week × segment records. Each segment's customer spend sums to that segment's historical revenue.

## Prototype limitations

- Synthetic data only. It is inspired by the structure of the UCI Online Retail dataset, but no real records are used.
- Demand response is an illustrative constant-elasticity model with assumed segment sensitivities. It is not a trained XGBoost model.
- Segments are illustrative RFM-style groups, not trained K-Means clusters.
- The Copilot is a rule-based intent router with a fixed set of supported intents. No LLM is connected.
- Inventory is a fixed stock-on-hand figure with no replenishment within the horizon.
- There are no competitor prices, promotions planning, cross-product cannibalisation, or multi-store effects.
- Saved scenarios live in the browser's localStorage and are not shared between users or devices.

## Future backend integration plan

Each service documents the API it stands in for. Moving to a real backend means swapping these functions for `fetch` calls with the same input and output shapes:

| Mock function | Future endpoint | Future implementation |
|---|---|---|
| `getProducts()` / `searchProducts()` | `GET /api/products` | Retailer catalog / data warehouse |
| `getSegmentSummaries()`, `getProductSegmentBreakdown()` | `GET /api/segments`, `GET /api/segments/products/{id}` | Pandas RFM features → scikit-learn K-Means |
| `predictDemand()` | `POST /api/demand/predict` | XGBoost on product × time × segment features |
| `optimizePrice()` | `POST /api/optimize` | Python optimizer calling the demand service |
| `simulatePrice()` | `POST /api/simulate` | Two calls to the demand service |
| `getPortfolioRecommendations()` and related | `GET /api/portfolio/opportunities` | Batch-scored recommendations |
| `respond()` (Copilot) | `POST /api/copilot/chat` | Gemini or Claude with tool calls to the endpoints above |

Suggested backend: Python + FastAPI, with models trained offline. API keys stay on the server, never in this frontend.
