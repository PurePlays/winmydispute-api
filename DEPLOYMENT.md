# Deployment Notes

## Required Environment Variables
- `BASE_URL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `ARTIFACT_TOKEN_SECRET`
- `OPENAI_BEARER` or `OPENAI_BEARERS_JSON`

## Secret Guidance
- `ARTIFACT_TOKEN_SECRET` must be different from your Stripe webhook secret and GPT bearer token.
- Use at least 32 random bytes for each secret.
- Rotate GPT bearer tokens with `OPENAI_BEARERS_JSON` when possible instead of relying on a single static token forever.

## Generate Strong Secrets
Run:

```bash
npm run generate:secret
```

This prints a strong `base64url` secret suitable for `ARTIFACT_TOKEN_SECRET`, `OPENAI_BEARER`, or `ADMIN_API_TOKEN`.

## Recommended Production Baseline
- Use HTTPS.
- Put the app behind a reverse proxy or platform TLS terminator.
- Store the SQLite file and secure-storage directory on persistent disk if you are not yet moving to managed Postgres/object storage.
- Set `BASE_URL` to the exact public origin used by Stripe Checkout success and cancel redirects.

## Stripe Setup
1. Add your live `STRIPE_SECRET_KEY`.
2. Optionally set:
- `CHECKOUT_PRODUCT_NAME`
- `CHECKOUT_PRODUCT_DESCRIPTION`
- `CHECKOUT_PRODUCT_UNIT_LABEL`
- `CHECKOUT_PRODUCT_IMAGE_URL`

These control what the customer sees on the hosted Stripe Checkout page when the API creates sessions dynamically.

3. Create a webhook endpoint pointing to:

```text
https://your-domain.example/api/v1/stripe-webhook
```

4. Subscribe at minimum to:
- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`

5. Copy the Stripe webhook signing secret into `STRIPE_WEBHOOK_SECRET`.
6. Verify that the app health endpoint reports `status: "ok"`:

```text
GET /health
```

## GPT Action Setup
- Use the bearer token you configured in `OPENAI_BEARER` or one of the rotated tokens in `OPENAI_BEARERS_JSON`.
- Prefer `OPENAI_BEARERS_JSON` in production so the GPT token can be route-scoped instead of acting as one global bearer forever.
- Example scoped bearer config for the Custom GPT:

```json
[
  {
    "tokenId": "winmydispute-gpt",
    "token": "replace-with-a-strong-random-secret",
    "allow": [
      "GET /auth/check-license",
      "GET /api/v1/issuers/:issuer/profile",
      "GET /api/v1/reasons/search",
      "GET /api/v1/cases",
      "GET /api/v1/cases/:caseId",
      "GET /api/v1/jobs/:jobId",
      "POST /api/v1/intake/normalize",
      "POST /api/v1/disputes/preview",
      "POST /api/v1/create-checkout-session",
      "POST /api/v1/generate-letter",
      "POST /api/v1/generate-report-document",
      "POST /api/v1/generate-submission-bundle",
      "POST /api/v1/denials/respond",
      "POST /api/v1/evidence/extract",
      "POST /api/v1/evidence/quality-score",
      "POST /api/v1/disputes/estimate-success",
      "POST /api/v1/disputes/outcome-feedback"
    ]
  }
]
```

- Keep the Custom GPT action spec in sync with [openapi.gpt.yaml](/Users/danielneville/Downloads/winmydispute-api-canonical/gpt-config/openapi.gpt.yaml).
- Artifact download URLs are signed and expiring; if a link expires, regenerate the report or bundle from the saved case.

## Before Going Live
- Confirm `/health` shows no missing required env vars.
- Confirm your Stripe Checkout branding is correct. Stripe product-catalog fields do not automatically control this API's dynamic Checkout sessions unless you also set the `CHECKOUT_PRODUCT_*` env vars.
- Run:

```bash
npm test
```

- Create one test checkout in the deployed environment.
- Replay a Stripe webhook event to confirm the email license is marked `paid`.
- Generate one premium report, one submission bundle, and one evidence extraction job end to end.
