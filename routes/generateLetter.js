// routes/generateLetter.js (Fully Optimized with Paywall Check + Testable Export)
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import pdf from 'html-pdf-node';
import { fileURLToPath } from 'url';
import { getReasonDetails } from '../services/reasonService.js';
import crypto from 'crypto';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INTAKES_FILE = path.join(process.cwd(), 'mock-data', 'completed_intakes.json');

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const tones = {
  formal: {
    greeting: 'Dear Disputes Department,',
    opener: 'I am writing to formally dispute',
    closing: 'Thank you for your time and prompt attention to this matter.',
    request: 'I respectfully request this charge be reversed and credited back to my account.'
  },
  assertive: {
    greeting: 'To Whom It May Concern,',
    opener: 'I dispute',
    closing: 'I expect a resolution without delay.',
    request: 'Reverse this charge immediately and confirm back to me.'
  },
  polite: {
    greeting: 'Hello Disputes Team,',
    opener: 'I would like to dispute',
    closing: 'I appreciate your assistance with this issue.',
    request: 'Please reverse this charge and let me know if you need anything else.'
  }
};

async function requirePro(req, res, next) {
  try {
    const email = req.user?.email;
    if (!email) return res.status(403).json({ error: 'Email required for license check' });

    const paidFile = path.resolve('./mock-data/paidUsers.json');
    const raw = await fs.readFile(paidFile, 'utf8');
    const paid = JSON.parse(raw);
    if (!paid.includes(email)) {
      return res.status(403).json({ error: 'Upgrade required to access this feature.' });
    }

    next();
  } catch (err) {
    console.error('❌ License check error:', err.message);
    return res.status(500).json({ error: 'License verification failed' });
  }
}

router.post(
  '/api/v1/generate-letter',
  express.json(),
  requirePro,
  asyncHandler(async (req, res) => {
    if (!req.redis?.isOpen) {
      return res.status(503).json({ error: 'Redis unavailable' });
    }

    const { sessionId, generatePdf = false, tone = 'formal' } = req.body;
    if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 100) {
      return res.status(400).json({ error: 'Invalid or missing sessionId.' });
    }

    const intake = await loadIntakeBySession(sessionId, req);
    if (!intake) return res.status(404).json({ error: 'Session ID not found.' });

    const { question11: disputeDetails = '' } = intake.answers || {};

    // Use recommendedReasons if available, otherwise run semantic matcher
    let matches = [];
    if (intake.recommendedReasons?.length) {
      matches = intake.recommendedReasons;
    } else {
      const { matchReasonCodes } = await import('../services/semanticMatcher.js');
      matches = await matchReasonCodes(disputeDetails);
    }

    // Auto-select best match (use cardBrand if available)
    const preferred = intake.answers?.cardBrand?.toLowerCase();
    const matchedReason = matches.find(m => m.network === preferred) || matches[0] || null;

    intake.matchedReason = matchedReason; // inject selected reason into intake
    const successScore = estimateSuccessScore(intake);
    const letterHtml = await buildLetterHtml(intake, tone);
    if (generatePdf) {
      return generatePdfResponse(letterHtml, res);
    } else {
      return res.json({ letter: letterHtml, successScore });
    }
  })
);

router.get(
  '/api/v1/preview-letter/:sessionId',
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const tone = req.query.tone || 'formal';

    const intake = await loadIntakeBySession(sessionId, req);
    if (!intake) return res.status(404).send('Session not found.');

    try {
      const paidFile = path.resolve('./mock-data/paidUsers.json');
      const raw = await fs.readFile(paidFile, 'utf8');
      const paid = JSON.parse(raw);
      const email = req.user?.email;
      if (!email || !paid.includes(email)) {
        return res.send(wrapHtml('<div style="filter: blur(6px); color: #888;">[🔒 Dispute Letter Preview Locked – Upgrade to Pro to view your letter]</div>'));
      }
    } catch (err) {
      console.error('❌ Preview license check failed:', err.message);
      return res.status(500).send('Preview unavailable');
    }

    const letterHtml = await buildLetterHtml(intake, tone);
    return res.send(wrapHtml(letterHtml));
  })
);

async function loadIntakeBySession(sessionId, req) {
  const redisKey = `session:${sessionId}`;
  if (req.redis?.isOpen) {
    const redisData = await req.redis.get(redisKey);
    if (redisData) return JSON.parse(redisData);
  }
  const data = await fs.readFile(INTAKES_FILE, 'utf-8');
  const intakes = JSON.parse(data || '[]');
  return intakes.find(i => i.sessionId === sessionId);
}

async function buildLetterHtml(intake, tone) {
  const { answers, matchedReason, userIssuer } = intake;
  const {
    question1: userName = '[Your Name]',
    question2: userAddress = '[Your Address]',
    question3: userCityStateZip = '[City, State, ZIP]',
    question4: userPhone = '[Phone Number]',
    question5: userEmail = '[Your Email]',
    question6: merchantName = 'the merchant',
    question7: rawAmount,
    question8: date = 'the transaction date',
    question11: evidenceSummaryRaw = ''
  } = answers;

  const amount = rawAmount ? `$${rawAmount}` : 'the transaction amount';
  const evidenceSummary = evidenceSummaryRaw.trim();
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const { greeting, opener, closing, request } = tones[tone] || tones.formal;

  const evidenceSection = evidenceSummary
    ? `I am providing supporting evidence including ${evidenceSummary}.`
    : 'Although I have limited supporting evidence available, the facts remain clear as outlined above.';

  const reasonCode = matchedReason?.code || '';
  const network = matchedReason?.network || '';
  // Use full strategy block if matchedReason is defined
  let reasonInfo;
  if (reasonCode) {
    const strategyMap = JSON.parse(await fs.readFile(path.resolve('mock-data/rebuttalStrategies.json'), 'utf-8'));
    const strategy = strategyMap?.[network]?.[reasonCode];
    reasonInfo = strategy
      ? {
          reasonCode,
          title: strategy.customerStrategy.slice(0, 80) + '...',
          description: `
            <ul>
              <li><strong>Merchant Rebuttals:</strong> ${strategy.commonMerchantRebuttals.join('; ')}</li>
              <li><strong>Strategy Tips:</strong> ${strategy.strategyTips.join('; ')}</li>
              <li><strong>Focus Your Evidence On:</strong> ${strategy.evidenceToFocusOn.join('; ')}</li>
            </ul>
            <p><strong>Suggested Argument:</strong> ${strategy.customerStrategy}</p>
          `
        }
      : { reasonCode: '', title: '', description: '' };
  } else {
    reasonInfo = { reasonCode: '', title: '', description: '' };
  }

  const issuerContact = getIssuerDisputeInfo(userIssuer);

  return `
<p><strong>${today}</strong></p>
<p><strong>${userName}</strong><br>
   ${userAddress}<br>
   ${userCityStateZip}<br>
   ${userPhone}<br>
   ${userEmail}</p>

<p><strong>Disputes Department</strong><br>
   ${issuerContact.name}<br>
   ${issuerContact.address}</p>

<h3 style="font-weight:bold; color:#2a3d66;">
  Subject: Dispute of Charge – ${merchantName} – ${date} – ${amount}
</h3>

<p>${greeting}</p>
<p>${opener} a <strong>${amount}</strong> charge made to <strong>${merchantName}</strong> on <strong>${date}</strong>.</p>

<h3 style="font-weight:bold; color:#2a3d66;">Supporting Evidence:</h3>
<p>${evidenceSection}</p>
<ul>
  <li><strong>Screenshots</strong> of order confirmation.</li>
  <li><strong>Emails</strong> confirming transaction and shipment issues.</li>
</ul>

<h3 style="font-weight:bold; color:#2a3d66;">Reason for Dispute:</h3>
<p>${opener} this dispute under <strong>${reasonInfo.reasonCode}${reasonInfo.title ? ` – ${reasonInfo.title}` : ''}</strong>.</p>
${reasonInfo.description ? `<p>${reasonInfo.description}</p>` : ''}

<h3 style="font-weight:bold; color:#2a3d66;">Request for Action:</h3>
<p>${request}</p>

<p>${closing}</p>
<p>Sincerely,</p>
<p><strong>${userName}</strong></p>
`.trim();
}

function estimateSuccessScore(intake) {
  const { matchedReason, answers = {} } = intake;
  const evidence = (answers.question11 || '').trim().length;
  const toneMultiplier = { formal: 1, assertive: 0.9, polite: 0.95 }[intake.tone || 'formal'];
  const reasonType = matchedReason?.category?.toLowerCase() || '';
  const reasonBase = reasonType.includes('fraud') ? 0.9 : reasonType.includes('duplicate') ? 0.85 : 0.8;

  let score = reasonBase * 100;
  if (evidence > 100) score += 5;
  if (evidence === 0) score -= 10;

  score *= toneMultiplier;
  return Math.round(Math.min(Math.max(score, 40), 95));
}

function wrapHtml(content) {
  return `
<html><head><meta charset="utf-8"><title>Dispute Letter</title></head>
<body style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;">
  <div style="padding:20px;">${content}</div>
</body></html>`;
}

function generatePdfResponse(letterHtml, res) {
  const html = wrapHtml(letterHtml);
  pdf.generatePdf({ content: html }, { format: 'A4' })
    .then(buffer => {
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename=dispute_letter.pdf'
      });
      res.send(buffer);
    })
    .catch(err => {
      console.error('❌ PDF error:', err);
      res.status(500).json({ error: 'Internal server error generating PDF.' });
    });
}

function getIssuerDisputeInfo(issuer) {
  const map = {
    'Chase':            { name: 'Chase Dispute Dept.',        address: 'P.O. Box 15299, Wilmington, DE 19850-5299' },
    'Capital One':      { name: 'Capital One Dispute Dept.',  address: 'P.O. Box 30285, Salt Lake City, UT 84130' },
    'Visa':             { name: 'Visa Chargeback Dept.',       address: '900 Metro Center Blvd, Foster City, CA 94404' },
    'Mastercard':       { name: 'Mastercard Dispute Dept.',    address: '2000 Purchase Street, Purchase, NY 10577' },
    'American Express': { name: 'AmEx Dispute Dept.',          address: 'P.O. Box 981540, El Paso, TX 79998' }
  };
  return map[issuer] || { name: 'Dispute Dept.', address: 'Please contact your card issuer for correct address.' };
}

export { requirePro }; // enable testing of paywall
export default router;
