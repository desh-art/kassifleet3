# Kassi Fleet backend

The backend uses only Node.js built-in modules. It serves the existing portal files and API from `http://127.0.0.1:3000`, and saves local development data in `data/kassifleet.json`.

## Start

Install Node.js 18 or newer, open PowerShell in this folder, then run:

```powershell
npm start
```

Open `http://127.0.0.1:3000/apps/index.html` for the four-app hub. Use the server URL instead of opening the HTML files directly.

Customers and drivers can register with their name, email, and password. Their accounts are saved locally and they are signed in immediately. Registration stores an email address but does not send a verification message; sending email requires an SMTP provider and credentials.

GitHub Pages only hosts static files and cannot run this Node.js backend. To use login from GitHub Pages, host `server.js` on a Node.js service, set `KF_ALLOWED_ORIGIN` to `https://desh-art.github.io`, and set `window.KF_API_URL` in `apps/js/config.js` to the backend's HTTPS URL. Keep the token secret and database on the backend host.

For GitHub Pages, keep the existing root `index.html` app hub and upload the new app files under `apps/` with their folder structure intact. Upload `server.js`, `package.json`, and this guide at the repository root for the separate Node.js host. Do not upload the local `data/` folder.

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

For deployment, set `KF_HOST`, `PORT`, `KF_TOKEN_SECRET`, `KF_ALLOWED_ORIGIN`, and `KF_DATA_DIR`; use HTTPS and a production database. This local JSON-backed server is intended for development and demonstration, not public internet deployment.

## API

- `POST /api01/auth/register` creates a customer or driver account (`role` is `customer` or `driver`; omitted role defaults to driver).
- `POST /api01/auth/login` signs in any configured account.
- `GET /api02/menu` lists available dishes; `POST /api02/menu` adds a vendor dish.
- `POST /api03/orders` creates a delivery order for a customer and assigns it to a registered driver.
- `GET /api04/dispatch/my-deliveries` lists the signed-in driver's orders.
- `PATCH /api04/dispatch/:id/status` advances an assigned delivery from `assigned` to `picked_up` or from `picked_up` to `delivered`.
- `GET /api05/admin/overview` returns aggregate counts for an administrator.