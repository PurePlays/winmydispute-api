# WinMyDispute Knowledge Inventory

This file is a non-destructive inventory of older local materials that can still
improve the final WinMyDispute Custom GPT and API. It is not a source-of-truth
data file for runtime behavior. It exists so the strongest reference material is
easy to find and curate into a future GPT knowledge pack.

## Keep in the API

Structured, dynamic, and premium-sensitive logic should stay in the API:

- dispute preview and reason matching
- checkout and premium unlock state
- Stripe webhook fulfillment
- evidence extraction and OCR
- case storage and artifacts
- report, bundle, and denial-response generation
- outcome feedback and scoring

## Good candidates for GPT knowledge uploads

Stable reference material is usually better as GPT knowledge:

- issuer-specific dispute behavior notes
- historical reason code references
- example dispute packets and exhibit structures
- cover letter and evidence index templates
- older GPT operating instructions

## High-value local sources

### GPT instructions and legacy reference data

- `/Users/danielneville/Library/Mobile Documents/com~apple~CloudDocs/winmydispute-api-main/WinmydisputeGPT Instructions 2.2.pages`
- `/Users/danielneville/Library/Mobile Documents/com~apple~CloudDocs/winmydispute-api-main/disputegpt-rebuttal-api/chargeback_reason_codes_FULL_COMPILED.json`
- `/Users/danielneville/Library/Mobile Documents/com~apple~CloudDocs/winmydispute-api-main/chargeback_reason_codes_full.json`
- `/Users/danielneville/Library/Mobile Documents/com~apple~CloudDocs/winmydispute-api-main/chargeback_reason_codes.json`

### Templates

- `/Users/danielneville/Documents/Templates/Credit_Card_Dispute_Cover_Summary_Template.docx`
- `/Users/danielneville/Documents/Templates/Credit_Card_Dispute_Evidence_Index_Template.docx`

### Real dispute packet examples

- `/Users/danielneville/Documents/chase/Chase DDD/Chase_Dispute_Letter_DingDingDing.docx`
- `/Users/danielneville/Documents/chase/Download Chase_Dispute_Full_Package.pdf`
- `/Users/danielneville/Documents/Sofi dispute response/DISPUTE EVIDENCE REPORT.docx`
- `/Users/danielneville/Documents/Sofi/SoFi_Dispute_Report_FINAL.docx`
- `/Users/danielneville/Documents/Sofi/SoFi_Dispute_Email_Template.docx`
- `/Users/danielneville/Documents/Amex DDD/DingDingDing_Amex_Dispute_Packet.pdf`
- `/Users/danielneville/Documents/Modo:Amex/Amex_Modo_Dispute_Packet.pdf`
- `/Users/danielneville/Documents/CCC Arbitration/CCC-SOFI/Final_Dispute_Report_With_Exhibits.docx`

### Useful archives and backups

- `/Users/danielneville/Backups/WinMyDispute- ALL.zip`
- `/Users/danielneville/Backups/winmydispute-api_FINAL_BACKUP.zip`
- `/Users/danielneville/Backups/winmydispute-api_20251226_020001.zip`
- `/Users/danielneville/Library/Mobile Documents/com~apple~CloudDocs/winmydispute-api-main/disputegpt-rebuttal-api/winmydispute-api-main.zip`
- `/Users/danielneville/Library/Mobile Documents/com~apple~CloudDocs/winmydispute-api-main/disputegpt-rebuttal-api/disputegpt-rebuttal-api-main.zip`

## Best next curation pass

If we build a final GPT knowledge pack, prioritize:

1. `WinmydisputeGPT Instructions 2.2.pages`
2. `chargeback_reason_codes_FULL_COMPILED.json`
3. the two dispute template `.docx` files
4. 3-5 best example dispute packets across Chase, SoFi, Amex, and Modo
5. one archive only if it contains a source file not already preserved elsewhere

## Notes

- Do not upload secrets, API keys, or customer-private files to GPT knowledge.
- Do not treat old repo copies as canonical code.
- The canonical live codebase is now the `winmydispute-api` app, not the older
  separate rebuttal deployment.
