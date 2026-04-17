# Contact Enrichment Playbook

This is the tracked, repo-safe version of the Italian ICP contact-enrichment workflow.

## Goal

Enrich CRM-exported contacts into an outreach-ready file with:

- verified LinkedIn profile URL
- current headline and current employer
- current-role vs CRM-company match status
- location and influence signals
- recent-activity signal
- deterministic score and rationale

This workflow is designed for batch CSV inputs such as `.context/italian-icp-contacts-424.csv`, but the runtime code must not depend on `.context`.

## Inputs

Expected CSV columns:

- `Full Name`
- `First Name`
- `Last Name`
- `Company`
- `Market`
- `Email`
- `Title`
- `Functional Area`
- `Management Level`
- `Language`

## Verified Provider Contract

### Fiber primary lookup

Endpoint:

- `POST https://api.fiber.ai/v1/email-to-person/single`

Auth:

- pass `apiKey` in the JSON body
- do not commit the live key; use `FIBER_API_KEY`

Verified response shape:

- top-level result is `output.data`, not `data`
- `output.data` is an array of candidate profiles
- the usable LinkedIn URL is typically `url`
- if `url` is absent, fall back to `primary_slug`
- do not construct profile URLs from `entity_urn`

Useful fields observed in the live response:

- `first_name`
- `last_name`
- `headline`
- `url`
- `primary_slug`
- `entity_urn`
- `follower_count`
- `connection_count`
- `industry_name`
- `inferred_location`
- `experiences[]`
- `articles[]`

### Firecrawl fallback

Use Firecrawl search only when Fiber misses or when you need a best-effort profile URL candidate.

Official docs:

- https://docs.firecrawl.dev/api-reference/v2-endpoint/search

Endpoint:

- `POST https://api.firecrawl.dev/v2/search`

Auth:

- `Authorization: Bearer <FIRECRAWL_API_KEY>`

Recommended query:

```text
"<First Name> <Last Name>" "<Company>" site:linkedin.com/in/
```

Recommended request body:

```json
{
  "query": "\"Giulia Cuccolini\" \"Reckitt\" site:linkedin.com/in/",
  "limit": 5,
  "country": "IT",
  "location": "Italy",
  "sources": [{ "type": "web" }]
}
```

The response returns `data.web[]` with `title`, `description`, and `url`.

## Match Logic

The weak point in this dataset is not profile lookup. It is current-company truth.

Rules:

- normalize company strings before comparing
- strip country suffixes like `(Italy)`
- strip legal suffixes like `spa`, `srl`, `ltd`, `inc`, `gmbh`
- treat aliases like `RB` and `Reckitt Benckiser` as `Reckitt`
- compare against all current experiences, not only one field

Use these match states:

- `same_company`
- `moved`
- `multi_current_conflict`
- `unknown`
- `not_found`

Why `multi_current_conflict` exists:

- some profiles expose more than one `is_current=true` role
- if one current role matches the CRM company and another does not, a simple boolean is not trustworthy

## Scoring

Clamp the score to `0..10`.

Positive signals:

- role/headline contains `analyst`, `analytics`, `insights`, `category`, `brand`, `marketing`, `shopper`, `consumer`
- role/title contains `director`, `vp`, `head`, `manager`, `lead`
- current industry is relevant to CPG/FMCG, retail, pharma, or consumer
- follower or connection count is `>= 500`
- recent activity in the lookback window
- current location is Italy

Negative signals:

- moved into clearly irrelevant verticals such as software-only, finance, banking, insurance, or consulting
- no usable match in any source

Also output:

- `signal_reasons`
- `enrichment_confidence`

## Outputs

The runner writes:

- `enriched-contacts.csv`
- `movers.csv`
- `summary.json`
- `checkpoint.json`

Recommended output columns:

- original CRM fields
- `linkedin_profile_url`
- `linkedin_headline`
- `current_title`
- `current_company`
- `current_companies`
- `company_match_status`
- `still_at_crm_company`
- `moved_to`
- `location_city`
- `location_country`
- `industry_name`
- `company_vertical`
- `follower_count`
- `connection_count`
- `has_recent_activity`
- `recent_activity_count`
- `recent_activity_latest_at`
- `signal_score`
- `signal_reasons`
- `enrichment_confidence`
- `enrichment_source`
- `notes`

## Runtime

Set env vars:

```bash
FIBER_API_KEY=...
FIRECRAWL_API_KEY=... # optional but recommended for fallback
```

Run:

```bash
pnpm enrich:contacts --input .context/italian-icp-contacts-424.csv --output-dir output/contact-enrichment
```

Dry-run a subset:

```bash
pnpm enrich:contacts --input .context/italian-icp-contacts-424.csv --limit 10 --output-dir output/contact-enrichment-sample
```

Faster resilient run:

```bash
pnpm enrich:contacts --input .context/italian-icp-contacts-424.csv --output-dir output/contact-enrichment --resume --concurrency 6 --fiber-rpm 90 --firecrawl-rpm 30 --retry-count 4 --flush-every 10
```

Resume:

```bash
pnpm enrich:contacts --input .context/italian-icp-contacts-424.csv --resume --output-dir output/contact-enrichment
```
