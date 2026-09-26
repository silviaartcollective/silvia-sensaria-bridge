# Silvia Art Collective → Sensaria foundation

This repository is the isolated foundation for moving **Silvia Art Collective** Etsy fulfillment from Gelato to Sensaria.

## Storefront source

- Store: Etsy — Silvia Art Collective
- Product families:
  - Fine Art Print → `P`
  - Canvas → `C`
  - Framed Canvas → `FC`
- No Framed Poster family is included here.

## Current Silvia size ladder

`8x12, 11x14, 12x16, 12x18, 16x20, 16x24, 18x24, 24x36, 28x40, 30x40`

An additional large format is supported for Canvas and Framed Canvas:

`40x60`

The Sensaria manufacturing map currently covers:

- Fine Art Print: 11x14, 12x16, 12x18, 16x20, 16x24, 18x24, 24x36, 30x40
- Canvas: 12x16, 12x18, 16x20, 16x24, 18x24, 24x36, 30x40, 40x60
- Framed Canvas: the same eight canvas sizes in Black, White, Natural, and Brown

Unresolved before live migration:

- 8x12 — no current Sensaria mapping
- 28x40 — no current Sensaria mapping
- 11x14 Canvas / Framed Canvas — no current Sensaria mapping

These are deliberately left unresolved rather than substituted with a different size.

## Planned fulfillment flow

1. Etsy `order.paid` webhook fires.
2. App fetches the Etsy receipt and transactions.
3. Transaction SKU is parsed into artwork ID + product family + size + frame.
4. Manufacturing configuration is resolved from `config/products.json`.
5. Correct artwork output URL is resolved.
6. App writes a Sensaria GO Bulk Order CSV row.
7. CSV is uploaded/confirmed in Sensaria GO.
8. When tracking is available, the app posts carrier + tracking back to the Etsy receipt.

## Proposed SKU shape

`SAC####-FORMAT-SIZE[-FRAME]`

Examples:

- `SAC0042-P-1218`
- `SAC0042-C-2436`
- `SAC0042-C-4060`
- `SAC0042-FC-4060-BLK`
- `SAC0042-FC-4060-NAT`
- `SAC0042-FC-4060-DWD` → normalized to Sensaria Brown

## Next implementation step

Connect the Silvia Etsy Seller App with `transactions_r` and `transactions_w`, then test one real listing/receipt end-to-end before changing the rest of the catalog.
