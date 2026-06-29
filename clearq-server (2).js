/**
 * ClearQ API Server v2 — Clean standalone backend
 * No build step. Run with: node clearq-server.js
 * Deploy to Railway, Render, or any Node.js host.
 */
"use strict";

const http = require("http");
const { Pool } = require("pg");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "3000", 10);
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.SESSION_SECRET || "clearq-jwt-secret-change-me";
const BCRYPT_ROUNDS = 10;

if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required");
  process.exit(1);
}

// ─── DATABASE ────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes("neon.tech") || DATABASE_URL.includes("render.com")
    ? { rejectUnauthorized: false }
    : false,
});

async function db(sql, params = []) {
  const client = await pool.connect();
  try {
    const r = await client.query(sql, params);
    return r.rows;
  } finally {
    client.release();
  }
}

async function db1(sql, params = []) {
  const rows = await db(sql, params);
  return rows[0] || null;
}

// ─── SCHEMA SETUP ────────────────────────────────────────────────────────────
async function initDB() {
  await db(`
    CREATE TABLE IF NOT EXISTS wash_shops (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT 'Sheikh Zayed',
      phone TEXT NOT NULL DEFAULT '',
      open_time TEXT NOT NULL DEFAULT '09:00',
      close_time TEXT NOT NULL DEFAULT '22:00',
      slot_duration_mins INT NOT NULL DEFAULT 30,
      mins_exterior INT NOT NULL DEFAULT 20,
      mins_interior INT NOT NULL DEFAULT 30,
      mins_full INT NOT NULL DEFAULT 45,
      price_exterior INT NOT NULL DEFAULT 150,
      price_interior INT NOT NULL DEFAULT 200,
      price_full INT NOT NULL DEFAULT 300,
      max_workers INT NOT NULL DEFAULT 3,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      lat REAL,
      lng REAL,
      is_active INT NOT NULL DEFAULT 1
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS wash_bookings (
      id SERIAL PRIMARY KEY,
      shop_id INT NOT NULL REFERENCES wash_shops(id),
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL DEFAULT '',
      wash_type TEXT NOT NULL,
      scheduled_date TEXT NOT NULL,
      scheduled_time TEXT NOT NULL,
      price INT NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      license_plate TEXT,
      car_model TEXT,
      car_type TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      payment_status TEXT NOT NULL DEFAULT 'paid',
      clerk_user_id TEXT,
      kind TEXT NOT NULL DEFAULT 'reservation',
      bay_number INT,
      conflict_reason TEXT,
      eta_arrival_at TIMESTAMPTZ,
      eta_ready_at TIMESTAMPTZ,
      eta_source TEXT,
      arrived_at TIMESTAMPTZ,
      wash_started_at TIMESTAMPTZ,
      wash_finished_at TIMESTAMPTZ,
      late_warning_sent_at TIMESTAMPTZ,
      hold_expires_at TIMESTAMPTZ,
      customer_lat REAL,
      customer_lng REAL,
      paymob_order_id TEXT,
      clerkUserId TEXT
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS wash_partners (
      id SERIAL PRIMARY KEY,
      shop_id INT NOT NULL REFERENCES wash_shops(id),
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      is_active INT NOT NULL DEFAULT 1,
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS wash_services (
      id SERIAL PRIMARY KEY,
      shop_id INT NOT NULL REFERENCES wash_shops(id),
      name TEXT NOT NULL,
      description TEXT,
      price INT NOT NULL DEFAULT 0,
      duration_mins INT NOT NULL DEFAULT 30,
      display_order INT NOT NULL DEFAULT 0,
      is_active INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS wash_ratings (
      id SERIAL PRIMARY KEY,
      booking_id INT REFERENCES wash_bookings(id),
      shop_id INT NOT NULL REFERENCES wash_shops(id),
      clerk_user_id TEXT,
      customer_name TEXT NOT NULL DEFAULT '',
      stars INT NOT NULL,
      comment TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS wash_service_history (
      id SERIAL PRIMARY KEY,
      customer_phone TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      shop_id INT NOT NULL REFERENCES wash_shops(id),
      shop_name TEXT NOT NULL,
      wash_type TEXT NOT NULL,
      duration_mins INT NOT NULL,
      price INT NOT NULL,
      booking_id INT,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Check if we need to seed data
  const count = await db1("SELECT COUNT(*) as cnt FROM wash_shops");
  if (parseInt(count.cnt) === 0) {
    console.log("Seeding initial data...");
    await seedData();
  }
  console.log("✓ Database ready");
}

async function seedData() {
  // Insert all shops from the exported data
  await db(`INSERT INTO wash_shops (id,name,address,city,phone,open_time,close_time,slot_duration_mins,mins_exterior,mins_interior,mins_full,price_exterior,price_interior,price_full,max_workers,lat,lng,is_active) VALUES
    (1,'Au Garage','Beverly Hills, Sheikh Zayed City','Sheikh Zayed','+20 100 000 0000','09:00','23:00',60,30,30,60,150,150,250,2,30.061901,30.95894,1),
    (2,'Fashion Car','Mix C1, Gate 9 Mall 4, Beverly Hills, Sheikh Zayed','Sheikh Zayed','','09:00','23:00',30,12,16,28,150,180,280,3,30.062576,30.958067,1),
    (3,'Nano Care','Beverly Hills, Second Al Sheikh Zayed, Giza','Sheikh Zayed','','08:00','22:30',30,13,17,28,130,160,250,3,30.062647,30.958435,1),
    (4,'Ferrari Garage','Opp. Gold''s Gym, Beverly Hills Gate 9, Giza','Sheikh Zayed','','08:00','23:00',30,14,18,32,180,220,350,3,30.060236,30.958279,1),
    (5,'CARHUB Protect & Detail','A Plaza Mall, Zayed 5 Street, Sheikh Zayed, Giza','Sheikh Zayed','00000','09:00','23:00',30,30,30,62,150,150,250,3,30.048367,30.955416,1),
    (6,'HD CarWash','The Block Green 4','Sheikh Zayed','','10:00','00:00',30,30,30,60,150,150,250,3,30.005306,31.015263,1)
    ON CONFLICT (id) DO NOTHING`);

  // Reset sequences
  await db("SELECT setval('wash_shops_id_seq', 6, true)");

  // Insert partners (using existing bcrypt hashes)
  await db(`INSERT INTO wash_partners (id,shop_id,username,password_hash,is_active) VALUES
    (1,1,'augarage','$2b$12$nt66yi2Z/lWH6tX4yyS5tOWfQR4DYt3R/PLlvcuJmKEv6kbOKs5xy',1),
    (2,2,'fashioncar','$2b$12$nt66yi2Z/lWH6tX4yyS5tOWfQR4DYt3R/PLlvcuJmKEv6kbOKs5xy',1),
    (3,3,'nanocare','$2b$12$nt66yi2Z/lWH6tX4yyS5tOWfQR4DYt3R/PLlvcuJmKEv6kbOKs5xy',1),
    (4,4,'ferrarigarage','$2b$12$nt66yi2Z/lWH6tX4yyS5tOWfQR4DYt3R/PLlvcuJmKEv6kbOKs5xy',1),
    (5,5,'carhub','$2b$12$nt66yi2Z/lWH6tX4yyS5tOWfQR4DYt3R/PLlvcuJmKEv6kbOKs5xy',1),
    (6,6,'hdcarwash','$2b$12$lB2qgkqDsRWWhtH5gCG4S.On6WwgZOKxk/TPE49FKI2kVwD2YfJUa',1)
    ON CONFLICT (id) DO NOTHING`);

  await db("SELECT setval('wash_partners_id_seq', 7, true)");

  // Insert services
  await db(`INSERT INTO wash_services (id,shop_id,name,description,price,duration_mins,display_order,is_active) VALUES
    (1,1,'Exterior Wash','Quick exterior hand wash with wax',200,15,0,1),
    (2,1,'Interior Clean','Interior vacuum and detail',250,20,1,1),
    (3,1,'Full Wash','Complete exterior and interior detailing',380,35,2,1)
    ON CONFLICT (id) DO NOTHING`);

  await db("SELECT setval('wash_services_id_seq', 3, true)");
  console.log("✓ Data seeded");
}

// ─── JWT ─────────────────────────────────────────────────────────────────────
function b64url(buf) {
  return buf.toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
}

function signJWT(payload) {
  const h = b64url(Buffer.from(JSON.stringify({alg:"HS256",typ:"JWT"})));
  const p = b64url(Buffer.from(JSON.stringify({...payload,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+30*86400})));
  const s = b64url(crypto.createHmac("sha256",JWT_SECRET).update(`${h}.${p}`).digest());
  return `${h}.${p}.${s}`;
}

function verifyJWT(token) {
  if (!token) return null;
  try {
    const [h,p,s] = token.split(".");
    const exp = b64url(crypto.createHmac("sha256",JWT_SECRET).update(`${h}.${p}`).digest());
    if (s !== exp) return null;
    const payload = JSON.parse(Buffer.from(p,"base64").toString());
    if (payload.exp < Math.floor(Date.now()/1000)) return null;
    return payload;
  } catch { return null; }
}

// ─── BCRYPT (pure JS fallback) ────────────────────────────────────────────────
// We use a simple wrapper that tries to load bcryptjs dynamically
async function bcryptCompare(password, hash) {
  try {
    const bcrypt = require("bcryptjs");
    return await bcrypt.compare(password, hash);
  } catch {
    // bcryptjs not available — try bcrypt
    try {
      const bcrypt = require("bcrypt");
      return await bcrypt.compare(password, hash);
    } catch {
      // Last resort: plain text comparison for dev only
      console.warn("WARNING: bcrypt not available, using plain comparison");
      return password === hash;
    }
  }
}

async function bcryptHash(password) {
  try {
    const bcrypt = require("bcryptjs");
    return await bcrypt.hash(password, BCRYPT_ROUNDS);
  } catch {
    try {
      const bcrypt = require("bcrypt");
      return await bcrypt.hash(password, BCRYPT_ROUNDS);
    } catch {
      return password; // dev fallback
    }
  }
}

// ─── HTTP HELPERS ─────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,expo-platform",
};

function respond(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {"Content-Type":"application/json",...CORS_HEADERS});
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", c => data += c);
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
    req.on("error", () => resolve({}));
  });
}

function getToken(req) {
  const auth = req.headers["authorization"] || "";
  return auth.replace(/^Bearer\s+/i,"").trim() || null;
}

// ─── SERIALIZERS ─────────────────────────────────────────────────────────────
function shop(s) {
  return {
    id: s.id, name: s.name, address: s.address, city: s.city, phone: s.phone,
    openTime: s.open_time, closeTime: s.close_time,
    slotDurationMins: s.slot_duration_mins,
    minsExterior: s.mins_exterior, minsInterior: s.mins_interior, minsFull: s.mins_full,
    priceExterior: s.price_exterior, priceInterior: s.price_interior, priceFull: s.price_full,
    maxWorkers: s.max_workers, isActive: s.is_active, lat: s.lat, lng: s.lng,
    createdAt: s.created_at, updatedAt: s.updated_at,
  };
}

function booking(b) {
  const ts = (v) => v ? new Date(v).toISOString() : null;
  return {
    id: b.id, shopId: b.shop_id, customerName: b.customer_name,
    customerPhone: b.customer_phone, washType: b.wash_type,
    scheduledDate: b.scheduled_date, scheduledTime: b.scheduled_time,
    price: b.price, status: b.status, kind: b.kind, bayNumber: b.bay_number,
    licensePlate: b.license_plate, carModel: b.car_model, carType: b.car_type,
    notes: b.notes, paymentStatus: b.payment_status,
    etaArrivalAt: ts(b.eta_arrival_at), etaReadyAt: ts(b.eta_ready_at),
    arrivedAt: ts(b.arrived_at), washStartedAt: ts(b.wash_started_at),
    washFinishedAt: ts(b.wash_finished_at),
    createdAt: ts(b.created_at), updatedAt: ts(b.updated_at),
  };
}

function service(s) {
  return {
    id: s.id, shopId: s.shop_id, name: s.name, description: s.description,
    price: s.price, durationMins: s.duration_mins, displayOrder: s.display_order,
    isActive: s.is_active, createdAt: s.created_at, updatedAt: s.updated_at,
  };
}

// ─── BUSINESS LOGIC ───────────────────────────────────────────────────────────
function today() { return new Date().toISOString().slice(0,10); }
function nowTime() {
  const n = new Date();
  return `${String(n.getHours()).padStart(2,"0")}:${String(n.getMinutes()).padStart(2,"0")}`;
}

async function resolveService(shopId, washType) {
  const svc = await db1(
    `SELECT price, duration_mins FROM wash_services WHERE shop_id=$1 AND name=$2 AND is_active=1 LIMIT 1`,
    [shopId, washType]
  );
  if (svc) return { price: svc.price, durationMins: svc.duration_mins };
  const s = await db1(`SELECT * FROM wash_shops WHERE id=$1`, [shopId]);
  if (!s) return { price: 0, durationMins: 30 };
  const map = {
    exterior: { price: s.price_exterior, durationMins: s.mins_exterior },
    interior: { price: s.price_interior, durationMins: s.mins_interior },
  };
  return map[washType] || { price: s.price_full, durationMins: s.mins_full };
}

async function inProgressCount(shopId) {
  const r = await db1(
    `SELECT COUNT(*) as cnt FROM wash_bookings WHERE shop_id=$1 AND status='in_progress' AND kind != 'maintenance'`,
    [shopId]
  );
  return parseInt(r?.cnt || 0, 10);
}

async function getFreeBay(shopId, maxWorkers) {
  const occupied = await db(
    `SELECT bay_number FROM wash_bookings WHERE shop_id=$1 AND status='in_progress' AND bay_number IS NOT NULL`,
    [shopId]
  );
  const taken = new Set(occupied.map(r => r.bay_number));
  for (let i = 1; i <= maxWorkers; i++) {
    if (!taken.has(i)) return i;
  }
  return null;
}

async function autoAdvance(shopId, freedBay) {
  const next = await db1(
    `SELECT * FROM wash_bookings WHERE shop_id=$1 AND status='pending' AND kind IN ('reservation','walkin') AND bay_number IS NULL ORDER BY created_at ASC LIMIT 1`,
    [shopId]
  );
  if (!next) return null;
  const { durationMins } = await resolveService(shopId, next.wash_type);
  const now = new Date();
  const eta = new Date(now.getTime() + durationMins * 60000);
  const [advanced] = await db(
    `UPDATE wash_bookings SET status='in_progress', bay_number=$1, arrived_at=NOW(), wash_started_at=NOW(), eta_ready_at=$2, updated_at=NOW() WHERE id=$3 RETURNING *`,
    [freedBay, eta, next.id]
  );
  console.log(`Auto-advanced booking ${next.id} to bay ${freedBay}`);
  return advanced;
}

// ─── ROUTER ──────────────────────────────────────────────────────────────────
async function route(req, res) {
  const url = new URL(req.url, `http://localhost`);
  // Strip /api prefix
  const p = url.pathname.replace(/^\/api/, "") || "/";
  const m = req.method.toUpperCase();

  // CORS
  if (m === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  // Health
  if (p === "/status" || p === "/health") {
    return respond(res, 200, { status: "ok", time: new Date().toISOString() });
  }

  // Debug route — shows file system structure
  if (p === "/debug") {
    const info = {
      __dirname,
      cwd: process.cwd(),
      files_cwd: fs.readdirSync(process.cwd()).slice(0,20),
      files_dirname: fs.readdirSync(__dirname).slice(0,20),
    };
    try { info.files_app = fs.readdirSync("/app").slice(0,20); } catch {}
    return respond(res, 200, info);
  }

  // Serve HTML pages
  const pages = { "/": "clearq.html", "/partner": "clearq-partner.html", "/manager": "clearq-manager.html" };
  if (pages[p]) {
    // Search multiple possible locations
    const locations = [
      path.join(__dirname, pages[p]),
      path.join(__dirname, "templates", pages[p]),
      path.join(process.cwd(), pages[p]),
      path.join(process.cwd(), "templates", pages[p]),
      "/app/" + pages[p],
      "/app/templates/" + pages[p],
    ];
    let html = null;
    let foundPath = null;
    for (const loc of locations) {
      if (fs.existsSync(loc)) { html = fs.readFileSync(loc, "utf-8"); foundPath = loc; break; }
    }
    if (html) {
      console.log(`Serving ${pages[p]} from ${foundPath}`);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...CORS_HEADERS });
      return res.end(html);
    }
    console.log(`HTML not found: ${pages[p]}, searched: ${locations.join(', ')}`);
    return respond(res, 404, { error: "Page not found", searched: locations });
  }

  try {
    // ── PUBLIC ────────────────────────────────────────────────────────────

    // GET /wash/shops
    if (m === "GET" && p === "/wash/shops") {
      const shops = await db(`SELECT * FROM wash_shops WHERE is_active=1 ORDER BY id`);
      return respond(res, 200, shops.map(shop));
    }

    // GET /wash/shops/:id
    if (m === "GET" && /^\/wash\/shops\/\d+$/.test(p)) {
      const id = +p.split("/")[3];
      const s = await db1(`SELECT * FROM wash_shops WHERE id=$1`, [id]);
      if (!s) return respond(res, 404, { error: "Shop not found" });
      return respond(res, 200, shop(s));
    }

    // GET /wash/shops/:id/services
    if (m === "GET" && /^\/wash\/shops\/\d+\/services/.test(p)) {
      const id = +p.split("/")[3];
      const services = await db(`SELECT * FROM wash_services WHERE shop_id=$1 AND is_active=1 ORDER BY display_order`, [id]);
      return respond(res, 200, services.map(service));
    }

    // GET /wash/queue/:shopId
    if (m === "GET" && /^\/wash\/queue\/\d+$/.test(p)) {
      const shopId = +p.split("/")[3];
      const s = await db1(`SELECT * FROM wash_shops WHERE id=$1`, [shopId]);
      const maxBays = s?.max_workers || 3;
      const defaultDur = s?.slot_duration_mins || 30;
      const nowMs = Date.now();

      // Get all unfinished bookings with their actual service duration
      const allBookings = await db(
        `SELECT b.status, b.eta_ready_at, b.wash_started_at, b.eta_arrival_at,
                b.created_at, b.kind, COALESCE(sv.duration_mins, $2) as duration_mins
         FROM wash_bookings b
         LEFT JOIN wash_services sv ON sv.shop_id = b.shop_id AND sv.name = b.wash_type AND sv.is_active = 1
         WHERE b.shop_id = $1 AND b.status IN ('pending','in_progress')
         ORDER BY b.created_at ASC`,
        [shopId, defaultDur]
      );

      const pending = allBookings.filter(b => b.status === 'pending' && b.kind !== 'maintenance');
      const active = allBookings.filter(b => b.status === 'in_progress' && b.kind !== 'maintenance');
      const occupiedBays = allBookings.filter(b => b.status === 'in_progress').length;
      const freeBays = Math.max(0, maxBays - occupiedBays);

      // QUEUE SIMULATION:
      // Every booking (active + pending) occupies a bay slot.
      // A new customer waits until the soonest bay is free AFTER
      // all existing bookings are assigned.
      let bays = Array(maxBays).fill(nowMs);

      // 1. Assign active washes to bays (already in progress)
      for (const b of active) {
        bays.sort((a, x) => a - x);
        const dur = parseInt(b.duration_mins) || defaultDur;
        const finishAt = b.eta_ready_at
          ? new Date(b.eta_ready_at).getTime()
          : new Date(b.wash_started_at || b.created_at).getTime() + dur * 60000;
        bays[0] = finishAt;
      }

      // 2. Assign pending bookings to bays in order they were booked
      for (const b of pending) {
        bays.sort((a, x) => a - x);
        const dur = parseInt(b.duration_mins) || defaultDur;
        const bayFreeAt = bays[0];
        // Start when bay is free (customer is assumed to arrive on time)
        bays[0] = bayFreeAt + dur * 60000;
      }

      // 3. New customer waits until soonest bay is free
      bays.sort((a, x) => a - x);
      const nextFree = bays[0];
      const waitMins = nextFree > nowMs
        ? Math.max(1, Math.round((nextFree - nowMs) / 60000))
        : 0;

      return respond(res, 200, {
        queueCount: pending.length,
        activeCount: active.length,
        maxBays,
        freeBays,
        minsUntilNextFree: waitMins,
      });
    }

    // GET /wash/reservations/:id
    if (m === "GET" && /^\/wash\/reservations\/\d+$/.test(p)) {
      const id = +p.split("/")[3];
      const b = await db1(`SELECT * FROM wash_bookings WHERE id=$1`, [id]);
      if (!b) return respond(res, 404, { error: "Not found" });
      return respond(res, 200, booking(b));
    }

    // POST /wash/reservations
    if (m === "POST" && p === "/wash/reservations") {
      const body = await readBody(req);
      const { shopId, customerName, customerPhone, washType, scheduledDate, scheduledTime, licensePlate, carModel, etaMinutesOverride, customerLat, customerLng } = body;
      if (!shopId || !customerName || !customerPhone || !washType) {
        return respond(res, 400, { error: "shopId, customerName, customerPhone, washType required" });
      }
      const s = await db1(`SELECT * FROM wash_shops WHERE id=$1`, [shopId]);
      if (!s) return respond(res, 404, { error: "Shop not found" });

      const { price, durationMins } = await resolveService(shopId, washType);
      const now = new Date();
      const ipCount = await inProgressCount(shopId);
      const maxBays = s.max_workers;
      const slotDur = s.slot_duration_mins || durationMins;

      // Calculate wait time properly
      let queueWait = 0;
      if (ipCount >= maxBays) {
        const active = await db(
          `SELECT eta_ready_at, wash_started_at FROM wash_bookings WHERE shop_id=$1 AND status='in_progress' AND kind IN ('reservation','walkin')`,
          [shopId]
        );
        let soonest = Infinity;
        for (const b of active) {
          const freeAt = b.eta_ready_at
            ? new Date(b.eta_ready_at).getTime()
            : b.wash_started_at
              ? new Date(b.wash_started_at).getTime() + slotDur * 60000
              : Date.now() + slotDur * 60000;
          if (freeAt < soonest) soonest = freeAt;
        }
        queueWait = soonest === Infinity ? slotDur : Math.max(1, Math.round((soonest - Date.now()) / 60000));
      }

      const driveMins = etaMinutesOverride || 0;
      const startMins = Math.max(driveMins, queueWait);
      const etaArrival = new Date(now.getTime() + startMins * 60000);
      const etaReady = new Date(etaArrival.getTime() + durationMins * 60000);

      const [created] = await db(
        `INSERT INTO wash_bookings (shop_id,customer_name,customer_phone,wash_type,scheduled_date,scheduled_time,price,status,payment_status,kind,license_plate,car_model,eta_arrival_at,eta_ready_at,eta_source,customer_lat,customer_lng,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'pending','paid','reservation',$8,$9,$10,$11,$12,$13,$14,NOW(),NOW()) RETURNING *`,
        [shopId, customerName, customerPhone, washType,
          scheduledDate || today(), scheduledTime || nowTime(),
          price, licensePlate || null, carModel || null,
          etaArrival, etaReady, etaMinutesOverride ? "google" : "fallback",
          customerLat || null, customerLng || null]
      );
      return respond(res, 201, booking(created));
    }

    // GET /wash/eta
    if (m === "GET" && p === "/wash/eta") {
      const shopId = +url.searchParams.get("shopId");
      const fromLat = parseFloat(url.searchParams.get("fromLat"));
      const fromLng = parseFloat(url.searchParams.get("fromLng"));
      const s = await db1(`SELECT lat, lng, slot_duration_mins FROM wash_shops WHERE id=$1`, [shopId]);
      if (!s?.lat || !s?.lng || isNaN(fromLat) || isNaN(fromLng)) {
        return respond(res, 200, { etaMinutes: 15, source: "fallback" });
      }
      // Haversine distance
      const R = 6371;
      const dLat = (s.lat - fromLat) * Math.PI / 180;
      const dLon = (s.lng - fromLng) * Math.PI / 180;
      const a = Math.sin(dLat/2)**2 + Math.cos(fromLat*Math.PI/180) * Math.cos(s.lat*Math.PI/180) * Math.sin(dLon/2)**2;
      const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const etaMinutes = Math.max(3, Math.round(dist * 3.5)); // Cairo ~17km/h avg
      return respond(res, 200, { etaMinutes, source: "estimate", distanceKm: Math.round(dist*10)/10 });
    }

    // ── PARTNER AUTH ──────────────────────────────────────────────────────

    // POST /partners/login
    if (m === "POST" && p === "/partners/login") {
      const { username, password } = await readBody(req);
      if (!username || !password) return respond(res, 400, { error: "username and password required" });
      const partner = await db1(`SELECT * FROM wash_partners WHERE username=$1 AND is_active=1`, [username.trim().toLowerCase()]);
      if (!partner) return respond(res, 401, { error: "Invalid username or password" });
      const valid = await bcryptCompare(password, partner.password_hash);
      if (!valid) return respond(res, 401, { error: "Invalid username or password" });
      await db(`UPDATE wash_partners SET last_login_at=NOW() WHERE id=$1`, [partner.id]);
      const s = await db1(`SELECT * FROM wash_shops WHERE id=$1`, [partner.shop_id]);
      const token = signJWT({ partnerId: partner.id, shopId: partner.shop_id, username: partner.username });
      return respond(res, 200, {
        token,
        partner: { id: partner.id, shopId: partner.shop_id, username: partner.username },
        shop: s ? shop(s) : null,
      });
    }

    // ── PROTECTED PARTNER ROUTES ──────────────────────────────────────────
    const payload = verifyJWT(getToken(req));
    const shopMatch = p.match(/\/partners\/shop\/(\d+)/);
    const shopId = shopMatch ? +shopMatch[1] : null;

    if (p.startsWith("/partners/shop/") || p === "/partners/me") {
      if (!payload) return respond(res, 401, { error: "Unauthorized — please log in" });
      if (shopId && shopId !== payload.shopId) return respond(res, 403, { error: "Forbidden" });
    }

    // GET /partners/me
    if (m === "GET" && p === "/partners/me") {
      const s = await db1(`SELECT * FROM wash_shops WHERE id=$1`, [payload.shopId]);
      return respond(res, 200, { partner: { id: payload.partnerId, shopId: payload.shopId, username: payload.username }, shop: s ? shop(s) : null });
    }

    // GET /partners/shop/:id/queue
    if (m === "GET" && /\/partners\/shop\/\d+\/queue$/.test(p)) {
      const bookings = await db(
        `SELECT * FROM wash_bookings WHERE shop_id=$1 AND scheduled_date=$2 AND kind != 'scheduled' ORDER BY created_at DESC`,
        [shopId, today()]
      );
      return respond(res, 200, bookings.map(booking));
    }

    // GET /partners/shop/:id/bays
    if (m === "GET" && /\/partners\/shop\/\d+\/bays$/.test(p)) {
      const s = await db1(`SELECT * FROM wash_shops WHERE id=$1`, [shopId]);
      if (!s) return respond(res, 404, { error: "Shop not found" });
      const active = await db(
        `SELECT * FROM wash_bookings WHERE shop_id=$1 AND status IN ('pending','in_progress') AND bay_number IS NOT NULL`,
        [shopId]
      );
      // Bay map — in_progress/maintenance takes priority
      const byBay = new Map();
      for (const b of active) {
        const ex = byBay.get(b.bay_number);
        if (!ex || b.status === "in_progress" || b.kind === "maintenance") byBay.set(b.bay_number, b);
      }
      const bays = [];
      for (let i = 1; i <= s.max_workers; i++) {
        const b = byBay.get(i);
        let state = "free";
        if (b) {
          if (b.kind === "maintenance") state = "unavailable";
          else if (b.status === "in_progress") state = "in_wash";
          else if (b.kind === "walkin") state = "walkin";
          else state = "incoming";
        }
        bays.push({ bayNumber: i, state, booking: b && b.kind !== "maintenance" ? booking(b) : null, reason: b?.kind === "maintenance" ? b.notes : null });
      }
      return respond(res, 200, { shopId, maxBays: s.max_workers, bays });
    }

    // GET /partners/shop/:id/dashboard
    if (m === "GET" && /\/partners\/shop\/\d+\/dashboard$/.test(p)) {
      const date = url.searchParams.get("date") || today();
      const s = await db1(`SELECT * FROM wash_shops WHERE id=$1`, [shopId]);
      const bookings = await db(`SELECT * FROM wash_bookings WHERE shop_id=$1 AND scheduled_date=$2 ORDER BY scheduled_time`, [shopId, date]);
      const ratingRow = await db1(`SELECT AVG(stars)::numeric(3,1) as avg FROM wash_ratings WHERE shop_id=$1`, [shopId]);
      const completed = bookings.filter(b => b.status === "completed");
      return respond(res, 200, {
        date, totalBookings: bookings.length,
        pendingBookings: bookings.filter(b=>b.status==="pending").length,
        inProgressBookings: bookings.filter(b=>b.status==="in_progress").length,
        completedBookings: completed.length,
        cancelledBookings: bookings.filter(b=>b.status==="cancelled").length,
        totalRevenue: completed.reduce((sum,b)=>sum+(b.price||0),0),
        shopRating: ratingRow?.avg ? parseFloat(ratingRow.avg) : null,
        todayBookings: bookings.map(booking),
      });
    }

    // GET /partners/shop/:id/services
    if (m === "GET" && /\/partners\/shop\/\d+\/services$/.test(p)) {
      const services = await db(`SELECT * FROM wash_services WHERE shop_id=$1 ORDER BY display_order`, [shopId]);
      return respond(res, 200, services.map(service));
    }

    // POST /partners/shop/:id/services
    if (m === "POST" && /\/partners\/shop\/\d+\/services$/.test(p)) {
      const { name, description, price, durationMins, displayOrder } = await readBody(req);
      if (!name || price == null || durationMins == null) return respond(res, 400, { error: "name, price, durationMins required" });
      const [svc] = await db(
        `INSERT INTO wash_services (shop_id,name,description,price,duration_mins,display_order,is_active,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,1,NOW(),NOW()) RETURNING *`,
        [shopId, name.trim(), description?.trim()||null, price, durationMins, displayOrder||0]
      );
      return respond(res, 201, service(svc));
    }

    // PUT /partners/shop/:id/services/:svcId
    if (m === "PUT" && /\/partners\/shop\/\d+\/services\/\d+$/.test(p)) {
      const svcId = +p.split("/").pop();
      const body = await readBody(req);
      const ex = await db1(`SELECT * FROM wash_services WHERE id=$1 AND shop_id=$2`, [svcId, shopId]);
      if (!ex) return respond(res, 404, { error: "Service not found" });
      const [updated] = await db(
        `UPDATE wash_services SET name=COALESCE($1,name), description=COALESCE($2,description), price=COALESCE($3,price), duration_mins=COALESCE($4,duration_mins), display_order=COALESCE($5,display_order), is_active=COALESCE($6,is_active), updated_at=NOW() WHERE id=$7 RETURNING *`,
        [body.name?.trim()||null, body.description?.trim()||null, body.price||null, body.durationMins||null, body.displayOrder||null, body.isActive!=null?(body.isActive?1:0):null, svcId]
      );
      return respond(res, 200, service(updated));
    }

    // DELETE /partners/shop/:id/services/:svcId
    if (m === "DELETE" && /\/partners\/shop\/\d+\/services\/\d+$/.test(p)) {
      const svcId = +p.split("/").pop();
      await db(`DELETE FROM wash_services WHERE id=$1 AND shop_id=$2`, [svcId, shopId]);
      return respond(res, 200, { success: true });
    }

    // GET /partners/shop/:id/settings
    if (m === "GET" && /\/partners\/shop\/\d+\/settings$/.test(p)) {
      const s = await db1(`SELECT * FROM wash_shops WHERE id=$1`, [shopId]);
      if (!s) return respond(res, 404, { error: "Not found" });
      return respond(res, 200, { priceExterior:s.price_exterior, priceInterior:s.price_interior, priceFull:s.price_full, minsExterior:s.mins_exterior, minsInterior:s.mins_interior, minsFull:s.mins_full, maxWorkers:s.max_workers });
    }

    // PATCH /partners/shop/:id/settings
    if (m === "PATCH" && /\/partners\/shop\/\d+\/settings$/.test(p)) {
      const body = await readBody(req);
      const map = { priceExterior:"price_exterior", priceInterior:"price_interior", priceFull:"price_full", minsExterior:"mins_exterior", minsInterior:"mins_interior", minsFull:"mins_full" };
      const sets = []; const vals = []; let i = 1;
      for (const [k,col] of Object.entries(map)) {
        if (body[k]!=null) { sets.push(`${col}=$${i++}`); vals.push(+body[k]); }
      }
      if (!sets.length) return respond(res, 400, { error: "No valid fields" });
      vals.push(shopId);
      const [updated] = await db(`UPDATE wash_shops SET ${sets.join(",")},updated_at=NOW() WHERE id=$${i} RETURNING *`, vals);
      return respond(res, 200, shop(updated));
    }

    // PATCH /partners/shop/:id/reservations/:bookingId/start — FIXED
    if (m === "PATCH" && /\/partners\/shop\/\d+\/reservations\/\d+\/start$/.test(p)) {
      const parts = p.split("/");
      const bookingId = +parts[parts.length-2];
      const b = await db1(`SELECT * FROM wash_bookings WHERE id=$1 AND shop_id=$2`, [bookingId, shopId]);
      if (!b) return respond(res, 404, { error: "Booking not found" });
      if (b.status !== "pending") return respond(res, 409, { error: `Booking is already ${b.status}` });

      const s = await db1(`SELECT * FROM wash_shops WHERE id=$1`, [shopId]);
      // FIXED: exclude maintenance from count
      const ipCount = await inProgressCount(shopId);
      if (ipCount >= s.max_workers) {
        return respond(res, 409, { error: `All ${s.max_workers} bays are occupied. Wait for a bay to free up.` });
      }

      const freeBay = await getFreeBay(shopId, s.max_workers);
      const { durationMins } = await resolveService(shopId, b.wash_type);
      const now = new Date();
      const eta = new Date(now.getTime() + durationMins * 60000);

      const [updated] = await db(
        `UPDATE wash_bookings SET status='in_progress', bay_number=$1, arrived_at=NOW(), wash_started_at=NOW(), eta_ready_at=$2, updated_at=NOW() WHERE id=$3 RETURNING *`,
        [freeBay, eta, bookingId]
      );
      return respond(res, 200, booking(updated));
    }

    // PATCH /partners/shop/:id/reservations/:bookingId/done — FIXED
    if (m === "PATCH" && /\/partners\/shop\/\d+\/reservations\/\d+\/done$/.test(p)) {
      const parts = p.split("/");
      const bookingId = +parts[parts.length-2];
      const b = await db1(`SELECT * FROM wash_bookings WHERE id=$1 AND shop_id=$2`, [bookingId, shopId]);
      if (!b) return respond(res, 404, { error: "Booking not found" });

      const [updated] = await db(
        `UPDATE wash_bookings SET status='completed', wash_finished_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING *`,
        [bookingId]
      );

      // Service history
      const s = await db1(`SELECT name FROM wash_shops WHERE id=$1`, [shopId]);
      const startedAt = b.wash_started_at || b.arrived_at || b.created_at;
      const dur = Math.max(1, Math.round((Date.now() - new Date(startedAt).getTime()) / 60000));
      await db(
        `INSERT INTO wash_service_history (customer_phone,customer_name,shop_id,shop_name,wash_type,duration_mins,price,booking_id,completed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
        [b.customer_phone, b.customer_name, shopId, s?.name||"", b.wash_type, dur, b.price, bookingId]
      );

      // Auto-advance queue
      if (b.bay_number != null) await autoAdvance(shopId, b.bay_number);

      return respond(res, 200, booking(updated));
    }

    // POST /partners/shop/:id/walkin — FIXED
    if (m === "POST" && /\/partners\/shop\/\d+\/walkin$/.test(p)) {
      const { washType, customerName, customerPhone, licensePlate } = await readBody(req);
      if (!washType) return respond(res, 400, { error: "washType required" });
      const s = await db1(`SELECT * FROM wash_shops WHERE id=$1`, [shopId]);
      if (!s) return respond(res, 404, { error: "Shop not found" });

      const { price, durationMins } = await resolveService(shopId, washType);
      const now = new Date();
      const freeBay = await getFreeBay(shopId, s.max_workers);

      if (freeBay !== null) {
        const eta = new Date(now.getTime() + durationMins * 60000);
        const [created] = await db(
          `INSERT INTO wash_bookings (shop_id,customer_name,customer_phone,wash_type,scheduled_date,scheduled_time,price,status,payment_status,kind,bay_number,arrived_at,wash_started_at,eta_ready_at,license_plate,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'in_progress','paid','walkin',$8,NOW(),NOW(),$9,$10,NOW(),NOW()) RETURNING *`,
          [shopId, customerName||"Walk-in", customerPhone||"", washType, today(), nowTime(), price, freeBay, eta, licensePlate||null]
        );
        return respond(res, 201, booking(created));
      } else {
        const [created] = await db(
          `INSERT INTO wash_bookings (shop_id,customer_name,customer_phone,wash_type,scheduled_date,scheduled_time,price,status,payment_status,kind,license_plate,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'pending','paid','walkin',$8,NOW(),NOW()) RETURNING *`,
          [shopId, customerName||"Walk-in", customerPhone||"", washType, today(), nowTime(), price, licensePlate||null]
        );
        return respond(res, 201, booking(created));
      }
    }

    // PATCH /partners/shop/:id/bays/:bayNumber
    if (m === "PATCH" && /\/partners\/shop\/\d+\/bays\/\d+$/.test(p)) {
      const bayNumber = +p.split("/").pop();
      const { state, reason } = await readBody(req);
      const s = await db1(`SELECT * FROM wash_shops WHERE id=$1`, [shopId]);
      if (!s) return respond(res, 404, { error: "Shop not found" });
      if (state === "free") {
        await db(`UPDATE wash_bookings SET status='cancelled', updated_at=NOW() WHERE shop_id=$1 AND bay_number=$2 AND kind='maintenance' AND status IN ('pending','in_progress')`, [shopId, bayNumber]);
        return respond(res, 200, { bayNumber, state: "free" });
      }
      if (state === "unavailable") {
        const ex = await db1(`SELECT id FROM wash_bookings WHERE shop_id=$1 AND bay_number=$2 AND kind='maintenance' AND status IN ('pending','in_progress') LIMIT 1`, [shopId, bayNumber]);
        if (ex) {
          await db(`UPDATE wash_bookings SET notes=$1, updated_at=NOW() WHERE id=$2`, [reason||null, ex.id]);
        } else {
          const eta = new Date(Date.now() + 24*3600*1000);
          await db(
            `INSERT INTO wash_bookings (shop_id,customer_name,customer_phone,wash_type,scheduled_date,scheduled_time,price,status,payment_status,kind,bay_number,arrived_at,wash_started_at,eta_ready_at,notes,created_at,updated_at)
             VALUES ($1,'Bay Unavailable','','exterior',$2,$3,0,'in_progress','paid','maintenance',$4,NOW(),NOW(),$5,$6,NOW(),NOW())`,
            [shopId, today(), nowTime(), bayNumber, eta, reason||null]
          );
        }
        return respond(res, 200, { bayNumber, state: "unavailable", reason: reason||null });
      }
      return respond(res, 400, { error: "state must be free or unavailable" });
    }

    // POST /partners/shop/:id/bays
    if (m === "POST" && /\/partners\/shop\/\d+\/bays$/.test(p)) {
      const s = await db1(`SELECT max_workers FROM wash_shops WHERE id=$1`, [shopId]);
      if (s.max_workers >= 10) return respond(res, 400, { error: "Maximum 10 bays" });
      const [updated] = await db(`UPDATE wash_shops SET max_workers=max_workers+1,updated_at=NOW() WHERE id=$1 RETURNING max_workers`, [shopId]);
      return respond(res, 201, { maxBays: updated.max_workers });
    }

    // DELETE /partners/shop/:id/bays
    if (m === "DELETE" && /\/partners\/shop\/\d+\/bays$/.test(p)) {
      const s = await db1(`SELECT max_workers FROM wash_shops WHERE id=$1`, [shopId]);
      if (s.max_workers <= 1) return respond(res, 400, { error: "Cannot remove last bay" });
      const active = await db1(`SELECT id FROM wash_bookings WHERE shop_id=$1 AND bay_number=$2 AND status IN ('pending','in_progress') LIMIT 1`, [shopId, s.max_workers]);
      if (active) return respond(res, 409, { error: "Bay is in use" });
      const [updated] = await db(`UPDATE wash_shops SET max_workers=max_workers-1,updated_at=NOW() WHERE id=$1 RETURNING max_workers`, [shopId]);
      return respond(res, 200, { maxBays: updated.max_workers });
    }

    // POST /wash/ratings
    if (m === "POST" && p === "/wash/ratings") {
      const { bookingId, shopId: sId, stars, comment, customerName } = await readBody(req);
      if (!sId || !stars) return respond(res, 400, { error: "shopId and stars required" });
      const [r] = await db(
        `INSERT INTO wash_ratings (booking_id,shop_id,customer_name,stars,comment,created_at) VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING *`,
        [bookingId||null, sId, customerName||"", stars, comment||null]
      );
      return respond(res, 201, r);
    }

    return respond(res, 404, { error: "Route not found", path: p });

  } catch (err) {
    console.error(`[ERROR] ${m} ${p}:`, err.message);
    return respond(res, 500, { error: "Internal server error", detail: err.message });
  }
}

// ─── START ────────────────────────────────────────────────────────────────────
initDB().then(() => {
  const server = http.createServer(route);
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`\n✓ ClearQ API Server running on port ${PORT}`);
    console.log(`  Customer app:  http://localhost:${PORT}/`);
    console.log(`  Partner:       http://localhost:${PORT}/partner`);
    console.log(`  Manager:       http://localhost:${PORT}/manager`);
    console.log(`  API health:    http://localhost:${PORT}/api/status\n`);
  });
}).catch(err => {
  console.error("Failed to start:", err.message);
  process.exit(1);
});
