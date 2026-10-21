# International Etsy shipping — phased rollout (not enabled)

## Current state
- Captured Sensaria GO Basic shipping table: `config/shipping-rates.json`, reconciled with the 2026-10-07 snapshot in `config/sensaria-shipping.json` (the rate groups agree). Rates remain **captured supplier estimates**, not confirmed checkout costs, taxes or delivery guarantees for every current SKU/country.
- Existing shop shipping profile: `config/etsy-shipping-profile.json`. It is free shipping to the explicitly listed existing countries.
- The International Shipping Planner is at `/international-shipping`, preview API `GET /api/international-shipping/preview`. It has **no write endpoints**, and does not change Etsy listings, prices or profiles.
- Each planner also includes an **Audit an existing Etsy listing** form using `GET /api/international-shipping/listing-audit`: it reads the real listing and inventory, limits estimates to enabled/in-stock supplier-mapped SKUs, reports country shipping exposure and missing rates, and does not edit Etsy.
- A verified USD-to-shop-currency FX rate is optional for estimates, but required before any non-USD shipping profile charge could be proposed. A single-profile first-item estimate does **not** calculate Etsy's additional-item charge.
- Illustrative 40×60 framed canvas, Sensaria Basic rate: mainland US $0, UK $0, Canada $75, Germany $75, Australia $5, New Zealand $150, Japan $600. These are NOT fully landed costs.

## Critical Etsy limitation
An Etsy listing has one shipping profile, shared by all sizes, poster/canvas variants, and framing options within that listing. There is no variation-specific shipping-profile charge. A shipping profile that charges the 5×7 poster rate can make a 40×60 framed canvas unprofitable. Choose one of:
1. **Split listing groups** by product/shipping tier and assign the corresponding shipping profile to each group, after creating separate Etsy listings with media, SKU and SEO preserved.
2. **One conservative profile per mixed-size listing** using each destination's highest cost among all enabled variants. This is safe from shipping undercharges when all rates exist, but can overcharge buyers of small art.
3. Absorb cross-tier differences in sale prices, but verify margins individually, especially for the 25% promotional discount.

## Launch prerequisites (check each before requesting a live update)
- Confirm **Sensaria can actually produce and deliver every enabled format/size** in each target country. Shipping zone coverage alone does not prove service or product availability.
- Verify fulfillment origin country for each route, and update Etsy's shipment origin accordingly. The existing default **CA origin may not match Sensaria's true print facility**.
- Confirm real shipping/tax/duty totals in supplier checkout or live quote. Never use unknown or null values as zero.
- Verify shop currency and international exchange costs. The captured supplier rates and planner output are in **USD**; Etsy shipping-profile primary/secondary costs use the **Etsy shop's own default currency**.
- Confirm additional-item (secondary) shipping fees. Sensaria captured rates are **per item**; Etsy shipping charges on multi-item orders may differ.
- Confirm Alaska/Hawaii: Sensaria uses zone 3A, whereas the Etsy shipping profile often only has a single USA country-level destination.
- Verify manufacturer/production partner disclosures, product compliance, EU/EEA/NI GPSR and responsible operator requirements when applicable.
- Verify packaging Extended Producer Responsibility (e.g. German/France registrations) and other required destination-market registrations.
- Confirm import duties and collection terms (DDP/DDU/DAP), Etsy-collected VAT/IOSS handoff, carrier customs forms, tariff classification, and any buyer-paid charges.
- Verify local sales taxes (Sensaria checkout vs Etsy-collected tax must not be conflated), plus Canada GST/HST/PST as applicable.
- Get realistic country/zone-specific **production + transit delivery windows**. The current 2–6-day profile should not be copied worldwide without validation.
- Verify damaged/lost parcel replacement, insurance, returns, refund exposure, remote-region surcharges, and shipment tracking.

## Proposed phased activation, requiring explicit operator approval
1. Read the shop's existing profiles and listing-to-profile mappings using Etsy's read-only API; back up those exact responses to R2 for a rollback plan.
2. Choose the geographic markets, size/product tiers, fee reserve, shipping buffer, price policy, and excluded territories. Prefer a small pilot before broad activation.
3. Prepare a **per-listing diff** of all intended shipping profile changes, checking each enabled variant, real shipping cost, supplier tax, promotional sale price, and minimum contribution margin.
4. Ask for a separate exact confirmation of the list of profiles and listings. Make updates **idempotent** (reuse managed profiles) and verify each result with Etsy readback.
5. Release a few low-risk markets, observe purchases/fulfillment and buyer charges, then expand in batches. Any unknown tax, product, compliance or territory status blocks activation.

## Safety policy
Do not add an "Everywhere Else" destination or enable a country simply because it appears in Sensaria's captured shipping table. Do not create or modify live Etsy listings, profiles or checkout settings from a preview action. Do not assert current market profitability without current supplier checkout costs and applicable Etsy fees.

## Useful Etsy references
- Etsy Open API, shipping profiles and destination-specific costs: https://developers.etsy.com/documentation/tutorials/listings/
- Etsy GPSR (EEA/Northern Ireland): https://help.etsy.com/hc/en-us/articles/28211364687383-What-is-the-General-Product-Safety-Regulation-GPSR
- Etsy customs/tax guidance: https://help.etsy.com/hc/en-us/articles/360000337247-Custom-Fees-and-Physical-VAT-Collection
- Etsy Germany EPR: https://help.etsy.com/hc/en-us/articles/42466548931479-Extended-Producer-Responsibility-EPR-in-Germany
