# Printful, Lumaprints and Gooten

The three suppliers added to the six existing ones (Sensaria, Prodigi, Artelo,
PrintShrimp, Printify, Gelato). They plug into the same places: the provider
registry and **Test** buttons (`/api/providers/test`), the Supplier Comparison
and Custom Size Lookup, landed-cost reserves, per-supplier estimated profit,
the order-endpoint inventory and Order Tracking.

| | Printful | Lumaprints | Gooten |
|---|---|---|---|
| API | v2, `https://api.printful.com` | v1 (open beta), `https://us.api.lumaprints.com/api/v1` | `https://api.print.io/api/v/5/source/api` |
| Credentials (Render) | `PRINTFUL_API_TOKEN` (private token); `PRINTFUL_STORE_ID` if the token is account-level | `LUMAPRINTS_API_KEY` + `LUMAPRINTS_API_SECRET` (Developer → API Keys); `LUMAPRINTS_STORE_ID` (a Standard Store) for orders; `LUMAPRINTS_SANDBOX=true` for the sandbox | `GOOTEN_RECIPE_ID`; `GOOTEN_PARTNER_BILLING_KEY` for price estimates and orders |
| Connection test (authenticated) | `GET /v2/stores` | `GET /stores` | `products` with the RecipeID, then `priceestimate` with the billing key (no order) |
| Products matched | Posters, Canvas, Framed Canvas from the catalog (framed posters excluded) | Fine art papers, 0.75"/1.25"/1.5" stretched canvas, framed canvas (any size within the subcategory limits) | Canvas wraps, framed canvas, posters for the destination country (framed prints excluded) |
| Product price | `GET /v2/catalog-products/{id}/prices` (USD; discounted price when given) | `POST /pricing/product` (exact size + options) | `productvariants` `PriceInfo` for the country |
| Shipping | `POST /v2/shipping-rates` (STANDARD, else cheapest) | `POST /pricing/shipping` (cheapest usable method; freight and 406 = not shipped) | `POST shippingprices` (Standard, else cheapest) |
| Orders (off) | Draft `POST /v2/orders` with `external_id`, then `POST /v2/orders/{id}/confirmation` | `POST /orders` with `externalId` | `POST orders` with `SourceId`, test mode unless `GOOTEN_LIVE_ORDERS=true` |
| Tracking | `GET /v2/orders/{id}/shipments` | `GET /orders/{orderNumber}` + `/shipments` | `GET orders?id=` (item shipments) |

## How quotes are made

- **Exact sizes only**, in either orientation: a 16x12 artwork uses a 12x16
  product; a 30x40 cm product is not a 12x16 in one. Square and panoramic sizes
  follow the same rule. Framed canvas is only ever matched with framed canvas,
  and frame colour must match (black, white, natural, brown).
- When a supplier has more than one matching product (paper types, canvas
  depths), the cheapest is used and the others are listed under
  `meta.alternatives`; the cell shows the material and canvas depth.
- Shipping is quoted to one **reference address per country**
  (`src/quote-destinations.mjs`; override with `QUOTE_REFERENCE_ADDRESSES`), so
  it matches the product and the destination; a buyer elsewhere in the country
  can pay a different rate. The quote's basis names the address.
- Every amount is converted to USD with the comparison's FX source when a
  supplier answers in another currency. Lumaprints' price responses carry no
  currency field; `LUMAPRINTS_PRICE_CURRENCY` (default `USD`) names it, and the
  record says so.
- A failed lookup never shows as $0 or as "not offered": the status says what
  failed (`invalid-credentials`, `rate-limited`, `api-unavailable`,
  `timed-out`, `price-unavailable`, `shipping-error`, `destination-unsupported`,
  `catalog-scan-error`…). A row where any supplier's lookup failed is
  `partial`, and its winner is only the cheapest verified supplier.
- Each supplier is scanned independently, with a time limit per request,
  retries with backoff for read requests and 429s, and quotes cached for six
  hours.

## Orders

Order creation is implemented but **not connected to any workflow** and stays
disabled until both `FULFILLMENT_LIVE_SUBMISSION_ENABLED` and the supplier's
`*_FULFILLMENT_ENABLED` are `true`. Order requests are never retried; Printful
and Lumaprints look up the external ID first and return the existing order,
and Gooten requires a duplicate check from the caller.

## Verification status

The provider documentation sites were not reachable from the development
environment, so the integrations were built from Printful's v2 OpenAPI types
(as published in a generated SDK), Gooten's official client and documentation
examples, and Lumaprints' documented endpoints, and tested with mocked
responses. **None of it has been run against the live APIs yet.** Before
relying on the numbers, press **Test** for each supplier and compare a few
quotes with the supplier's own calculator.
