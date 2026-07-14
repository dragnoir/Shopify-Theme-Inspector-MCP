# Example Shopify homepage Liquid performance report

> [!NOTE]
> This is a fictional, sanitized example created to demonstrate the report format. It is not a profile of a real merchant, theme, app, or storefront.

- **Store:** `example-store.invalid`
- **Page:** `/`
- **Profile runs:** 3
- **Source:** Shopify Theme Inspector MCP v0.5.1

## Owner summary

The homepage's main Shopify Liquid cost is the featured-product area. The page repeatedly builds full product cards, image galleries, badges, prices, and color swatches before Shopify sends the HTML to the shopper.

Across three illustrative runs, total Liquid render time measured **184 ms**, **196 ms**, and **211 ms**, with a median of **196 ms**. The result is not an emergency, but the repeated product-card work is the clearest place to investigate before spending time on small filters or app blocks.

Recommended business decision: keep the featured collection, but ask the theme developer to render fewer products initially and use a lighter homepage version of the product card.

## Priorities

| Priority | Finding | Why it matters | Suggested owner decision |
|---|---|---|---|
| P0 | Featured collection renders 16 full product cards | Every card repeats gallery, badge, price, and swatch logic | Decide whether 6–8 initial products can meet the merchandising goal |
| P0 | Full image gallery is built for every card | Hidden gallery slides still create server work | Approve a compact homepage card with one primary and one hover image |
| P1 | Variant and swatch logic repeats across cards | Large variant catalogues multiply the work | Limit visible homepage swatches and keep full selection on product pages |
| P1 | Desktop and mobile card markup may be duplicated | Shopify may build both versions even when CSS hides one | Ask the developer to confirm whether one responsive structure can be shared |
| P2 | Review app block appears in the profile | It contributes some work but is not a leading bottleneck | Keep it unless later tests show a meaningful cost and low business value |

## Measurement summary

| Metric | Illustrative result | Interpretation |
|---|---:|---|
| Total Liquid render time | 184–211 ms | Stable enough to identify repeated hotspots |
| Median Liquid render time | 196 ms | Use as the before-change comparison point |
| `sections/featured-collection` | 58 ms, 29.6% | Largest section-level path |
| `snippets/product-card` | 46.8 ms, 23.9%, 96 events | Card work is repeated across products and layout branches |
| `snippets/card-gallery` | 29 ms, 14.8%, 480 events | Gallery/media work is multiplied inside cards |
| `snippets/card-swatches` | 14.1 ms, 7.2%, 224 events | Variant presentation adds nested repeated work |
| `sections/header` | 18.2 ms, 9.3% | Worth monitoring, but not the first fix |
| Example review app block | 4.3 ms, 2.2% | Small compared with the product-card path |

Parent and child timings can overlap. Do not add every percentage together and treat the total as guaranteed savings.

## Developer handoff

### P0 — Reduce the initial featured-product workload

**Evidence**

- `sections/featured-collection`, illustrative line 42: product loop renders 16 items.
- `snippets/product-card` appears 96 times across the profile.
- `snippets/card-gallery` records 480 nested events.

**Investigation**

- Confirm how many featured-collection sections and product cards are generated on the homepage.
- Check whether grid, carousel, desktop, and mobile versions generate duplicate Liquid markup.
- Reduce the initial product count to the smallest set that still supports merchandising.
- Consider loading below-the-fold collections later through Shopify's Section Rendering API.

**Risks to test**

- Carousel controls and swipe behavior.
- Product links, quick add, prices, badges, and analytics.
- Search-engine visibility and layout shift for deferred sections.

### P0 — Add a compact homepage product-card mode

**Evidence**

- The full gallery path is called from every featured product card.
- Media events are much higher than the visible number of cards.

**Investigation**

- Pass an explicit context such as `card_mode: 'compact'` from the homepage section.
- Render one featured image and, if required, one hover image.
- Avoid generating videos, hidden slides, and complete product-page gallery controls on listing cards.
- Calculate badge, selected variant, price, and compare-at price once per card and reuse the values.

**Risks to test**

- Hover-image behavior on desktop.
- Accessible image alternatives and card focus states.
- Sale prices, sold-out badges, localization, and quick-add behavior.

### P1 — Limit swatch and variant work

**Evidence**

- Swatch rendering records 224 events across the featured cards.
- Variant-related work is nested inside the repeated card path.

**Investigation**

- Show only a small number of swatches followed by a `+N` indicator.
- Resolve the selected or first-available variant once per card.
- Do not render swatches for products without a meaningful color option.

**Risks to test**

- Correct variant links and availability.
- Localized product URLs.
- Keyboard and screen-reader access.

## Recommended implementation order

1. Duplicate the live theme and record five controlled homepage profiles.
2. Reduce the number of initially rendered featured products.
3. Remove duplicated responsive or carousel card markup.
4. Introduce and test the compact homepage card mode.
5. Limit swatches and reuse calculated product values.
6. Re-run five profiles under comparable conditions.
7. Publish only after storefront, accessibility, analytics, and cart regression tests pass.

## Validation targets

- Median Liquid render time improves from the illustrative **196 ms** baseline.
- Product-card, gallery, and swatch event counts decrease materially.
- No regression in product links, prices, badges, swatches, quick add, localization, analytics, or responsive layout.
- The improvement remains visible across several runs rather than one unusually fast profile.

## Scope limitation

This report covers Shopify's **server-side Liquid rendering**. It does not directly measure browser JavaScript, image transfer size, fonts, third-party browser scripts, CLS, INP, or real-user LCP. Use Lighthouse, WebPageTest, or real-user monitoring alongside this report for a complete storefront performance assessment.
