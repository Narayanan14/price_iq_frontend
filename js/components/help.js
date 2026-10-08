// Help / About content: demo journey, architecture and transparency notes.

import { openModal } from './modal.js';
import { getDataset } from '../services/product-service.js';
import { APP_VERSION } from '../data/seed-data.js';
import { fmtDate, fmtNum } from '../utils.js';
import { navigate } from '../router.js';

export function openHelpModal() {
  const ds = getDataset();
  openModal({
    title: 'About PriceIQ · Methodology',
    size: 'modal-lg',
    body: `
      <p class="modal-lead"><strong>PriceIQ</strong> is an interactive prototype of an AI-powered retail pricing optimization engine, built for the NIQ internal hackathon. It recommends <em>one</em> selling price per product — it is not personalised pricing.</p>
      <div class="help-grid">
        <section>
          <h3>Suggested demo journey</h3>
          <ol class="help-steps">
            <li><strong>Executive Overview</strong> — portfolio performance and opportunities.</li>
            <li><strong>Analyze</strong> a high-opportunity product → Price Optimization.</li>
            <li><strong>Simulate This Price</strong> → What-If Simulator; try other prices.</li>
            <li><strong>Demand Forecasting</strong> — segment-level demand response.</li>
            <li><strong>Customer Intelligence</strong> — illustrative RFM segments.</li>
            <li><strong>Copilot</strong> — ask “Why is this price recommended?”</li>
          </ol>
        </section>
        <section>
          <h3>Proposed architecture</h3>
          <div class="arch">
            <span>Transactions</span><span>Cleaning &amp; features</span><span>RFM → K-Means segments</span><span>Product × time × segment features</span><span>XGBoost demand service</span><span>Optimization · Simulation</span><span>GenAI Copilot</span>
          </div>
          <p class="muted small">In this prototype each stage is a deterministic browser-side mock with an interface shaped like the future API.</p>
        </section>
      </div>
      <section>
        <h3>Methodology</h3>
        <div class="method-grid">
          <div class="method"><strong>1 · Synthetic data</strong><p>${fmtNum(ds.products.length)} products across ${ds.categories.length} demonstration categories, ${fmtNum(ds.meta.generatedRecords)} product × week × segment sales records (${fmtDate(ds.meta.historyStart)} – ${fmtDate(ds.meta.asOf)}) and ${fmtNum(ds.customers.length)} customers, generated in the browser from a fixed seed. Every total is aggregated from those records.</p></div>
          <div class="method"><strong>2 · Illustrative demand response</strong><p>Demand per segment = baseline weekly units × seasonal index over the horizon × (price ÷ current price)<sup>−elasticity</sup>. Segment elasticities are assumptions, not estimates. Units sold are capped at stock on hand (no replenishment).</p></div>
          <div class="method"><strong>3 · Deterministic optimization</strong><p>A grid search evaluates candidate prices from −20% to +30% (never below unit cost, within any user constraints) and selects the highest expected gross profit. The same inputs always give the same answer.</p></div>
          <div class="method"><strong>4 · Future integration</strong><p>K-Means on real RFM features replaces the illustrative segments; an XGBoost demand model replaces the response curve behind the same <code>predictDemand()</code> interface; an LLM (e.g. Gemini or Claude) replaces the intent router, calling these services as tools.</p></div>
        </div>
      </section>
      <section class="transparency">
        <h3>What this prototype does not claim</h3>
        <ul>
          <li>No production XGBoost model is running — forecasts are an <strong>illustrative demand forecast</strong>.</li>
          <li>No K-Means model has been trained on real customer records — segments are illustrative RFM-style groups.</li>
          <li>The Copilot is a <strong>guided Copilot demo</strong> with deterministic intent routing; no live LLM is connected.</li>
          <li>No real-time competitor prices or actual retailer inventory feeds are connected.</li>
          <li>Uplift figures are <strong>estimated profit opportunities</strong> from simulated assumptions, not validated business impact.</li>
          <li>Data is inspired by the structure of the UCI Online Retail dataset, but no real transactions are used.</li>
        </ul>
      </section>
      <p class="muted small">Version ${APP_VERSION} · Static HTML/CSS/JS · Plotly.js · Lucide</p>`,
    actions: [
      { label: 'Close' },
      { label: 'Start demo journey', variant: 'btn-primary', onClick: (close) => { close(); navigate('overview'); } },
    ],
  });
}
