# S700 Card Registration — Implementation Guide

---

## What you're building

A web app that runs on your computer and controls a Stripe S700 reader. A staff member opens the UI in a browser, hits **Start Session**, and the S700 walks the customer through entering their name/email/phone and agreeing to the authorization terms. Staff then choose to save the card (no charge) or charge $1 and save. Everything is recorded in Stripe under a Customer record.

---

## Part 1 — Stripe Account Setup

### 1.1 Create a Stripe account
Go to [stripe.com](https://stripe.com) and sign up if you don't have an account.

### 1.2 Enable Stripe Terminal
1. In the Stripe Dashboard, go to **Terminal** in the left sidebar.
2. If prompted, click **Get started with Terminal** and follow the steps.

### 1.3 Register your S700 reader
1. Power on the S700 and connect it to Wi-Fi.
2. In the Dashboard go to **Terminal → Readers → + New reader**.
3. Select **S700**, then follow the pairing instructions (you'll enter a code displayed on the reader screen).
4. Once paired, click the reader in the list and copy its **Reader ID** — it starts with `tmr_`. Save this for later.

### 1.4 Get your API keys
1. In the Dashboard go to **Developers → API keys**.
2. Copy your **Secret key** (starts with `sk_live_` for live, `sk_test_` for test mode).

> **Tip:** Use test mode (`sk_test_...`) and a test reader while you're developing. You can simulate card taps without a real card.

---

## Part 2 — Install Required Software

### 2.1 Install Node.js
Download and install from [nodejs.org](https://nodejs.org) — choose the **LTS** version.

Verify it installed by opening Terminal (Mac) or Command Prompt (Windows) and running:
```
node --version
```
You should see a version number like `v20.x.x`.

### 2.2 Install the Stripe CLI
The Stripe CLI lets you receive webhook events on your local machine during development.

- **Mac:** `brew install stripe/stripe-cli/stripe`
- **Windows:** Download the installer from [stripe.com/docs/stripe-cli](https://stripe.com/docs/stripe-cli)

After installing, log in:
```
stripe login
```
A browser window will open — approve the connection.

---

## Part 3 — Set Up the Project

### 3.1 Create a project folder
Create a new folder anywhere on your computer, e.g. `s700-registration`. Open Terminal and navigate into it:
```
mkdir s700-registration
cd s700-registration
```

### 3.2 Create the folder structure
Inside `s700-registration`, create a subfolder called `public`:
```
mkdir public
```

Your folder should look like this:
```
s700-registration/
├── public/
```

### 3.3 Place the project files
Copy the two files you were given into the correct locations:

- `stripe-s700-server.js` → into `s700-registration/`
- `index.html` → into `s700-registration/public/`

Your folder should now look like:
```
s700-registration/
├── stripe-s700-server.js
└── public/
    └── index.html
```

### 3.4 Initialize the project and install packages
In Terminal, from inside `s700-registration`, run:
```
npm init -y
npm install express stripe dotenv
```

This creates a `package.json` and downloads the required libraries into a `node_modules` folder.

### 3.5 Create the `.env` file
In your `s700-registration` folder, create a file called `.env` (no filename, just the extension). Add the following — replacing the placeholder values with your real ones:

```
STRIPE_SECRET_KEY=sk_test_...
READER_ID=tmr_...
STRIPE_WEBHOOK_SECRET=whsec_...
PORT=3000
```

You'll fill in `STRIPE_WEBHOOK_SECRET` in the next step.

---

## Part 4 — Configure Webhooks

Stripe sends your server a notification when the reader finishes collecting a card. You need to set this up so your server knows when the customer's tap is complete.

### For local development (your laptop)

Open a **second Terminal window** (keep the first one for running the server) and run:
```
stripe listen --forward-to localhost:3000/webhook
```

You'll see output like:
```
> Ready! Your webhook signing secret is whsec_abc123...
```

Copy that `whsec_...` value and paste it into your `.env` file as `STRIPE_WEBHOOK_SECRET`. Then save the file.

Leave this Stripe CLI window running whenever you're testing.

### For production (live events)

When you're ready to go live, you'll deploy the server to a hosting service (see Part 6) and register a webhook in the Stripe Dashboard:
1. Go to **Developers → Webhooks → + Add endpoint**.
2. Enter your server's public URL + `/webhook`, e.g. `https://your-app.com/webhook`.
3. Under **Events to listen to**, select:
   - `terminal.reader.action_succeeded`
   - `terminal.reader.action_failed`
   - `setup_intent.succeeded`
   - `payment_intent.succeeded`
4. Click **Add endpoint**, then copy the **Signing secret** into your `.env`.

---

## Part 5 — Run and Test

### 5.1 Start the server
In Terminal (from inside `s700-registration`), run:
```
node stripe-s700-server.js
```

You should see:
```
Server running on port 3000
```

### 5.2 Open the UI
Open a browser and go to:
```
http://localhost:3000
```

You'll see the Card Registration interface.

### 5.3 Run through the flow

1. Make sure the S700 is powered on, connected to Wi-Fi, and showing the Stripe idle screen.
2. Click **Start Session on Reader** — the S700 should display the name/email/phone form within a few seconds.
3. Fill in the form on the reader screen. On the last screen, select "I Agree to the Terms and Conditions."
4. The browser UI will automatically detect the form was completed and show the collected info.
5. Click **Create Customer** — this saves the customer to Stripe.
6. Choose either:
   - **Tap to Save Card (no charge)** — customer taps, card is saved, $0 charged.
   - **Charge $1.00 & Save Card** — customer taps, $1 is charged and card is saved.
7. The S700 will prompt the customer to tap their card.
8. On success, the browser shows a confirmation screen.

### 5.4 Verify in Stripe Dashboard
Go to **Customers** in your Stripe Dashboard — you should see the new customer with a saved payment method attached.

---

## Part 6 — Going Live

When you're ready to use this at the actual event:

### 6.1 Switch to live mode
- Replace `sk_test_...` in your `.env` with your live secret key (`sk_live_...`).
- Re-register your S700 in **live mode** (the reader you registered in test mode won't work in live mode — you need to pair it again under live mode in the Dashboard).
- Update `READER_ID` in `.env` with the live-mode reader ID.

### 6.2 Deploy the server (optional but recommended)
Running the server on your laptop works for testing, but for a real event you may want it hosted so it keeps running even if your laptop goes to sleep.

Easy free/cheap options:
- **Railway** ([railway.app](https://railway.app)) — drag your folder in, it deploys automatically.
- **Render** ([render.com](https://render.com)) — connect your GitHub repo and deploy.

Both support environment variables so you can enter your `.env` values securely in their dashboard instead of in a file.

### 6.3 Make sure the S700 and your computer are on the same network
For the server-driven integration to work, both the server and the S700 need to be able to reach Stripe's API. They don't need to be on the same local network — they both talk to Stripe independently — but both need internet access.

---

## Troubleshooting

**Reader isn't responding after clicking Start Session**
- Check the reader is online in Stripe Dashboard → Terminal → Readers (should show a green dot).
- Make sure `READER_ID` in `.env` matches exactly.
- Restart the server and try again.

**Webhook events not arriving**
- Make sure the `stripe listen` command is still running in the second Terminal window.
- Check `STRIPE_WEBHOOK_SECRET` in `.env` matches the `whsec_...` value printed by the CLI.

**"Invalid API Key" error**
- Double-check `STRIPE_SECRET_KEY` in your `.env` — make sure there are no extra spaces.
- Make sure you're not mixing test and live keys.

**Customer taps card but nothing happens**
- Wait a few seconds — the UI polls every 2 seconds.
- Check the Terminal window running the server for any error messages.
