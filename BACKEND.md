# Kassi Fleet backend

The backend uses Node.js built-in modules. Locally it serves the portals at `http://127.0.0.1:3000` and uses `data/kassifleet.json`. When `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set, accounts and tracked deliveries use Supabase PostgreSQL instead.

## Start

Install Node.js 18 or newer, open PowerShell in this folder, then run:

```powershell
npm start
```

Open `http://127.0.0.1:3000/apps/index.html` for the four-app hub. Use the server URL instead of opening the HTML files directly.

Customers and drivers can register with their name, email, and password. Registration stores an email address but does not send a verification message; sending email requires an SMTP provider and credentials.

## Free Render + Supabase setup

1. Create a Supabase free project and run `supabase-schema.sql` in its SQL Editor.
2. Copy the Supabase project URL and `service_role` key from Project Settings. Keep the key private.
3. In Render, create a Blueprint from this repository and use `render.yaml`. Enter `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` when prompted. Render generates `KF_TOKEN_SECRET` automatically.
4. After Render deploys `kassifleet-api`, copy its HTTPS URL into `apps/js/config.js`:

```js
window.KF_API_URL = "https://kassifleet-api.onrender.com";
```

5. Commit that config change to GitHub. GitHub Pages serves the app; the Render service handles login and cross-device delivery tracking.

The free Render web service sleeps after 15 minutes without traffic and can take about a minute to wake. Supabase Free has a 500 MB database and can pause after a week of inactivity. These limits make this a free demo/hobby setup, not an always-on production service. Render's free Postgres expires after 30 days, so this setup uses Supabase instead.

## Optional demo accounts

Set these environment variables before starting the server to seed accounts for the other existing portals. Each account is only added if its email is not already registered.

```powershell
$env:KF_CUSTOMER_EMAIL = "customer@example.com"
$env:KF_CUSTOMER_PASSWORD = "choose-a-long-password"
$env:KF_VENDOR_EMAIL = "vendor@example.com"
$env:KF_VENDOR_PASSWORD = "choose-a-long-password"
$env:KF_ADMIN_EMAIL = "admin@example.com"
$env:KF_ADMIN_PASSWORD = "choose-a-long-password"
npm start
```

For deployment, set `KF_HOST`, `PORT`, `KF_TOKEN_SECRET`, `KF_ALLOWED_ORIGIN`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`. Never commit service-role keys, token secrets, `.env`, or data files. For production uptime and backups, move to paid hosting and a database plan with backups.

## API

- `POST /api01/auth/register` creates a customer or driver account (`role` is `customer` or `driver`; omitted role defaults to driver).
- `POST /api01/auth/login` signs in any configured account.
- `GET /api02/menu` lists available dishes; `POST /api02/menu` adds a vendor dish.
- `POST /api03/orders` creates a delivery order for a customer and assigns it to a registered driver.
- `GET /api04/dispatch/my-deliveries` lists the signed-in driver's orders.
- `PATCH /api04/dispatch/:id/status` advances an assigned delivery from `assigned` to `picked_up` or from `picked_up` to `delivered`.
- `GET /api05/admin/overview` returns aggregate counts for an administrator.
- `POST /api06/tracking/orders` registers a customer delivery for cross-device tracking.
- `GET /api06/tracking/mine` lists the signed-in customer's tracked deliveries.
- `GET /api06/tracking/open` and `GET /api06/tracking/my-active` return driver assignments.
- `PATCH /api06/tracking/orders/:id/claim` atomically assigns an open delivery to a driver.
- `PATCH /api06/tracking/orders/:id/status` advances a tracked delivery.
- `PUT /api06/tracking/orders/:id/location` saves the assigned driver's latest GPS fix.
- `GET /api06/tracking/orders/:id` returns a delivery only to its customer or assigned driver.