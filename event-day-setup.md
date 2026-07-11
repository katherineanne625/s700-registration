# Event Day Setup Instructions

The app runs in the cloud (Railway) so you don't need your laptop or Terminal running.
Anyone can use it from any device with a browser and internet connection.

---

## To Use the App

Open a browser on any device and go to:

**https://s700-registration-production.up.railway.app**

That's it. No setup required.

---

## If You Need to Run It Locally (Backup)

If the cloud version is unavailable, you can run it from your Mac laptop.

### What you need
- Your Mac laptop
- The `s700-registration` folder on your Desktop
- Internet connection

### Step 1 — Open two Terminal windows

Press **⌘+Space**, type **Terminal**, hit Enter.
Then press **⌘+N** to open a second Terminal window.

### Step 2 — Start the webhook listener (Window 1)

In the first Terminal window, run:
```
stripe listen --forward-to localhost:3000/webhook
```

You'll see a line like:
```
> Ready! Your webhook signing secret is whsec_...
```

Leave this window running.

### Step 3 — Start the server (Window 2)

In the second Terminal window, run:
```
cd ~/Desktop/s700-registration
node stripe-s700-server.js
```

You should see:
```
Server running on port 3000
```

Leave this window running.

### Step 4 — Open the app

Open a browser and go to:
```
http://localhost:3000
```

### Step 5 — Share with other devices on the same Wi-Fi

To let other devices (iPads, phones) on the same network use the app,
find your laptop's IP address by running this in Terminal:
```
ipconfig getifaddr en0
```

It will return something like `192.168.1.45`.
Other devices on the same Wi-Fi can then go to:
```
http://192.168.1.45:3000
```

---

## Keeping the App Running

- Both Terminal windows must stay open while using the local version
- If your laptop goes to sleep, the app will stop — keep it plugged in and awake
- The cloud version (railway.app URL) runs 24/7 with no laptop needed

---

## Troubleshooting

**"Reader is offline"**
Make sure the S700 is powered on and connected to Wi-Fi.
Check Stripe Dashboard → Terminal → Readers for a green dot.

**"Failed to fetch"**
The server isn't running. Go to Window 2 and run `node stripe-s700-server.js` again.

**App won't load at all**
Make sure both Terminal windows are running (steps 2 and 3 above).
