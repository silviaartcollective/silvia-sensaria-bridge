# Supplier submission: what the app does, and the safeguards

## How a regular Etsy order moves today

1. **Import.** Every 5 minutes the app reads the shop's recent paid receipts
   from Etsy (`reconcileNewEtsyPaidOrders`) and stores each new one at
   `orders/etsy/<receipt>/receipt.json` in R2.
2. **Recommendation.** For a paid, unshipped, single-item order with a
   converted `SAC…` SKU, it quotes every supplier and stores the cheapest as
   the order's plan (`review.json`, status `awaiting_supplier_approval`,
   `submissionStatus: not_submitted`). This is the "identified as an Artelo
   order" step.
3. **Approval.** On Fulfillment Review you tick the four checks and approve:
   status `approved_for_manual_order`, `method: review_only`,
   `supplierOrderSubmitted: false`.
4. **Ordering.** Until now there was no step 4 for Artelo, Prodigi, Gelato,
   Printify or PrintShrimp: nothing in the app called their order APIs
   (`createArteloOrder` had no caller). Sensaria has its CSV download.
   An Artelo-recommended order therefore never reached Artelo unless it was
   ordered by hand.

`LIVE_ORDER_SUBMISSION` is **not read anywhere** in this app; setting it to
true or false changes nothing. The real switches are
`FULFILLMENT_LIVE_SUBMISSION_ENABLED` and `ARTELO_FULFILLMENT_ENABLED`, and
before this change they only guarded a function nothing called.

## What enabling the switches does

With this change, turning on `FULFILLMENT_LIVE_SUBMISSION_ENABLED` and
`ARTELO_FULFILLMENT_ENABLED`:

- does **not** submit older pending orders, retry anything, or process a
  backlog: no automatic code path submits orders (the Etsy sync and the
  automatic recommendation only prepare plans);
- does **not** submit without approval: each order also needs its receipt in
  `SUPPLIER_SUBMISSION_ALLOWED_RECEIPTS`, an approved Artelo plan, the typed
  confirmation `SUBMIT <receipt> TO ARTELO` and the "Artelo dashboard has no
  order for it" check;
- cannot send an order to two suppliers: the submission record fixes one
  supplier per receipt;
- excludes orders shipped or canceled on Etsy, manually ordered, linked to a
  supplier order in Order Tracking, recorded as fulfilled elsewhere, or
  assigned to Sensaria by a CSV download.

## Submission record

`fulfillment/submissions/<receipt>.json` in R2 keeps the order's supplier,
its states and the supplier's order ID:
`prepared → queued → submitting → submitted → accepted`, or `rejected`
(the supplier refused it; it may be sent again explicitly), `unknown` (a
timeout, outage or crash: the order may or may not exist at the supplier)
and `fulfilled_elsewhere`.

- "submitting" is stored **before** the request, so a crash shows as
  unknown, never as "not sent".
- The order request is made once (45-second limit) and never retried.
- An unknown outcome blocks any new submission until it is checked: **Check
  Artelo status** (when an Artelo order ID is known), or recording what the
  Artelo dashboard shows: found (with its order ID), or not found (typed
  `ARTELO DOES NOT HAVE <receipt>`).
- Duplicate protection does not depend on SKU prefixes: it uses the receipt's
  record, the Etsy receipt state, the review status, the supplier order ID and
  Order Tracking links. Simultaneous submissions of one receipt are refused
  (the service runs as one instance).

## Submitting one approved Artelo order

1. All Orders → select the order (or Fulfillment Review → enter the receipt)
   → **Diagnose this order**. Both pages show the same supplier-order panel.
2. **Preview Artelo order**: the exact product (IndividualArtPrint, Matte
   Poster, unframed, size, orientation; in an order Artelo reads the frame
   from frameColor, so Unframed is sent there), artwork, shipping address and Artelo's
   own price check (production, shipping, tax, total) of the same order input,
   artwork link included, as Artelo requires. No order is created.
   A price far from the approved quote blocks the submission.
3. Check the Artelo dashboard has no order for the receipt.
4. In Render set `FULFILLMENT_LIVE_SUBMISSION_ENABLED=true`,
   `ARTELO_FULFILLMENT_ENABLED=true` and
   `SUPPLIER_SUBMISSION_ALLOWED_RECEIPTS=<receipt>`.
5. Tick the dashboard check, type `SUBMIT <receipt> TO ARTELO`, press
   **Submit this order to Artelo**.
6. Afterwards set the two switches back to false and clear the receipt list.

## The order's supplier on All Orders

All Orders names the supplier each order's recommendation chose, and offers
that supplier's ordering step: Sensaria's CSV download, the Artelo panel
(Preview, Check status, Submit), or, for Prodigi, Gelato, Printify and
PrintShrimp, a note to place the order in that supplier's dashboard, since the
app has no order submission for them. Diagnose works for every order.

The order address carries the country code as both `country` (Artelo's order
validation requires it) and `countryCode` (its address object's field); Etsy
shares no buyer phone or email, so those are left out. Artelo asks for a phone number on
orders shipped outside the US, so a non-US order may be refused at Preview:
order it in the Artelo dashboard. When Artelo refuses a price check, Preview
shows Artelo's message and each field it rejected.

Artelo's order API needs a state/region; Etsy omits it for some countries,
which blocks the submission (order those by hand). Square artwork is held for
manual review.

## Etsy tracking for Artelo orders

With `ARTELO_AUTO_TRACKING_ENABLED=true`, every hour (while the service is
awake) the app looks at the orders it sent to Artelo (submission record
submitted or accepted, with an Artelo order ID, from the last 60 days):

1. links each one in Order Tracking to its Artelo order, if not linked yet;
2. asks Artelo for the order's shipments;
3. once Artelo reports it shipped with a tracking number, marks the Etsy
   order shipped with that tracking and carrier. Etsy emails the buyer.

It never touches an order sent to Artelo by hand, linked in Order Tracking to
another supplier or order, or already shown on Etsy as shipped (with any
tracking) or canceled, and marks each order shipped once.
`ETSY_SHIPMENT_SUBMISSION_ENABLED=false` also stops it. Each run is logged as
`[artelo tracking]` lines in Render. "Label created" is not "shipped": the
order is marked when Artelo reports it shipped.

## Without the receipt list

`SUPPLIER_SUBMISSION_ALLOWED_RECEIPTS=all` lets any approved Artelo order be
submitted from the app (Preview, dashboard check, typed confirmation) with no
Render change per order. A list of receipts still limits it to those.

## Automatic submission

With `ARTELO_AUTO_SUBMIT_ENABLED=true` and both live switches, every 15
minutes (while the service is awake) the app sends new paid orders whose
recommended supplier is Artelo, with no one approving them, when every check
passes:

- the order was placed after automatic submission was switched on (the time
  is recorded at startup; switching it off and on starts again from then), so
  older orders are never sent automatically;
- it is a new recommendation (awaiting approval) with no submission record of
  any kind, so an order sent, rejected, uncertain, given to Sensaria or
  fulfilled elsewhere is left to a person;
- Preview's checks: paid, not shipped or canceled, address complete with a
  state, artwork present and unchanged, and Artelo's price for the exact order
  within max($2, 15%) of the quote;
- fewer than `ARTELO_AUTO_SUBMIT_DAILY_LIMIT` orders (default 5) were sent
  automatically today.

An order that fails a check is held for a person (Fulfillment Review, as
before) and not checked again until it is quoted again. Each order is sent
once; an uncertain outcome is never retried. Runs are logged as
`[artelo auto-submit]` lines in Render.

