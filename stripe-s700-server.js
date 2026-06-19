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

// ─── STEP 1: Start session — collect customer info on the S700 ───────────────

app.post('/start-session', async (req, res) => {
  try {
    const reader = await stripe.terminal.readers.collectInputs(READER_ID, {
      inputs: [
        {
          type: 'text',
          required: true,
          custom_text: {
            title: 'Full Name',
            description: 'Enter your name',
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
          type: 'text',
          required: true,
          custom_text: {
            title: 'Authorization',
            description: 'Card authorized for Gala purchases up to $10,000. Type your initials below to authorize.',
            submit_button: 'Submit',
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
          consentGiven: !!(results[3]?.text?.value?.trim()),
        };
        console.log('COLLECTED DATA:', response.collectedData);
      }
      if (action.type === 'process_setup_intent' || action.type === 'process_payment_intent') {
        response.intentId = action[action.type]?.setup_intent
          ?? action[action.type]?.payment_intent;
      }
    }

    res.json(response);
  } catch (err) {
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

    res.json({ customerId: customer.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── STEP 4a: Save card only (no charge) — SetupIntent ───────────────────────

app.post('/save-card', async (req, res) => {
  const { customerId } = req.body;
  if (!customerId) return res.status(400).json({ error: 'customerId required' });

  try {
    // Create a SetupIntent attached to the customer
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card_present'],
      usage: 'off_session', // saved card can be charged later without customer present
    });

    // Send the SetupIntent to the reader for card collection
    const reader = await stripe.terminal.readers.processSetupIntent(READER_ID, {
      setup_intent: setupIntent.id,
      allow_redisplay: 'always',
    });

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
  const { customerId } = req.body;
  if (!customerId) return res.status(400).json({ error: 'customerId required' });

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
    const reader = await stripe.terminal.readers.processPaymentIntent(READER_ID, {
      payment_intent: paymentIntent.id,
    });

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
      console.log(`✅ Card saved. Customer: ${si.customer}, PaymentMethod: ${si.payment_method}`);
      // Store si.payment_method against si.customer in your DB here
      break;
    }
    case 'payment_intent.succeeded': {
      const pi = event.data.object;
      console.log(`✅ $1 charged. Customer: ${pi.customer}, PaymentMethod: ${pi.payment_method}`);
      // The card is also saved to the customer at this point
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
