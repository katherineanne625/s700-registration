/**
 * Stripe S700 — Path A: Server-Driven Terminal
 *
 * Flow:
 *   1. POST /start-session        → collect_inputs on reader (name, email, phone)
 *   2. GET  /reader-status/:id    → poll until inputs are collected
 *   3. POST /create-customer      → create Stripe Customer from collected data
 *   4a. POST /save-card           → SetupIntent  (tap to save, no charge)
 *   4b. POST /charge-and-save     → PaymentIntent $1 + setup_future_usage (charge + save)
 *   5. GET  /reader-status/:id    → poll until card action completes
 *
 * Prerequisites:
 *   npm install express stripe dotenv
 *
 * .env:
 *   STRIPE_SECRET_KEY=sk_live_...
 *   READER_ID=tmr_...              ← your S700 reader ID from Stripe Dashboard
 *   PORT=3000
 */

require('dotenv').config();
const express = require('express');
const Stripe = require('stripe');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const READER_ID = process.env.READER_ID;
const app = express();
app.use(express.json());
app.use(express.static('public')); // serves index.html at http://localhost:3000

// Airtable config
const AIRTABLE_TOKEN   = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE_ID = 'appaqKCU9D1HhgD1Q';
const AIRTABLE_TABLE_ID = 'tblgrufZlc3XufEbM';

// In-memory cache: customerId → { name, email, phone }
const customerCache = new Map();

async function writeToAirtable(data) {
  const { name, email, phone, cardSaved, consentGiven, feesAgreed } = data;

  // Use field IDs for reliability; omit phone if blank (phoneNumber type is strict)
  const fields = {
    'flddsCSJE3JJ4Cafy': name  || '',          // Cardholder Name
    'flddbKBD1o0ofOj0m': email || '',           // Email Address
    'fldpDXg4WCywf6bp6': cardSaved    === true, // Credit Card Saved?
    'fldWfMCES5H8hndSs': consentGiven === true, // Authorized to store card?
    'fldCVKfOUUa0kP4Qk': feesAgreed   === true, // Pay additional Fees?
  };
  if (phone) fields['fldIx4LTG7MVwRSbL'] = phone; // Phone Number (only if provided)

  console.log('📤 Writing to Airtable:', JSON.stringify({ name, email, phone, cardSaved, consentGiven }));

  try {
    const resp = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`,
      {
        method: 'POST',
        headers: {
          Authorization:  `Bearer ${AIRTABLE_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields }),
      }
    );
    if (!resp.ok) {
      const err = await resp.text();
      console.error('❌ Airtable write failed:', err);
    } else {
      console.log('✅ Airtable record created for', email);
    }
  } catch (err) {
    console.error('❌ Airtable fetch error:', err.message);
  }
}

// ─── List available readers ───────────────────────────────────────────────────

app.get('/readers', async (req, res) => {
  try {
    const readers = await stripe.terminal.readers.list({ limit: 20 });
    res.json(readers.data.map(r => ({
      id:     r.id,
      label:  r.label || r.id,
      status: r.status,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── STEP 1: Start session — collect customer info on the S700 ───────────────

app.post('/start-session', async (req, res) => {
  const readerId = req.body.readerId || READER_ID;
  try {
    const reader = await stripe.terminal.readers.collectInputs(readerId, {
      inputs: [
        {
          type: 'text',
          required: true,
          custom_text: {
            title: 'Full Name',
            description: 'Enter your name (Ex. Alex Smith, or Alex and Pat Smith)',
            submit_button: 'Next',
          },
        },
        {
          type: 'text',
          required: true,
          custom_text: {
            title: 'Email Address',
            description: 'Enter your email address',
            submit_button: 'Next',
          },
        },
        {
          type: 'text',
          required: false,
          custom_text: {
            title: 'Phone Number',
            description: 'Enter your phone number (optional)',
            submit_button: 'Next',
          },
        },
        {
          type: 'signature',
          required: true,
          custom_text: {
            title: 'Authorization',
            description: 'Card authorized for Gala purchases up to $10,000. Sign below to authorize.',
            submit_button: 'Next',
          },
        },
        {
          type: 'selection',
          required: false,
          custom_text: {
            title: 'Processing Fees',
            description: 'Optional - tap the option below to select.',
            submit_button: 'Submit',
          },
          selection: {
            choices: [
              { style: 'default', label: 'I agree to cover any fees associated with processing this payment.' },
            ],
          },
        },
      ],
    });

    res.json({ readerId: reader.id, status: reader.action?.status });
  } catch (err) {
    console.error('collect_inputs error:', JSON.stringify(err, null, 2));
    res.status(500).json({ error: err.message });
  }
});

// ─── STEP 2: Poll reader action status ───────────────────────────────────────
//
// Call this until action.status === 'succeeded' or 'failed'.
// On success, action.collect_inputs.results contains the submitted values.

app.get('/reader-status/:readerId', async (req, res) => {
  try {
    const reader = await stripe.terminal.readers.retrieve(req.params.readerId);
    const action = reader.action;

    if (!action) return res.json({ status: 'idle' });

    const response = { status: action.status, type: action.type };

    if (action.status === 'succeeded') {
      if (action.type === 'collect_inputs') {
        // Map results array to { name, email, phone }
        console.log('FULL ACTION:', JSON.stringify(action, null, 2));
        const results = action.collect_inputs?.inputs ?? [];
        console.log('RAW RESULTS:', JSON.stringify(results, null, 2));
        response.collectedData = {
          name:         results[0]?.text?.value ?? null,
          email:        results[1]?.text?.value ?? null,
          phone:        results[2]?.text?.value ?? null,
          consentGiven: !!(results[3]?.signature?.value),
          feesAgreed:   !!(results[4]?.selection?.value ?? results[4]?.selection?.choice?.label),
        };
        console.log('COLLECTED DATA:', response.collectedData);
      }
      if (action.type === 'process_setup_intent' || action.type === 'process_payment_intent') {
        response.intentId = action[action.type]?.setup_intent
          ?? action[action.type]?.payment_intent;

        // Write to Airtable now (don't wait for webhook)
        const readerKey = 'reader:' + req.params.readerId;
        const cachedCustomerId = customerCache.get(readerKey);
        if (cachedCustomerId) {
          const cached = customerCache.get(cachedCustomerId) || {};
          writeToAirtable({ ...cached, cardSaved: true, consentGiven: true });
          customerCache.delete(cachedCustomerId);
          customerCache.delete(readerKey);
        }
      }
    }

    res.json(response);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Log result to Airtable ──────────────────────────────────────────────────

app.post('/log-result', async (req, res) => {
  const { name, email, phone, cardSaved, consentGiven, feesAgreed } = req.body;
  try {
    await writeToAirtable({ name, email, phone, cardSaved, consentGiven, feesAgreed });
    res.json({ ok: true });
  } catch (err) {
    console.error('log-result error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── STEP 3: Create Stripe Customer ──────────────────────────────────────────

app.post('/create-customer', async (req, res) => {
  const { name, email, phone } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'name and email are required' });
  }

  try {
    const customer = await stripe.customers.create({
      name,
      email,
      phone: phone || undefined,
    });

    // Cache for use in webhook
    customerCache.set(customer.id, { name, email, phone: phone || null });

    res.json({ customerId: customer.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── STEP 4a: Save card only (no charge) — SetupIntent ───────────────────────

app.post('/save-card', async (req, res) => {
  const { customerId, readerId } = req.body;
  if (!customerId) return res.status(400).json({ error: 'customerId required' });
  const rid = readerId || READER_ID;

  try {
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card_present'],
      usage: 'off_session',
    });

    const reader = await stripe.terminal.readers.processSetupIntent(rid, {
      setup_intent: setupIntent.id,
      allow_redisplay: 'always',
    });

    // Store reader → customer mapping so /reader-status can write to Airtable
    customerCache.set('reader:' + rid, customerId);

    res.json({
      readerId: reader.id,
      setupIntentId: setupIntent.id,
      status: reader.action?.status,
      message: 'Prompt customer to tap card',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── STEP 4b: Charge $1 + save card — PaymentIntent ──────────────────────────

app.post('/charge-and-save', async (req, res) => {
  const { customerId, readerId } = req.body;
  if (!customerId) return res.status(400).json({ error: 'customerId required' });
  const rid = readerId || READER_ID;

  try {
    // Create a $1.00 PaymentIntent with setup_future_usage to save the card
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 100,           // $1.00 in cents
      currency: 'usd',
      customer: customerId,
      payment_method_types: ['card_present'],
      capture_method: 'automatic',
      setup_future_usage: 'off_session', // saves card after charge
    });

    // Send the PaymentIntent to the reader
    const reader = await stripe.terminal.readers.processPaymentIntent(rid, {
      payment_intent: paymentIntent.id,
    });

    // Store reader → customer mapping so /reader-status can write to Airtable
    customerCache.set('reader:' + rid, customerId);

    res.json({
      readerId: reader.id,
      paymentIntentId: paymentIntent.id,
      status: reader.action?.status,
      message: 'Prompt customer to tap card — $1.00 will be charged',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── WEBHOOK: Handle Terminal action completion ───────────────────────────────
//
// Stripe sends events when reader actions finish. Register this endpoint in
// your Stripe Dashboard under Developers → Webhooks.
//
// Key events:
//   terminal.reader.action_succeeded  → action is done
//   terminal.reader.action_failed     → something went wrong
//   payment_intent.succeeded          → charge confirmed (4b)
//   setup_intent.succeeded            → card saved (4a)

app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook error: ${err.message}`);
  }

  switch (event.type) {
    case 'setup_intent.succeeded': {
      const si = event.data.object;
      const cached = customerCache.get(si.customer) || {};
      console.log(`✅ Card saved. Customer: ${si.customer}`);
      writeToAirtable({ ...cached, cardSaved: true, consentGiven: true });
      customerCache.delete(si.customer);
      break;
    }
    case 'payment_intent.succeeded': {
      const pi = event.data.object;
      const cached = customerCache.get(pi.customer) || {};
      console.log(`✅ $1 charged. Customer: ${pi.customer}`);
      writeToAirtable({ ...cached, cardSaved: true, consentGiven: true });
      customerCache.delete(pi.customer);
      break;
    }
    case 'terminal.reader.action_failed': {
      const reader = event.data.object;
      console.error(`❌ Reader action failed:`, reader.action?.failure_message);
      break;
    }
  }

  res.json({ received: true });
});

// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
