# WinMyDispute ChatGPT Builder Setup

## Builder URL
- https://chatgpt.com/gpts/editor

## GPT Basics
- Name: `WinMyDispute`
- Description: `Helps users assess credit-card disputes, preview likely reason codes, and generate a premium dispute kit after upgrade.`
- Visibility for now: `Private`

## Recommended Model
- Use the default recommended model in the GPT editor for now.
- Keep the GPT private until the action flow is fully tested.

## Instructions
- Paste the contents of:
  - `gpt-config/custom-gpt-instructions-builder.md`
- Keep `gpt-config/custom-gpt-instructions.md` as the full master copy in the repo.

## Capabilities
- Enable:
  - Web search
  - Code Interpreter & Data Analysis
- Leave Apps disabled.
- Use Actions, not Apps, for this GPT.

## Knowledge Uploads
- Upload these files from:
  - `/Users/danielneville/Documents/WinMyDispute-GPT-Knowledge-Pack`

### Upload first
- `README.md`
- `reference-data/chargeback_reason_codes_FULL_COMPILED.json`
- `templates/Credit_Card_Dispute_Cover_Summary_Template.docx`
- `templates/Credit_Card_Dispute_Evidence_Index_Template.docx`

### Upload second
- `examples/Download Chase_Dispute_Full_Package.pdf`
- `examples/SoFi_Dispute_Report_FINAL.docx`
- `examples/Amex_Modo_Dispute_Packet.pdf`
- `examples/DingDingDing_Amex_Dispute_Packet.pdf`
- `examples/Final_Dispute_Report_With_Exhibits.docx`

### Optional
- `instructions/WinmydisputeGPT Instructions 2.2.pages`

## Action Setup
- In the GPT editor, open `Configure` → `Actions`
- Import schema from:
  - `https://api.pure-plays.com/openapi.yaml`

## Action Authentication
- Authentication type: `API Key`
- Auth scheme: `Bearer`
- Secret value: use the same random value stored in Render as `OPENAI_BEARER`

## Action Notes
- The API base URL is:
  - `https://api.pure-plays.com`
- The live health check is:
  - `https://api.pure-plays.com/health`
- Premium routes require either:
  - `premiumAccessToken`
  - or the matching Stripe `sessionId` / `checkoutSessionId`

## Suggested Conversation Starters
- `I was charged for something I never received. Can you preview the best dispute reason?`
- `Help me figure out whether this charge sounds like fraud, a billing error, or a service dispute.`
- `I already paid. Help me generate the full dispute kit for this charge.`
- `I got denied after filing my dispute. Help me prepare a rebuttal response.`

## Test Flow
1. Ask for a free preview.
2. Confirm the GPT uses `/api/v1/disputes/preview`.
3. Ask for premium output.
4. Confirm the GPT asks for email and uses `/auth/check-license`.
5. If unpaid, confirm it returns a Stripe checkout URL.
6. After payment, confirm it exchanges the saved `sessionId` for `premiumAccessToken`.
7. Confirm premium routes work:
   - `/api/v1/generate-letter`
   - `/api/v1/generate-report-document`
   - `/api/v1/evidence/extract`
   - `/api/v1/denials/respond`
   - `/api/v1/cases`
   - `/api/v1/jobs/{jobId}`

## Publish Later
- If you ever want to publish publicly, add a valid Privacy Policy URL for the action and verify your domain in the builder profile first.
