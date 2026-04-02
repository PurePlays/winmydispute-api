# WinMyDispute ChatGPT Builder Setup

## Builder URL
- [https://chatgpt.com/gpts/editor](https://chatgpt.com/gpts/editor)

## GPT Basics
- Name: `WinMyDispute`
- Description: `Helps users assess credit-card disputes, preview likely dispute categories, and generate a premium dispute kit after upgrade.`
- Visibility during testing: `Only me` or `Anyone with the link`
- Do not publish to the GPT Store until the live paid flow, evidence extraction, and privacy copy are rechecked.

## Recommended Model
- Use `GPT-5.4 Thinking`

## Instructions
- Paste the contents of:
  - `/Users/danielneville/Downloads/winmydispute-api-canonical/gpt-config/custom-gpt-instructions-builder.md`
- Keep `/Users/danielneville/Downloads/winmydispute-api-canonical/gpt-config/custom-gpt-instructions.md` as the full master copy in the repo.

## Capabilities
- Enable:
  - Actions
- Disable:
  - Web Search
  - Code Interpreter & Data Analysis
  - Canva
  - Image Generation

## Knowledge Uploads
- Default for testing: leave Knowledge empty.
- Safe optional uploads:
  - blank internal templates you created for this product
  - public reference material you would be comfortable exposing to users
- Do not upload:
  - real customer dispute packets
  - internal strategy docs
  - prompt files
  - secrets
  - raw examples containing sensitive personal data

## Action Setup
- In the GPT editor, open `Configure` → `Actions`
- Import schema from:
  - [https://api.pure-plays.com/openapi.gpt.yaml](https://api.pure-plays.com/openapi.gpt.yaml)
- If URL import fails, paste the contents of:
  - `/Users/danielneville/Downloads/winmydispute-api-canonical/gpt-config/openapi.gpt.yaml`

## Action Authentication
- Authentication type: `API Key`
- Auth scheme: `Bearer`
- Render env uses:
  - `OPENAI_BEARERS_JSON`
- GPT action secret must be the single scoped token value inside that JSON, not the whole JSON blob.

## Action Notes
- API base URL:
  - [https://api.pure-plays.com](https://api.pure-plays.com)
- Health check:
  - [https://api.pure-plays.com/health](https://api.pure-plays.com/health)
- Premium routes require either:
  - `premiumAccessToken`
  - or the matching Stripe `sessionId` / `checkoutSessionId`

## Suggested Conversation Starters
- `I was charged for something I never received. Can you preview the best dispute reason?`
- `Help me figure out whether this sounds like fraud, a billing error, or a service dispute.`
- `I already paid. Help me generate the full dispute kit for this charge.`
- `I got denied after filing my dispute. Help me prepare a rebuttal response.`

## Live Test Flow
1. Ask for a free preview with normal user language.
2. If issuer/network is missing, confirm the GPT asks one short follow-up.
3. Confirm the GPT uses `/api/v1/disputes/preview`.
4. Ask for premium output.
5. Confirm the GPT asks for email and uses `/auth/check-license`.
6. If unpaid, confirm it returns a live Stripe checkout URL from `/api/v1/create-checkout-session`.
7. After payment, confirm it exchanges the saved `sessionId` for `premiumAccessToken`.
8. Confirm premium routes work:
   - `/api/v1/generate-letter`
   - `/api/v1/generate-report-document`
   - `/api/v1/generate-submission-bundle`
   - `/api/v1/evidence/extract`
   - `/api/v1/denials/respond`
   - `/api/v1/cases`
   - `/api/v1/jobs/{jobId}`

## Privacy Policy
- Action privacy URL:
  - [https://www.pure-plays.com/privacy](https://www.pure-plays.com/privacy)

## Release Notes
- Keep one source of truth:
  - `/Users/danielneville/Downloads/winmydispute-api-canonical`
- Do not use the older `winmydispute-api-main` repo as release guidance.
