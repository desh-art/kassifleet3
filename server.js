"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const HOST = process.env.KF_HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.env.KF_DATA_DIR || path.join(__dirname, "data"));
const DB_FILE = path.join(DATA_DIR, "kassifleet.json");
const SECRET_FILE = path.join(DATA_DIR, "token-secret");
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ENABLED = !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const PASSWORD_ITERATIONS = 210000;
const TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_ORIGINS = String(process.env.KF_ALLOWED_ORIGIN || "")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

fs.mkdirSync(DATA_DIR, { recursive: true });

const secret = process.env.KF_TOKEN_SECRET || loadOrCreateSecret();
let state = loadState();

function loadOrCreateSecret() {
  if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, "utf8").trim();
  const value = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(SECRET_FILE, value, { flag: "wx", mode: 0o600 });
  return value;
}

function loadState() {
  if (!fs.existsSync(DB_FILE)) {
    const initial = {
      users: [],
      menu: [
        { id: "meal-1", vendor_id: "vendor-demo", name: "Chicken Kota", description: "Grilled chicken, chips and house sauce", price_cents: 8500, available: true },
        { id: "meal-2", vendor_id: "vendor-demo", name: "Beef Burger", description: "Beef patty, lettuce and tomato", price_cents: 7200, available: true },
        { id: "meal-3", vendor_id: "vendor-demo", name: "Pap and Chakalaka", description: "Soft pap with spicy chakalaka", price_cents: 5400, available: true }
      ],
      orders: [],
      trackingOrders: [],
      nextOrder: 1,
      nextMenuItem: 4
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), { flag: "wx" });
    return initial;
  }

  const saved = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  if (!Array.isArray(saved.users) || !Array.isArray(saved.menu) || !Array.isArray(saved.orders)) {
    throw new Error("The local data file is malformed. Back it up and remove data/kassifleet.json to reinitialize.");
  }
  if (!Number.isSafeInteger(saved.nextOrder) || saved.nextOrder < 1) saved.nextOrder = 1;
  const nextAvailableMenuId = saved.menu.reduce((next, item) => {
    const match = /^meal-(\d+)$/.exec(String(item.id));
    return match ? Math.max(next, Number(match[1]) + 1) : next;
  }, 1);
  if (!Number.isSafeInteger(saved.nextMenuItem) || saved.nextMenuItem < nextAvailableMenuId) {
    saved.nextMenuItem = nextAvailableMenuId;
  }
  if (!Array.isArray(saved.trackingOrders)) saved.trackingOrders = [];
  return saved;
}

function saveState() {
  const tempFile = DB_FILE + ".tmp";
  fs.writeFileSync(tempFile, JSON.stringify(state, null, 2));
  fs.renameSync(tempFile, DB_FILE);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function sendJson(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}

async function supabaseRequest(endpoint, options) {
  if (!SUPABASE_ENABLED) throw httpError(503, "Hosted database is not configured.");
  const opts = options || {};
  const response = await fetch(SUPABASE_URL + "/rest/v1/" + endpoint, {
    method: opts.method || "GET",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
      Prefer: opts.prefer || "return=representation"
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = await response.text();
  if (!response.ok) {
    console.error("Supabase request failed:", response.status, text.slice(0, 500));
    throw httpError(503, "The hosted database request failed.");
  }
  return text ? JSON.parse(text) : null;
}

function handleCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return false;
  const wildcard = ALLOWED_ORIGINS.includes("*");
  if (!wildcard && !ALLOWED_ORIGINS.includes(origin)) {
    if (req.method === "OPTIONS") {
      res.writeHead(403);
      res.end();
      return true;
    }
    return false;
  }

  res.setHeader("Access-Control-Allow-Origin", wildcard ? "*" : origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Vary", "Origin");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(httpError(413, "Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        const parsed = JSON.parse(body);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return reject(httpError(400, "Request body must be a JSON object."));
        }
        resolve(parsed);
      } catch {
        reject(httpError(400, "Request body must be valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.pbkdf2(password, salt, PASSWORD_ITERATIONS, 64, "sha512", (error, derived) => {
      if (error) return reject(error);
      resolve(`${PASSWORD_ITERATIONS}:${salt.toString("base64url")}:${derived.toString("base64url")}`);
    });
  });
}

function verifyPassword(password, saved) {
  const [iterations, saltText, hashText] = String(saved || "").split(":");
  const salt = Buffer.from(saltText || "", "base64url");
  const expected = Buffer.from(hashText || "", "base64url");
  if (!Number.isInteger(Number(iterations)) || !salt.length || !expected.length) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, Number(iterations), expected.length, "sha512", (error, actual) => {
      if (error) return reject(error);
      resolve(actual.length === expected.length && crypto.timingSafeEqual(actual, expected));
    });
  });
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function createToken(user) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    sub: user.id,
    role: user.role,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS
  }));
  const unsigned = `${header}.${payload}`;
  const signature = crypto.createHmac("sha256", secret).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

async function authenticate(req, allowedRoles) {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
  if (!match) throw httpError(401, "Sign in to continue.");
  const parts = match[1].split(".");
  if (parts.length !== 3) throw httpError(401, "Your session is invalid. Sign in again.");

  const unsigned = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac("sha256", secret).update(unsigned).digest();
  let actual;
  let payload;
  try {
    actual = Buffer.from(parts[2], "base64url");
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw httpError(401, "Your session is invalid. Sign in again.");
  }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected) || payload.exp <= Date.now() / 1000) {
    throw httpError(401, "Your session has expired. Sign in again.");
  }

  let user;
  if (SUPABASE_ENABLED) {
    const rows = await supabaseRequest(
      "app_users?id=eq." + encodeURIComponent(payload.sub) +
        "&select=id,name,email,role,vendor_id,password_hash&limit=1"
    );
    const row = rows && rows[0];
    if (row) user = {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      vendorId: row.vendor_id,
      passwordHash: row.password_hash
    };
  } else {
    user = state.users.find(item => item.id === payload.sub && item.role === payload.role);
  }
  if (!user) throw httpError(401, "This account is no longer available.");
  if (allowedRoles && !allowedRoles.includes(user.role)) throw httpError(403, "You do not have permission to do that.");
  return user;
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

async function seedAccount(prefix, role, extra) {
  const email = String(process.env[`KF_${prefix}_EMAIL`] || "").trim().toLowerCase();
  const password = String(process.env[`KF_${prefix}_PASSWORD`] || "");
  if (!email || !password) return;
  if (SUPABASE_ENABLED) {
    const existing = await supabaseRequest("app_users?email=eq." + encodeURIComponent(email) + "&select=id&limit=1");
    if (existing && existing.length) return;
    await supabaseRequest("app_users", {
      method: "POST",
      prefer: "return=minimal",
      body: [{
        id: crypto.randomUUID(),
        name: String(process.env[`KF_${prefix}_NAME`] || prefix[0] + prefix.slice(1).toLowerCase()),
        email,
        role,
        password_hash: await hashPassword(password),
        vendor_id: extra && extra.vendorId ? extra.vendorId : null
      }]
    });
    return;
  }
  if (state.users.some(user => user.email === email)) return;
  const user = {
    id: crypto.randomUUID(),
    name: String(process.env[`KF_${prefix}_NAME`] || prefix[0] + prefix.slice(1).toLowerCase()),
    email,
    role,
    passwordHash: await hashPassword(password),
    createdAt: new Date().toISOString(),
    ...(extra || {})
  };
  state.users.push(user);
  saveState();
}

async function seedConfiguredAccounts() {
  await seedAccount("CUSTOMER", "customer");
  await seedAccount("VENDOR", "vendor", { vendorId: process.env.KF_VENDOR_ID || "vendor-demo" });
  await seedAccount("ADMIN", "platform_admin");
}

function activeDeliveriesFor(driverId) {
  return state.orders.filter(order => order.driver_id === driverId && order.status !== "delivered").length;
}

function trackingOrderDto(order, location) {
  return {
    id: order.id,
    localOrderId: order.local_order_id,
    status: order.status,
    shopName: order.shop_name,
    address: order.address,
    items: order.items,
    totalCents: order.total_cents,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    driverId: order.driver_id,
    location: location || null
  };
}

async function handleApi(req, res, url) {
  const method = req.method;
  const pathname = url.pathname;

  if (method === "POST" && pathname === "/api01/auth/register") {
    const body = await readJson(req);
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const role = body.role || "driver";
    if (name.length < 2 || name.length > 100) throw httpError(400, "Enter your full name.");
    if (email.length > 254 || !EMAIL_PATTERN.test(email)) throw httpError(400, "Enter a valid email address.");
    if (password.length < 8 || password.length > 128) throw httpError(400, "Password must be between 8 and 128 characters.");
    if (role !== "customer" && role !== "driver") throw httpError(400, "Choose a supported account type.");
    if (SUPABASE_ENABLED) {
      const existing = await supabaseRequest("app_users?email=eq." + encodeURIComponent(email) + "&select=id&limit=1");
      if (existing && existing.length) throw httpError(409, "An account with that email already exists.");
      const user = {
        id: crypto.randomUUID(), name, email, role,
        passwordHash: await hashPassword(password)
      };
      await supabaseRequest("app_users", {
        method: "POST",
        body: [{
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          password_hash: user.passwordHash
        }]
      });
      return sendJson(res, 201, { user: publicUser(user), accessToken: createToken(user) });
    }
    if (state.users.some(user => user.email === email)) throw httpError(409, "An account with that email already exists.");

    const user = {
      id: crypto.randomUUID(), name, email, role,
      passwordHash: await hashPassword(password),
      createdAt: new Date().toISOString()
    };
    state.users.push(user);
    saveState();
    return sendJson(res, 201, { user: publicUser(user), accessToken: createToken(user) });
  }

  if (method === "POST" && pathname === "/api01/auth/login") {
    const body = await readJson(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    let user;
    if (SUPABASE_ENABLED) {
      const rows = await supabaseRequest("app_users?email=eq." + encodeURIComponent(email) + "&select=id,name,email,role,vendor_id,password_hash&limit=1");
      const row = rows && rows[0];
      if (row) user = {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        vendorId: row.vendor_id,
        passwordHash: row.password_hash
      };
    } else {
      user = state.users.find(item => item.email === email);
    }
    if (!user || !(await verifyPassword(password, user.passwordHash))) throw httpError(401, "Email or password is incorrect.");
    return sendJson(res, 200, { user: publicUser(user), accessToken: createToken(user) });
  }

  if (method === "GET" && pathname === "/api02/menu") {
    await authenticate(req, ["customer", "vendor", "platform_admin"]);
    return sendJson(res, 200, state.menu.filter(item => item.available));
  }

  if (method === "POST" && pathname === "/api02/menu") {
    const user = await authenticate(req, ["vendor"]);
    const body = await readJson(req);
    const name = String(body.name || "").trim();
    const price = Number(body.priceCents);
    if (!name || name.length > 120 || !Number.isSafeInteger(price) || price < 1 || price > 100000000) {
      throw httpError(400, "Enter a dish name and a valid price.");
    }
    const item = {
      id: `meal-${state.nextMenuItem++}`,
      vendor_id: user.vendorId || "vendor-demo",
      name,
      description: String(body.description || "").trim().slice(0, 500),
      price_cents: price,
      available: true
    };
    state.menu.push(item);
    saveState();
    return sendJson(res, 201, item);
  }

  if (method === "POST" && pathname === "/api03/orders") {
    const user = await authenticate(req, ["customer"]);
    const body = await readJson(req);
    const address = String(body.deliveryAddress || "").trim();
    const requestedItems = Array.isArray(body.items) ? body.items : [];
    if (!address || address.length > 300 || !requestedItems.length || requestedItems.length > 50) {
      throw httpError(400, "Add at least one item and a valid delivery address.");
    }

    const items = requestedItems.map(entry => {
      const item = state.menu.find(candidate => candidate.id === String(entry.menuItemId) && candidate.available);
      const quantity = Number(entry.quantity);
      if (!item || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
        throw httpError(400, "The basket contains an unavailable item or invalid quantity.");
      }
      return { item, quantity };
    });
    const vendorId = String(body.vendorId || "");
    if (items.some(entry => entry.item.vendor_id !== vendorId)) throw httpError(400, "Orders must contain items from one restaurant.");
    const drivers = state.users.filter(candidate => candidate.role === "driver");
    if (!drivers.length) throw httpError(409, "No drivers are registered to accept deliveries yet.");

    const total = items.reduce((sum, entry) => sum + entry.item.price_cents * entry.quantity, 0);
    const order = {
      id: `KF-${String(state.nextOrder++).padStart(6, "0")}`,
      customer_id: user.id,
      driver_id: drivers.sort((a, b) => activeDeliveriesFor(a.id) - activeDeliveriesFor(b.id))[0].id,
      vendor_id: vendorId,
      delivery_address: address,
      status: "assigned",
      total_cents: total,
      items: items.map(entry => ({ menu_item_id: entry.item.id, name: entry.item.name, quantity: entry.quantity, price_cents: entry.item.price_cents })),
      created_at: new Date().toISOString(),
      picked_up_at: null,
      delivered_at: null
    };
    state.orders.unshift(order);
    saveState();
    return sendJson(res, 201, { id: order.id, status: order.status, total_cents: total });
  }

  if (method === "GET" && pathname === "/api04/dispatch/my-deliveries") {
    const user = await authenticate(req, ["driver"]);
    const orders = state.orders
      .filter(order => order.driver_id === user.id)
      .map(({ id, delivery_address, status, created_at }) => ({ id, delivery_address, status, created_at }));
    return sendJson(res, 200, orders);
  }

  const statusMatch = /^\/api04\/dispatch\/([^/]+)\/status$/.exec(pathname);
  if (method === "PATCH" && statusMatch) {
    const user = await authenticate(req, ["driver"]);
    const body = await readJson(req);
    const order = state.orders.find(item => item.id === decodeURIComponent(statusMatch[1]) && item.driver_id === user.id);
    if (!order) throw httpError(404, "Delivery not found.");
    const next = order.status === "assigned" ? "picked_up" : order.status === "picked_up" ? "delivered" : null;
    if (!next || body.status !== next) throw httpError(409, "That delivery status change is not allowed.");
    order.status = next;
    if (next === "picked_up") order.picked_up_at = new Date().toISOString();
    if (next === "delivered") order.delivered_at = new Date().toISOString();
    saveState();
    return sendJson(res, 200, { id: order.id, status: order.status });
  }

  if (method === "POST" && pathname === "/api06/tracking/orders") {
    const user = await authenticate(req, ["customer"]);
    const body = await readJson(req);
    const localOrderId = String(body.localOrderId || "").trim();
    const shopName = String(body.shopName || "").trim();
    const address = body.address && typeof body.address === "object" && !Array.isArray(body.address) ? body.address : null;
    const items = Array.isArray(body.items) ? body.items : [];
    const totalCents = Number(body.totalCents);
    if (!localOrderId || localOrderId.length > 120 || !shopName || shopName.length > 160 || !address || !items.length || items.length > 50 || !Number.isSafeInteger(totalCents) || totalCents < 0) {
      throw httpError(400, "Provide a valid delivery order to track.");
    }
    if (body.fulfilment === "collect") throw httpError(400, "Collection orders do not need driver tracking.");

    const order = {
      id: crypto.randomUUID(),
      customer_id: user.id,
      driver_id: null,
      local_order_id: localOrderId,
      status: "new",
      shop_name: shopName,
      address,
      items,
      total_cents: totalCents,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    if (SUPABASE_ENABLED) {
      const rows = await supabaseRequest("tracking_orders", { method: "POST", body: [order] });
      return sendJson(res, 201, trackingOrderDto(rows[0] || order, null));
    }
    state.trackingOrders.unshift(order);
    saveState();
    return sendJson(res, 201, trackingOrderDto(order, null));
  }

  if (method === "GET" && pathname === "/api06/tracking/open") {
    await authenticate(req, ["driver"]);
    const orders = SUPABASE_ENABLED
      ? await supabaseRequest("tracking_orders?status=eq.new&driver_id=is.null&select=id,local_order_id,status,shop_name,address,items,total_cents,created_at,updated_at,driver_id&order=created_at.asc")
      : state.trackingOrders.filter(order => order.status === "new" && !order.driver_id);
    return sendJson(res, 200, orders.map(order => trackingOrderDto(order, null)));
  }

  if (method === "GET" && pathname === "/api06/tracking/mine") {
    const user = await authenticate(req, ["customer"]);
    const orders = SUPABASE_ENABLED
      ? await supabaseRequest("tracking_orders?customer_id=eq." + encodeURIComponent(user.id) + "&select=id,customer_id,driver_id,local_order_id,status,shop_name,address,items,total_cents,created_at,updated_at&order=created_at.desc&limit=100")
      : state.trackingOrders.filter(order => order.customer_id === user.id).slice(0, 100);
    const results = await Promise.all(orders.map(async order => {
      let location = order.location || null;
      if (SUPABASE_ENABLED && order.driver_id) {
        const locations = await supabaseRequest("driver_locations?order_id=eq." + encodeURIComponent(order.id) + "&select=latitude,longitude,accuracy_m,updated_at&limit=1");
        if (locations.length) location = { latitude: locations[0].latitude, longitude: locations[0].longitude, accuracy: locations[0].accuracy_m, updatedAt: locations[0].updated_at };
      }
      return trackingOrderDto(order, location);
    }));
    return sendJson(res, 200, results);
  }

  if (method === "GET" && pathname === "/api06/tracking/my-active") {
    const user = await authenticate(req, ["driver"]);
    const orders = SUPABASE_ENABLED
      ? await supabaseRequest("tracking_orders?driver_id=eq." + encodeURIComponent(user.id) + "&status=in.(claimed,picked_up)&select=id,local_order_id,status,shop_name,address,items,total_cents,created_at,updated_at,driver_id&order=updated_at.desc&limit=1")
      : state.trackingOrders.filter(order => order.driver_id === user.id && ["claimed", "picked_up"].includes(order.status)).slice(0, 1);
    if (!orders.length) return sendJson(res, 200, null);
    const order = orders[0];
    let location = order.location || null;
    if (SUPABASE_ENABLED) {
      const locations = await supabaseRequest("driver_locations?order_id=eq." + encodeURIComponent(order.id) + "&select=latitude,longitude,accuracy_m,updated_at&limit=1");
      if (locations.length) location = { latitude: locations[0].latitude, longitude: locations[0].longitude, accuracy: locations[0].accuracy_m, updatedAt: locations[0].updated_at };
    }
    return sendJson(res, 200, trackingOrderDto(order, location));
  }

  const trackingMatch = /^\/api06\/tracking\/orders\/([^/]+)(?:\/(claim|status|location))?$/.exec(pathname);
  if (trackingMatch) {
    const trackingId = decodeURIComponent(trackingMatch[1]);
    const action = trackingMatch[2] || "detail";

    if (method === "GET" && action === "detail") {
      const user = await authenticate(req, ["customer", "driver"]);
      const orders = SUPABASE_ENABLED
        ? await supabaseRequest("tracking_orders?id=eq." + encodeURIComponent(trackingId) + "&select=id,customer_id,driver_id,local_order_id,status,shop_name,address,items,total_cents,created_at,updated_at&limit=1")
        : state.trackingOrders.filter(order => order.id === trackingId);
      const order = orders[0];
      if (!order) throw httpError(404, "Tracked delivery not found.");
      if ((user.role === "customer" && order.customer_id !== user.id) || (user.role === "driver" && order.driver_id !== user.id)) {
        throw httpError(403, "You do not have access to this delivery.");
      }
      let location = order.location || null;
      if (SUPABASE_ENABLED) {
        const locations = await supabaseRequest("driver_locations?order_id=eq." + encodeURIComponent(order.id) + "&select=latitude,longitude,accuracy_m,updated_at&limit=1");
        if (locations.length) location = { latitude: locations[0].latitude, longitude: locations[0].longitude, accuracy: locations[0].accuracy_m, updatedAt: locations[0].updated_at };
      }
      return sendJson(res, 200, trackingOrderDto(order, location));
    }

    if (method === "PATCH" && action === "claim") {
      const user = await authenticate(req, ["driver"]);
      let claimed;
      if (SUPABASE_ENABLED) {
        const rows = await supabaseRequest("tracking_orders?id=eq." + encodeURIComponent(trackingId) + "&status=eq.new&driver_id=is.null", {
          method: "PATCH",
          body: { driver_id: user.id, status: "claimed", updated_at: new Date().toISOString() }
        });
        claimed = rows[0];
      } else {
        claimed = state.trackingOrders.find(order => order.id === trackingId && order.status === "new" && !order.driver_id);
        if (claimed) {
          claimed.driver_id = user.id;
          claimed.status = "claimed";
          claimed.updated_at = new Date().toISOString();
          saveState();
        }
      }
      if (!claimed) throw httpError(409, "This delivery was already claimed or is no longer available.");
      return sendJson(res, 200, trackingOrderDto(claimed, null));
    }

    if (method === "PATCH" && action === "status") {
      const user = await authenticate(req, ["driver"]);
      const body = await readJson(req);
      const rows = SUPABASE_ENABLED
        ? await supabaseRequest("tracking_orders?id=eq." + encodeURIComponent(trackingId) + "&driver_id=eq." + encodeURIComponent(user.id) + "&select=id,driver_id,status")
        : state.trackingOrders.filter(order => order.id === trackingId && order.driver_id === user.id);
      const order = rows[0];
      if (!order) throw httpError(404, "Tracked delivery not found.");
      const next = order.status === "claimed" ? "picked_up" : order.status === "picked_up" ? "delivered" : null;
      if (!next || body.status !== next) throw httpError(409, "That delivery status change is not allowed.");
      if (SUPABASE_ENABLED) {
        await supabaseRequest("tracking_orders?id=eq." + encodeURIComponent(trackingId) + "&driver_id=eq." + encodeURIComponent(user.id), {
          method: "PATCH",
          body: { status: next, updated_at: new Date().toISOString() },
          prefer: "return=minimal"
        });
      } else {
        order.status = next;
        order.updated_at = new Date().toISOString();
        saveState();
      }
      return sendJson(res, 200, { id: trackingId, status: next });
    }

    if (method === "PUT" && action === "location") {
      const user = await authenticate(req, ["driver"]);
      const body = await readJson(req);
      const latitude = Number(body.latitude);
      const longitude = Number(body.longitude);
      const accuracy = Number(body.accuracy);
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        throw httpError(400, "Provide valid GPS coordinates.");
      }
      const orders = SUPABASE_ENABLED
        ? await supabaseRequest("tracking_orders?id=eq." + encodeURIComponent(trackingId) + "&driver_id=eq." + encodeURIComponent(user.id) + "&status=in.(claimed,picked_up)&select=id")
        : state.trackingOrders.filter(order => order.id === trackingId && order.driver_id === user.id && ["claimed", "picked_up"].includes(order.status));
      if (!orders.length) throw httpError(404, "Active tracked delivery not found.");
      const location = { order_id: trackingId, driver_id: user.id, latitude, longitude, accuracy_m: Number.isFinite(accuracy) ? accuracy : null, updated_at: new Date().toISOString() };
      if (SUPABASE_ENABLED) {
        await supabaseRequest("driver_locations?on_conflict=order_id", {
          method: "POST",
          body: [location],
          prefer: "resolution=merge-duplicates,return=minimal"
        });
      } else {
        orders[0].location = { latitude, longitude, accuracy: location.accuracy_m, updatedAt: location.updated_at };
        orders[0].updated_at = location.updated_at;
        saveState();
      }
      return sendJson(res, 204, {});
    }
  }

  if (method === "GET" && pathname === "/api05/admin/overview") {
    await authenticate(req, ["platform_admin"]);
    return sendJson(res, 200, {
      customers: state.users.filter(user => user.role === "customer").length,
      drivers: state.users.filter(user => user.role === "driver").length,
      vendors: state.users.filter(user => user.role === "vendor").length,
      menuItems: state.menu.length,
      orders: state.orders.length,
      activeDeliveries: state.orders.filter(order => order.status !== "delivered").length
    });
  }

  throw httpError(404, "API endpoint not found.");
}

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

function serveStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") throw httpError(405, "Method not allowed.");
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw httpError(400, "Invalid URL path.");
  }
  if (pathname === "/") pathname = "/index.html";
  const file = path.resolve(__dirname, `.${pathname}`);
  if (!file.startsWith(__dirname + path.sep) || file.startsWith(DATA_DIR + path.sep) || ["server.js", "package.json"].includes(path.basename(file))) {
    throw httpError(404, "Page not found.");
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw httpError(404, "Page not found.");
  const contentType = path.basename(file) === "css.js"
    ? "text/css; charset=utf-8"
    : MIME_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin"
  });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    if (req.method === "GET" && url.pathname === "/healthz") {
      if (process.env.NODE_ENV === "production" && !SUPABASE_ENABLED) {
        return sendJson(res, 503, { ok: false, error: "Hosted database is not configured." });
      }
      return sendJson(res, 200, { ok: true, database: SUPABASE_ENABLED ? "supabase" : "local" });
    }
    if (url.pathname.startsWith("/api")) {
      if (handleCors(req, res)) return;
      await handleApi(req, res, url);
    } else serveStatic(req, res, url);
  } catch (error) {
    if (res.headersSent || res.destroyed) return;
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status === 500) console.error(error);
    sendJson(res, status, { error: status === 500 ? "An unexpected server error occurred." : error.message });
  }
});

seedConfiguredAccounts().then(() => {
  server.listen(PORT, HOST, () => {
    console.log(`Kassi Fleet backend is running at http://${HOST}:${PORT}`);
    console.log(`Open the driver portal at http://${HOST}:${PORT}/driver.index.html`);
  });
}).catch(error => {
  console.error("Could not initialize the Kassi Fleet backend.", error);
  process.exitCode = 1;
});