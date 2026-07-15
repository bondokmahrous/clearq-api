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
const VAPID_PUBLIC_KEY = 'BIoeWmSUr0DFx8VAIwKMRXVBaSFVwY9JLrdEG9srDh_4jt5NyPns3nB587BzRuZxjfPsDlVzyqbMdOd_WDs5PnM';
const VAPID_PRIVATE_KEY = 'jt5NyPns3nB587BzRuZxjfPsDlVzyqbMdOd_WDs5PnM';
const VAPID_SUBJECT = 'mailto:bondokmahrous@gmail.com';
const GOOGLE_MAPS_API_KEY = 'AIzaSyA9PAlul3ku2yuaWaS82ZdDHA2dYmAS9as';
const OWNER_KEY = 'Bondok@23'; // must match OWNER_PASSWORD in clearq-owner.html
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const MAIL_FROM = process.env.MAIL_FROM || 'ClearQ <info@clearq.online>';

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
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES wash_users(id),
      partner_id INT REFERENCES wash_partners(id),
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS wash_users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      car_model TEXT,
      license_plate TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS user_cars (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES wash_users(id) ON DELETE CASCADE,
      make TEXT,
      model TEXT NOT NULL,
      color TEXT,
      license_plate TEXT,
      car_type TEXT,
      is_default INT NOT NULL DEFAULT 0,
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
    CREATE TABLE IF NOT EXISTS wash_addons (
      id SERIAL PRIMARY KEY,
      shop_id INT NOT NULL REFERENCES wash_shops(id),
      name TEXT NOT NULL,
      description TEXT,
      price INT NOT NULL DEFAULT 0,
      duration_mins INT NOT NULL DEFAULT 0,
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
      user_id INT REFERENCES wash_users(id),
      clerk_user_id TEXT,
      customer_name TEXT NOT NULL DEFAULT '',
      stars INT NOT NULL,
      comment TEXT,
      photo_url TEXT,
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
  // Add photo_url to ratings if not exists
  await db(`ALTER TABLE wash_ratings ADD COLUMN IF NOT EXISTS photo_url TEXT`);
  await db(`ALTER TABLE wash_ratings ADD COLUMN IF NOT EXISTS user_id INT REFERENCES wash_users(id)`);
  // Add user_id and car_id to bookings for linking to accounts
  await db(`ALTER TABLE wash_bookings ADD COLUMN IF NOT EXISTS user_id INT REFERENCES wash_users(id)`);
  await db(`ALTER TABLE wash_bookings ADD COLUMN IF NOT EXISTS car_id INT`);
  // Snapshot of chosen add-on items (name/price/durationMins at booking time) so later edits to
  // the shop's add-on catalog don't retroactively change what an existing booking is shown as.
  await db(`ALTER TABLE wash_bookings ADD COLUMN IF NOT EXISTS addons JSONB DEFAULT '[]'::jsonb`);
  // Walk-ins now capture the same car detail (make/model/color) customers already give at signup.
  await db(`ALTER TABLE wash_bookings ADD COLUMN IF NOT EXISTS car_color TEXT`);
  // Free-text directions the wash centre can set (e.g. "blue gate next to the Total station")
  await db(`ALTER TABLE wash_shops ADD COLUMN IF NOT EXISTS location_description TEXT`);
  // Ghost/test shops: hidden from the public shop list and owner revenue aggregates, reachable
  // only via a secret URL carrying this slug — lets the owner test real bookings/dashboards
  // without touching real centres or polluting real business stats.
  await db(`ALTER TABLE wash_shops ADD COLUMN IF NOT EXISTS secret_slug TEXT`);
  await db(`ALTER TABLE wash_shops ADD COLUMN IF NOT EXISTS is_test INT DEFAULT 0`);
      // CARHUB isn't launching publicly yet — hide it as a ghost shop, reachable only via its
  // secret slug, until it's ready to go live. Guarded so it only applies once.
  await db(`UPDATE wash_shops SET is_active=0, is_test=1, secret_slug='carhub' WHERE id=5 AND secret_slug IS NULL`);
  // Lets a centre stop taking new online bookings temporarily (overwhelmed, closing early,
  // short-staffed) without touching individual bays or is_active — walk-ins are unaffected,
  // that's a staff-at-the-counter decision, not something this toggle needs to control.
  await db(`ALTER TABLE wash_shops ADD COLUMN IF NOT EXISTS is_paused INT DEFAULT 0`);
  // Email a wash centre can set from their own dashboard to get notified the moment a customer books online.
  await db(`ALTER TABLE wash_shops ADD COLUMN IF NOT EXISTS notification_email TEXT`);
  // Hard guarantee against two active washes ever colliding on the same physical bay — found
  // this happening for real (two concurrent "Start" clicks both saw the same bay as free before
  // either write landed). The application-level check-then-assign in the /start endpoint can't
  // fully close that race on its own, so this constraint is the actual source of truth: the DB
  // itself will reject a duplicate (shop_id, bay_number) among in_progress bookings.
  await db(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_shop_active_bay ON wash_bookings (shop_id, bay_number) WHERE status = 'in_progress' AND bay_number IS NOT NULL`);
  // Password reset: short-lived hashed code + expiry per user
  await db(`ALTER TABLE wash_users ADD COLUMN IF NOT EXISTS reset_code_hash TEXT`);
  await db(`ALTER TABLE wash_users ADD COLUMN IF NOT EXISTS reset_code_expires TIMESTAMPTZ`);
  // Migrate existing user car_model/license_plate into user_cars as their first car
  await db(`
    INSERT INTO user_cars (user_id, model, license_plate, is_default)
    SELECT id, car_model, license_plate, 1 FROM wash_users
    WHERE car_model IS NOT NULL AND car_model != ''
    AND NOT EXISTS (SELECT 1 FROM user_cars WHERE user_cars.user_id = wash_users.id)
  `);
  await ensureShopServices();
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

// One-time migration: ensure every shop has services rows based on its price fields
async function ensureShopServices() {
  const allShops = await db(`SELECT * FROM wash_shops`);
  for (const s of allShops) {
    const existing = await db1(`SELECT id FROM wash_services WHERE shop_id=$1 LIMIT 1`, [s.id]);
    if (existing) continue; // already has services
    const rows = [
      { name: 'exterior', desc: 'Exterior hand wash', price: s.price_exterior, dur: s.mins_exterior },
      { name: 'interior', desc: 'Interior vacuum and detail', price: s.price_interior, dur: s.mins_interior },
      { name: 'full', desc: 'Complete exterior and interior wash', price: s.price_full, dur: s.mins_full },
    ].filter(r => r.price > 0);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      await db(
        `INSERT INTO wash_services (shop_id,name,description,price,duration_mins,display_order,is_active,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,1,NOW(),NOW())`,
        [s.id, r.name, r.desc, r.price, r.dur, i]
      );
    }
    if (rows.length) console.log(`Seeded ${rows.length} services for shop ${s.id} (${s.name})`);
  }
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

// ─── EMAIL (Resend HTTP API — raw SMTP is blocked outbound on Railway's Hobby plan) ──
async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY) {
    console.error("Email not sent — RESEND_API_KEY is not configured:", subject, "to", to);
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: MAIL_FROM, to, subject, html }),
    });
    if (!res.ok) {
      console.error("Email send failed:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("Email send failed:", e.message);
    return false;
  }
}

function fmtCairoTime(d) {
  if (!d) return "";
  return new Date(d).toLocaleTimeString("en-US", { timeZone: "Africa/Cairo", hour: "numeric", minute: "2-digit" });
}

const BOOKING_EMAIL_COPY = {
  confirmed: {
    subject: (shopName) => `Booking confirmed at ${shopName}`,
    heading: "Booking Confirmed ✅",
    body: (b, shopName) => `
      <p>Hi ${b.customer_name || ""},</p>
      <p>Your <strong>${b.wash_type}</strong> wash at <strong>${shopName}</strong> is confirmed.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:6px 0;color:#64748b;">Estimated start</td><td style="padding:6px 0;font-weight:700;text-align:right;">${fmtCairoTime(b.eta_arrival_at)}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">Ready by</td><td style="padding:6px 0;font-weight:700;text-align:right;">${fmtCairoTime(b.eta_ready_at)}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b;">Price</td><td style="padding:6px 0;font-weight:700;text-align:right;">${b.price} EGP</td></tr>
      </table>
      <p style="color:#64748b;font-size:12px;">Drive straight in when it's time — no need to wait in line.</p>`,
  },
  started: {
    subject: (shopName) => `Your wash has started at ${shopName}`,
    heading: "Your wash has started 🚗",
    body: (b, shopName) => `
      <p>Hi ${b.customer_name || ""},</p>
      <p>Your <strong>${b.wash_type}</strong> wash at <strong>${shopName}</strong> is now underway.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:6px 0;color:#64748b;">Ready by</td><td style="padding:6px 0;font-weight:700;text-align:right;">${fmtCairoTime(b.eta_ready_at)}</td></tr>
      </table>`,
  },
  done: {
    subject: (shopName) => `Your car is ready at ${shopName}`,
    heading: "Your car is ready ✅",
    body: (b, shopName) => `
      <p>Hi ${b.customer_name || ""},</p>
      <p>Your <strong>${b.wash_type}</strong> wash at <strong>${shopName}</strong> is complete — come pick it up whenever you're ready.</p>
      <p style="margin-top:20px;">Enjoyed it? Leave a rating next time you open the ClearQ app — it helps a lot.</p>`,
  },
};

async function sendBookingEmail(booking, shopName, type) {
  try {
    if (!booking.user_id) return;
    const user = await db1(`SELECT email, name FROM wash_users WHERE id=$1`, [booking.user_id]);
    if (!user?.email) return;
    const copy = BOOKING_EMAIL_COPY[type];
    if (!copy) return;
    await sendEmail(user.email, copy.subject(shopName), `
      <div style="font-family:sans-serif;max-width:420px;margin:0 auto;">
        <h2 style="color:#21867B;">ClearQ</h2>
        <h3 style="margin-bottom:4px;">${copy.heading}</h3>
        ${copy.body(booking, shopName)}
      </div>`);
  } catch (e) { console.error("sendBookingEmail failed:", e.message); }
}

// Notifies a wash centre's own inbox (their notification_email, set from their dashboard) the
// moment a customer books online — same trigger as the partner push notification, just email.
// Never touches the booking flow's own response: any failure here is swallowed and logged.
async function notifyShopByEmail(shopId, shopName, notificationEmail, booking) {
  try {
    if (!notificationEmail) return;
    let customerEmail = null;
    if (booking.user_id) {
      const user = await db1(`SELECT email FROM wash_users WHERE id=$1`, [booking.user_id]);
      customerEmail = user?.email || null;
    }
    const car = [booking.car_color, booking.car_model].filter(Boolean).join(' ');
    const addonsList = Array.isArray(booking.addons) && booking.addons.length
      ? booking.addons.map(a => a.name).join(', ')
      : null;
    await sendEmail(notificationEmail, `New booking — ${booking.customer_name || 'Customer'}`, `
      <div style="font-family:sans-serif;max-width:460px;margin:0 auto;">
        <h2 style="color:#21867B;">ClearQ</h2>
        <h3 style="margin-bottom:4px;">New Booking at ${shopName} 🚗</h3>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
          <tr><td style="padding:6px 0;color:#64748b;">Customer</td><td style="padding:6px 0;font-weight:700;text-align:right;">${booking.customer_name || ''}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Phone</td><td style="padding:6px 0;font-weight:700;text-align:right;">${booking.customer_phone || ''}</td></tr>
          ${customerEmail ? `<tr><td style="padding:6px 0;color:#64748b;">Email</td><td style="padding:6px 0;font-weight:700;text-align:right;">${customerEmail}</td></tr>` : ''}
          <tr><td style="padding:6px 0;color:#64748b;">Car</td><td style="padding:6px 0;font-weight:700;text-align:right;">${[car, booking.license_plate].filter(Boolean).join(' · ') || 'Not provided'}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Service</td><td style="padding:6px 0;font-weight:700;text-align:right;">${booking.wash_type}</td></tr>
          ${addonsList ? `<tr><td style="padding:6px 0;color:#64748b;">Extras</td><td style="padding:6px 0;font-weight:700;text-align:right;">${addonsList}</td></tr>` : ''}
          <tr><td style="padding:6px 0;color:#64748b;">Arriving</td><td style="padding:6px 0;font-weight:700;text-align:right;">${fmtCairoTime(booking.eta_arrival_at)}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Ready by</td><td style="padding:6px 0;font-weight:700;text-align:right;">${fmtCairoTime(booking.eta_ready_at)}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Price</td><td style="padding:6px 0;font-weight:700;text-align:right;">${booking.price} EGP</td></tr>
        </table>
        <p style="color:#94a3b8;font-size:11px;">Booked via the ClearQ website.</p>
      </div>`);
  } catch (e) { console.error("notifyShopByEmail failed:", e.message); }
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
    locationDescription: s.location_description, isTest: !!s.is_test, isPaused: !!s.is_paused,
    notificationEmail: s.notification_email,
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
    licensePlate: b.license_plate, carModel: b.car_model, carColor: b.car_color, carType: b.car_type,
    notes: b.notes, paymentStatus: b.payment_status, addons: b.addons || [],
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

function addon(a) {
  return {
    id: a.id, shopId: a.shop_id, name: a.name, description: a.description,
    price: a.price, durationMins: a.duration_mins, displayOrder: a.display_order,
    isActive: a.is_active, createdAt: a.created_at, updatedAt: a.updated_at,
  };
}

// Looks up a shop's active add-on items by id, ignoring any id that's missing, inactive, or
// belongs to a different shop — so a stale/tampered id list from the client can't be used to
// pull in another shop's pricing or a deleted item's.
async function resolveAddons(shopId, addonIds) {
  if (!Array.isArray(addonIds) || !addonIds.length) return [];
  const ids = addonIds.map(id => +id).filter(id => Number.isInteger(id) && id > 0);
  if (!ids.length) return [];
  const rows = await db(
    `SELECT id, name, price, duration_mins FROM wash_addons WHERE shop_id=$1 AND id = ANY($2) AND is_active=1`,
    [shopId, ids]
  );
  return rows.map(r => ({ id: r.id, name: r.name, price: r.price, durationMins: r.duration_mins }));
}

// ─── BUSINESS LOGIC ───────────────────────────────────────────────────────────
function today() {
  // Use Cairo timezone (UTC+3)
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function nowTime() {
  const n = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return n.toISOString().slice(11, 16);
}

async function resolveService(shopId, washType) {
  // "Custom Wash" has no base service of its own — its entire price/duration comes from
  // whichever add-on items the customer picks, summed in by the caller.
  if (washType === 'custom') return { price: 0, durationMins: 0 };
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

// Shared bay-assignment simulation used by both the live queue display and new-booking pricing,
// so a booking scheduled for later today is accounted for the same way in both places.
// opts.hypotheticalArrival lets a caller ask "if someone arrived at this time, when would their bay free up?"
// without inserting anything — used by POST /wash/reservations to price a new booking.
const BAY_HANDOFF_BUFFER_MS = 10 * 60000; // slack after every wash before a bay counts as free again, in case it runs long

// HD CarWash-only: each bay only accepts a new booking once an hour has passed since its last
// one, regardless of the real service duration — a deliberate throttle, not a capacity limit.
// Every other shop keeps the normal duration-based bay math untouched.
const HD_CARWASH_SHOP_ID = 6;
const HD_CARWASH_BOOKING_SPACING_MS = 60 * 60000;

function bookingDurationMins(b, defaultDur) {
  if (b.eta_ready_at && b.eta_arrival_at) {
    const dur = Math.round((new Date(b.eta_ready_at) - new Date(b.eta_arrival_at)) / 60000);
    if (dur >= 5) return dur;
  }
  return parseInt(b.duration_mins) || defaultDur;
}

// Runs the shared arrival-ordered bay assignment used everywhere a "when would this booking
// actually get a bay" answer is needed. `items` should already be sorted by arrival time.
// Returns a Map from each item to its assigned start time (ms) — including active washes,
// so callers can compare a real booking's own promised arrival against what it would actually
// get once everything (including any hypothetical items folded into `items`) is assigned.
function assignBays(maxBays, active, items, defaultDur, nowMs) {
  // Guard against every bay being marked unavailable at once — an empty bays[] would make
  // bays[0] undefined and poison every downstream Math.max() with NaN.
  let bays = Array(Math.max(1, maxBays)).fill(nowMs);
  const startTimes = new Map();

  for (const b of active) {
    bays.sort((a, x) => a - x);
    const dur = bookingDurationMins(b, defaultDur);
    const finishAt = b.eta_ready_at
      ? new Date(b.eta_ready_at).getTime()
      : new Date(b.wash_started_at || b.created_at).getTime() + dur * 60000;
    startTimes.set(b, new Date(b.wash_started_at || b.created_at).getTime());
    bays[0] = finishAt + BAY_HANDOFF_BUFFER_MS;
  }

  for (const b of items) {
    bays.sort((a, x) => a - x);
    const dur = bookingDurationMins(b, defaultDur);
    const bayFreeAt = bays[0];
    // Booking can't start until customer arrives OR bay is free, whichever is LATER
    const arriveAt = b.eta_arrival_at ? new Date(b.eta_arrival_at).getTime() : nowMs;
    const startAt = Math.max(bayFreeAt, arriveAt);
    startTimes.set(b, startAt);
    bays[0] = startAt + dur * 60000 + BAY_HANDOFF_BUFFER_MS;
  }

  return startTimes;
}

// Same shape as assignBays(), but a bay's next booking always waits a fixed spacingMs after the
// previous one in that same bay — the real wash duration plays no part in when the bay opens up
// for its next booking. Each bay still runs independently, so with N bays the shop can take up
// to N bookings inside the same hour (one per bay), just never two in the same bay within an hour
// of each other. HD CarWash only — see HD_CARWASH_BOOKING_SPACING_MS.
function assignBaysFixedSpacing(maxBays, active, items, spacingMs, nowMs) {
  // Unlike assignBays(), an untouched bay isn't available right now — even the very first
  // booking a bay has ever taken waits the full spacing, same as every booking after it.
  let bays = Array(Math.max(1, maxBays)).fill(nowMs + spacingMs);
  const startTimes = new Map();

  for (const b of active) {
    bays.sort((a, x) => a - x);
    const startAt = new Date(b.wash_started_at || b.created_at).getTime();
    startTimes.set(b, startAt);
    bays[0] = startAt + spacingMs;
  }

  for (const b of items) {
    bays.sort((a, x) => a - x);
    const bayFreeAt = bays[0];
    const arriveAt = b.eta_arrival_at ? new Date(b.eta_arrival_at).getTime() : nowMs;
    const startAt = Math.max(bayFreeAt, arriveAt);
    startTimes.set(b, startAt);
    bays[0] = startAt + spacingMs;
  }

  return startTimes;
}

// Predicts which pending booking will most likely land in each currently-free bay next, purely
// for the Bay Status display — lets staff see "who's coming" per bay instead of just an empty
// "Ready for next customer" card. This is informational only: it doesn't write bay_number
// anywhere — the /start and walk-in endpoints still make the real, race-safe call based on
// whatever's actually free then. Deliberately a separate, self-contained pass rather than a change to
// assignBays()/getQueueState() — those are relied on everywhere for actual wait-time promises,
// and this is purely a display prediction that shouldn't risk touching that logic.
async function predictNextUpByBay(shopId) {
  const s = await db1(`SELECT * FROM wash_shops WHERE id=$1`, [shopId]);
  if (!s) return new Map();
  const maxBays = s.max_workers;
  const defaultDur = s.slot_duration_mins || 30;

  const rows = await db(
    `SELECT b.*, COALESCE(sv.duration_mins, $2) as duration_mins
     FROM wash_bookings b
     LEFT JOIN wash_services sv ON sv.shop_id = b.shop_id AND sv.name = b.wash_type AND sv.is_active = 1
     WHERE b.shop_id = $1 AND b.status IN ('pending','in_progress')
       AND (b.eta_ready_at IS NULL OR b.eta_ready_at > NOW() - INTERVAL '4 hours')`,
    [shopId, defaultDur]
  );
  const occupied = rows.filter(b => b.status === 'in_progress' && b.bay_number != null);
  const arrivalMs = b => b.eta_arrival_at ? new Date(b.eta_arrival_at).getTime() : new Date(b.created_at).getTime();
  const pending = rows.filter(b => b.status === 'pending' && b.kind !== 'maintenance').sort((a, b) => arrivalMs(a) - arrivalMs(b));

  const nowMs = Date.now();
  const bayFreeAt = new Map();
  for (let i = 1; i <= maxBays; i++) bayFreeAt.set(i, nowMs);
  for (const b of occupied) {
    const dur = bookingDurationMins(b, defaultDur);
    const finishAt = b.eta_ready_at
      ? new Date(b.eta_ready_at).getTime()
      : new Date(b.wash_started_at || b.created_at).getTime() + dur * 60000;
    bayFreeAt.set(b.bay_number, finishAt + BAY_HANDOFF_BUFFER_MS);
  }

  const nextUpByBay = new Map();
  for (const b of pending) {
    let bestBay = null, bestFree = Infinity;
    for (const [bayNum, freeAt] of bayFreeAt) {
      if (freeAt < bestFree) { bestFree = freeAt; bestBay = bayNum; }
    }
    if (bestBay == null) break;
    if (!nextUpByBay.has(bestBay)) nextUpByBay.set(bestBay, b);
    const dur = bookingDurationMins(b, defaultDur);
    const startAt = Math.max(bestFree, arrivalMs(b));
    bayFreeAt.set(bestBay, startAt + dur * 60000 + BAY_HANDOFF_BUFFER_MS);
  }
  return nextUpByBay;
}

async function getQueueState(shopId) {
  const s = await db1(`SELECT * FROM wash_shops WHERE id=$1`, [shopId]);
  const maxBays = s?.max_workers || 3;
  const defaultDur = s?.slot_duration_mins || 30;

  // The longest currently-active service this shop offers — used as the assumed duration for
  // the generic "if someone booked right now" preview shown before a customer has picked a
  // service. Using the shop's short slot interval (e.g. 30 min) there under-promised: it can
  // slot into gaps a longer, more commonly-booked service (e.g. a 60-min full wash) can't, so
  // the number shown looked far more available than what most customers would actually get
  // once they picked a real service. Erring toward the longest duration means the shown wait
  // is never an underestimate, whichever service they end up choosing.
  const maxServiceDur = await db1(
    `SELECT GREATEST(
       COALESCE((SELECT MAX(duration_mins) FROM wash_services WHERE shop_id=$1 AND is_active=1), 0),
       COALESCE($2, 0), COALESCE($3, 0), COALESCE($4, 0)
     ) as dur`,
    [shopId, s?.mins_exterior, s?.mins_interior, s?.mins_full]
  );
  const longestServiceDur = maxServiceDur?.dur > 0 ? maxServiceDur.dur : defaultDur;

  // Exclude bookings that were clearly forgotten (should have finished hours ago but were
  // never marked done) — otherwise a stale booking from days ago silently distorts live wait
  // times for real customers. These still show up in the partner/manager "Needs Attention" list.
  const allBookings = await db(
    `SELECT b.id, b.customer_name, b.wash_type, b.status, b.eta_ready_at, b.wash_started_at, b.eta_arrival_at,
            b.created_at, b.kind, COALESCE(sv.duration_mins, $2) as duration_mins
     FROM wash_bookings b
     LEFT JOIN wash_services sv ON sv.shop_id = b.shop_id AND sv.name = b.wash_type AND sv.is_active = 1
     WHERE b.shop_id = $1 AND b.status IN ('pending','in_progress')
       AND (b.eta_ready_at IS NULL OR b.eta_ready_at > NOW() - INTERVAL '4 hours')`,
    [shopId, defaultDur]
  );

  const pending = allBookings.filter(b => b.status === 'pending' && b.kind !== 'maintenance');
  const active = allBookings.filter(b => b.status === 'in_progress' && b.kind !== 'maintenance');
  const maintenanceCount = allBookings.filter(b => b.status === 'in_progress' && b.kind === 'maintenance').length;
  const occupiedBays = allBookings.filter(b => b.status === 'in_progress').length;
  const freeBays = Math.max(0, maxBays - occupiedBays);
  // A bay a partner has marked unavailable isn't doing a wash — it just isn't there for the
  // simulation to hand out. maintenanceCount is excluded from `active` (it's not a real booking
  // with a finish time), so without this, assignBays() would still treat that bay as an empty,
  // instantly-available slot no real or hypothetical booking ever claims — understating the wait.
  const effectiveMaxBays = Math.max(0, maxBays - maintenanceCount);

  // Process pending bookings in the order they'll actually arrive, not the order they were booked —
  // otherwise a slot booked hours ahead gets simulated as if it happens before a walk-in booked later
  // today but arriving sooner.
  const arrivalMs = b => b.eta_arrival_at ? new Date(b.eta_arrival_at).getTime() : new Date(b.created_at).getTime();

  return { maxBays, effectiveMaxBays, defaultDur, longestServiceDur, pending, active, freeBays, arrivalMs };
}

async function simulateBayQueue(shopId, opts = {}) {
  const { maxBays, effectiveMaxBays, defaultDur, longestServiceDur, pending, active, freeBays, arrivalMs } = await getQueueState(shopId);
  const nowMs = Date.now();
  const requestedArrival = (opts.hypotheticalArrival || new Date(nowMs)).getTime();
  // A caller with a specific service in mind (the booking modal) passes its real duration.
  // The generic "if someone booked right now" preview has no service picked yet, so it assumes
  // the shop's longest one — never showing a wait shorter than what any actual booking would get.
  const hypotheticalDur = opts.hypotheticalDurationMins || longestServiceDur;

  // HD CarWash swaps in a fixed hourly-per-bay assignment instead of the normal duration-based
  // one (see assignBaysFixedSpacing) — everything below this point (the non-displacement search)
  // is identical for both, it just calls whichever `assign`/`finishAt` pair applies.
  const isHdCarWash = shopId === HD_CARWASH_SHOP_ID;
  const assign = isHdCarWash
    ? (mb, act, items) => assignBaysFixedSpacing(mb, act, items, HD_CARWASH_BOOKING_SPACING_MS, nowMs)
    : (mb, act, items) => assignBays(mb, act, items, defaultDur, nowMs);
  const activeFinishAt = isHdCarWash
    ? (b) => new Date(b.wash_started_at || b.created_at).getTime() + HD_CARWASH_BOOKING_SPACING_MS
    : (b) => {
        const dur = bookingDurationMins(b, defaultDur);
        const finishAt = b.eta_ready_at
          ? new Date(b.eta_ready_at).getTime()
          : new Date(b.wash_started_at || b.created_at).getTime() + dur * 60000;
        return finishAt + BAY_HANDOFF_BUFFER_MS;
      };
  const pendingFinishAt = isHdCarWash
    ? (b, startMs) => startMs + HD_CARWASH_BOOKING_SPACING_MS
    : (b, startMs) => startMs + bookingDurationMins(b, defaultDur) * 60000 + BAY_HANDOFF_BUFFER_MS;

  // Answering "when could a new booking actually start" — whether it's a specific customer's
  // real ETA, or the generic "if someone booked right now" wait shown before they've even
  // opened the modal — must never come at the cost of an already-promised reservation. Simply
  // inserting the hypothetical at its earliest possible time and letting arrival order sort it
  // ahead of real bookings (the first version of this fix) let a purely hypothetical "arriving
  // now" preview jump the queue in front of real reservations arriving at nearly the same time,
  // silently pushing them later in the math than what they were actually promised — the same
  // problem the walk-in block exists to prevent, just here in the preview math instead of a
  // real booking. So: compute the baseline (what every real booking gets with no hypothetical
  // at all), then search forward from the requested arrival for the earliest moment a
  // hypothetical booking can be inserted without pushing any real booking past its own baseline.
  const baselineSorted = [...pending].sort((a, b) => arrivalMs(a) - arrivalMs(b));
  const baselineStarts = assign(effectiveMaxBays, active, baselineSorted);

  // Candidate times worth checking are exactly the moments bay availability can change —
  // no need to search continuously between them.
  const candidates = new Set([Math.max(nowMs, requestedArrival)]);
  for (const b of active) {
    candidates.add(activeFinishAt(b));
  }
  for (const b of pending) {
    candidates.add(new Date(b.eta_arrival_at).getTime());
    candidates.add(pendingFinishAt(b, baselineStarts.get(b)));
  }
  const sortedCandidates = [...candidates].filter(t => t >= requestedArrival).sort((a, b) => a - b);

  let hypotheticalStart = null;
  for (const candidateArrival of sortedCandidates) {
    const hypothetical = {
      __hypothetical: true,
      eta_arrival_at: new Date(candidateArrival),
      eta_ready_at: null,
      duration_mins: hypotheticalDur,
    };
    const withHyp = [...pending, hypothetical].sort((a, b) => arrivalMs(a) - arrivalMs(b));
    const withHypStarts = assign(effectiveMaxBays, active, withHyp);
    const displaces = pending.some(b => withHypStarts.get(b) > baselineStarts.get(b) + 60000);
    if (!displaces) {
      hypotheticalStart = withHypStarts.get(hypothetical);
      break;
    }
  }
  if (hypotheticalStart === null) {
    // Every candidate we checked would displace someone (shouldn't normally happen — the point
    // after everything real clears is always safe) — fall back to right after the last real
    // booking finishes.
    hypotheticalStart = Math.max(requestedArrival, nowMs, ...baselineSorted.map(b => pendingFinishAt(b, baselineStarts.get(b))));
  }

  if (opts.hypotheticalArrival) {
    return { maxBays, effectiveMaxBays, freeBays, queueCount: pending.length, activeCount: active.length, hypotheticalStart };
  }

  // New customer with no specific arrival given — treat as arriving right now (case above,
  // hypotheticalArrival defaulted to nowMs) and report how long until their bay is ready.
  const waitMins = hypotheticalStart > nowMs
    ? Math.max(1, Math.round((hypotheticalStart - nowMs) / 60000))
    : 0;

  return {
    queueCount: pending.length,
    activeCount: active.length,
    maxBays,
    effectiveMaxBays,
    freeBays,
    minsUntilNextFree: waitMins,
  };
}

// Checks whether taking a walk-in right now (for durationMins) would push any already-pending
// reservation's bay past its own promised arrival time — i.e. that customer would show up to
// no bay ready even though the system told them one would be. If so, the walk-in can't be
// added; whoever already has a promised slot keeps it. Returns the conflicting booking, or
// null if the walk-in is safe to add.
async function findWalkinConflict(shopId, durationMins) {
  const { effectiveMaxBays, defaultDur, pending, active, arrivalMs } = await getQueueState(shopId);
  const nowMs = Date.now();
  const dur = durationMins || defaultDur;
  // Deliberately always the normal duration-based model, even for HD CarWash — a walk-in is
  // physically standing at a bay that's free right now, and checking it against the fixed
  // hourly-spacing model (meant to throttle how far out *online* reservations get promised)
  // would falsely treat every bay as unavailable for the next hour and reject walk-ins that are
  // in reality no threat to any reservation, since the walk-in finishes long before any
  // hourly-spaced reservation is due to arrive.

  const withoutWalkin = [...pending].sort((a, b) => arrivalMs(a) - arrivalMs(b));
  const promisedStarts = assignBays(effectiveMaxBays, active, withoutWalkin, defaultDur, nowMs);

  const walkin = { __walkin: true, eta_arrival_at: new Date(nowMs), eta_ready_at: null, duration_mins: dur };
  const withWalkin = [...pending, walkin].sort((a, b) => arrivalMs(a) - arrivalMs(b));
  const actualStarts = assignBays(effectiveMaxBays, active, withWalkin, defaultDur, nowMs);

  for (const b of pending) {
    // Being reassigned to a different bay at the same time is fine — only a real conflict if
    // the walk-in pushes them later than what they were already promised (small tolerance for rounding).
    if (actualStarts.get(b) > promisedStarts.get(b) + 60000) return b;
  }
  return null;
}

// Retries `fn` when it fails on the uniq_shop_active_bay constraint (Postgres code 23505) —
// meaning another concurrent request claimed the same bay first. A handful of attempts is
// plenty; this only ever fires when two Start/walk-in requests genuinely race each other.
async function withBayRetry(fn) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (e.code === '23505' && e.constraint === 'uniq_shop_active_bay' && attempt < 4) continue;
      throw e;
    }
  }
}

// ─── PUSH NOTIFICATIONS ──────────────────────────────────────────────────────
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

async function sendPushNotification(subscription, payload) {
  try {
    const endpoint = new URL(subscription.endpoint);
    const audience = `${endpoint.protocol}//${endpoint.hostname}`;
    
    // Build VAPID JWT
    const header = { alg: 'ES256', typ: 'JWT' };
    const claims = {
      aud: audience,
      exp: Math.floor(Date.now() / 1000) + 12 * 3600,
      sub: VAPID_SUBJECT
    };
    
    const b64url = buf => buf.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
    const enc = obj => b64url(Buffer.from(JSON.stringify(obj)));
    const signingInput = `${enc(header)}.${enc(claims)}`;
    
    // Sign with ECDSA
    const privateKeyDer = b64urlDecode(VAPID_PRIVATE_KEY);
    const sign = crypto.createSign('SHA256');
    sign.update(signingInput);
    // Use the raw private key
    const keyObj = crypto.createPrivateKey({
      key: Buffer.concat([
        Buffer.from('308187020100301306072a8648ce3d020106082a8648ce3d030107046d306b02010104', 'hex'),
        privateKeyDer,
        Buffer.from('a144034200', 'hex'),
        b64urlDecode(VAPID_PUBLIC_KEY)
      ]),
      format: 'der',
      type: 'pkcs8'
    });
    
    const sig = crypto.sign('SHA256', Buffer.from(signingInput), { key: keyObj, dsaEncoding: 'ieee-p1363' });
    const jwt = `${signingInput}.${b64url(sig)}`;
    
    // Encrypt payload using Web Push encryption
    const payloadStr = JSON.stringify(payload);
    
    // For simplicity use fetch to send to push service
    const https = require('https');
    const url = new URL(subscription.endpoint);
    
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Authorization': `vapid t=${jwt},k=${VAPID_PUBLIC_KEY}`,
        'Content-Type': 'application/octet-stream',
        'TTL': '86400'
      }
    };
    
    return new Promise((resolve) => {
      const req = https.request(options, (res) => {
        resolve(res.statusCode < 300);
      });
      req.on('error', () => resolve(false));
      req.end();
    });
  } catch(e) {
    console.log('Push error:', e.message);
    return false;
  }
}

async function notifyPartner(shopId, payload) {
  try {
    const subs = await db(
      `SELECT ps.endpoint, ps.p256dh, ps.auth FROM push_subscriptions ps
       JOIN wash_partners p ON p.id = ps.partner_id
       WHERE p.shop_id = $1`,
      [shopId]
    );
    for (const sub of subs) {
      await sendPushNotification(sub, payload);
    }
  } catch(e) { console.log('notifyPartner error:', e.message); }
}

async function notifyUser(userId, payload) {
  try {
    const subs = await db(
      `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`,
      [userId]
    );
    for (const sub of subs) {
      await sendPushNotification(sub, payload);
    }
  } catch(e) { console.log('notifyUser error:', e.message); }
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

  // Service Worker
  if (p === "/sw.js") {
    const sw = `
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(self.registration.showNotification(data.title || 'ClearQ', {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: '/icon-192.png',
    data: data
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow('/'));
});
`;
    res.writeHead(200, { 'Content-Type': 'application/javascript', ...CORS_HEADERS });
    return res.end(sw);
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
  const pages = { "/": "clearq.html", "/partner": "clearq-partner.html", "/manager": "clearq-manager.html", "/owner": "clearq-owner.html" };
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

    // GET /wash/shops/ghost/:slug — looks up a hidden test shop by its secret slug, bypassing
    // is_active entirely. Never listed anywhere; only reachable if you have the exact link.
    if (m === "GET" && /^\/wash\/shops\/ghost\/[^/]+$/.test(p)) {
      const slug = decodeURIComponent(p.split("/")[4]);
      const s = await db1(`SELECT * FROM wash_shops WHERE secret_slug=$1`, [slug]);
      if (!s) return respond(res, 404, { error: "Not found" });
      return respond(res, 200, shop(s));
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

    // GET /wash/shops/:id/addons — public, active add-on items only (Custom Wash builder + extras)
    if (m === "GET" && /^\/wash\/shops\/\d+\/addons/.test(p)) {
      const id = +p.split("/")[3];
      const addons = await db(`SELECT * FROM wash_addons WHERE shop_id=$1 AND is_active=1 ORDER BY display_order`, [id]);
      return respond(res, 200, addons.map(addon));
    }

    // GET /wash/queue/:shopId
    if (m === "GET" && /^\/wash\/queue\/\d+$/.test(p)) {
      const shopId = +p.split("/")[3];
      return respond(res, 200, await simulateBayQueue(shopId));
    }

    // GET /wash/reservations/:id
    if (m === "GET" && /^\/wash\/reservations\/\d+$/.test(p)) {
      const id = +p.split("/")[3];
      const b = await db1(`SELECT * FROM wash_bookings WHERE id=$1`, [id]);
      if (!b) return respond(res, 404, { error: "Not found" });
      return respond(res, 200, booking(b));
    }

    // GET /wash/reservations/preview — read-only version of the same simulation POST
    // /wash/reservations uses to price a real booking. The customer app calls this while the
    // booking modal is open (service selection, drive time arriving, switching Now/Schedule) so
    // whatever's previewed is guaranteed to match what actually gets booked — previously the
    // frontend approximated this client-side with Math.max(driveTime, genericQueueWait), which
    // doesn't check whether *this specific* arrival time actually collides with other bookings
    // arriving around the same moment, and could show an earlier time than confirming would give.
    if (m === "GET" && p === "/wash/reservations/preview") {
      const shopId = +url.searchParams.get("shopId");
      const driveMins = Math.max(0, parseFloat(url.searchParams.get("driveMins")) || 0);
      const washType = url.searchParams.get("washType");
      if (!shopId || !washType) return respond(res, 400, { error: "shopId and washType required" });
      const { price: basePrice, durationMins: baseDurationMins } = await resolveService(shopId, washType);
      const addonIdsParam = url.searchParams.get("addonIds");
      const addons = await resolveAddons(shopId, addonIdsParam ? addonIdsParam.split(",") : []);
      const addonsPrice = addons.reduce((sum, a) => sum + a.price, 0);
      const addonsDurationMins = addons.reduce((sum, a) => sum + a.durationMins, 0);
      const durationMins = baseDurationMins + addonsDurationMins;
      const now = new Date();
      const requestedArrival = new Date(now.getTime() + driveMins * 60000);
      const sim = await simulateBayQueue(shopId, { hypotheticalArrival: requestedArrival, hypotheticalDurationMins: durationMins });
      const waitMins = Math.max(0, Math.round((sim.hypotheticalStart - now.getTime()) / 60000));
      const etaArrival = new Date(now.getTime() + waitMins * 60000);
      const etaReady = new Date(etaArrival.getTime() + durationMins * 60000);
      return respond(res, 200, {
        etaArrivalAt: etaArrival.toISOString(),
        etaReadyAt: etaReady.toISOString(),
        waitMins,
        durationMins,
        totalPrice: basePrice + addonsPrice,
      });
    }

    // POST /wash/reservations
    if (m === "POST" && p === "/wash/reservations") {
      const body = await readBody(req);
      const { shopId, customerName, customerPhone, washType, scheduledDate, scheduledTime, licensePlate, carModel, carId, etaMinutesOverride, etaSource, customerLat, customerLng, addonIds } = body;
      if (!shopId || !customerName || !customerPhone || !washType) {
        return respond(res, 400, { error: "shopId, customerName, customerPhone, washType required" });
      }
      const s = await db1(`SELECT * FROM wash_shops WHERE id=$1`, [shopId]);
      if (!s) return respond(res, 404, { error: "Shop not found" });
      if (s.is_paused) return respond(res, 409, { error: "This wash centre isn't accepting online bookings right now. Please check back later." });

      // Identify the logged-in user (if any) from the auth token
      const authPayload = verifyJWT(getToken(req));
      const userId = authPayload?.userId || null;

      // Resolve car details — prefer carId lookup, fall back to manual fields
      let finalCarModel = carModel || null;
      let finalLicensePlate = licensePlate || null;
      if (carId) {
        const car = await db1(`SELECT * FROM user_cars WHERE id=$1`, [carId]);
        if (car) {
          finalCarModel = [car.make, car.model].filter(Boolean).join(' ') || car.model;
          finalLicensePlate = car.license_plate || finalLicensePlate;
        }
      }

      const { price: basePrice, durationMins: baseDurationMins } = await resolveService(shopId, washType);
      const addons = await resolveAddons(shopId, addonIds);
      const addonsPrice = addons.reduce((sum, a) => sum + a.price, 0);
      const addonsDurationMins = addons.reduce((sum, a) => sum + a.durationMins, 0);
      const price = basePrice + addonsPrice;
      const durationMins = baseDurationMins + addonsDurationMins;
      const now = new Date();

      // Price this booking against every existing reservation (scheduled or not), not just
      // bays physically busy right now — see simulateBayQueue for why that distinction matters.
      const driveMins = etaMinutesOverride || 0;
      const requestedArrival = new Date(now.getTime() + driveMins * 60000);
      const sim = await simulateBayQueue(shopId, { hypotheticalArrival: requestedArrival, hypotheticalDurationMins: durationMins });
      const startMins = Math.max(0, Math.round((sim.hypotheticalStart - now.getTime()) / 60000));
      const etaArrival = new Date(now.getTime() + startMins * 60000);
      const etaReady = new Date(etaArrival.getTime() + durationMins * 60000);

      const [created] = await db(
        `INSERT INTO wash_bookings (shop_id,customer_name,customer_phone,wash_type,scheduled_date,scheduled_time,price,status,payment_status,kind,license_plate,car_model,eta_arrival_at,eta_ready_at,eta_source,customer_lat,customer_lng,user_id,car_id,addons,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'pending','paid','reservation',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW()) RETURNING *`,
        [shopId, customerName, customerPhone, washType,
          scheduledDate || today(), scheduledTime || nowTime(),
          price, finalLicensePlate, finalCarModel,
          etaArrival, etaReady, etaSource || (etaMinutesOverride ? "google" : "fallback"),
          customerLat || null, customerLng || null,
          userId, carId || null, JSON.stringify(addons)]
      );
      // Notify partner of new booking
      try { await notifyPartner(shopId, { title: 'New Booking!', body: `${customerName} booked a ${washType} wash`, icon: '/icon-192.png' }); } catch(e) {}
      sendBookingEmail(created, s.name, 'confirmed');
      notifyShopByEmail(shopId, s.name, s.notification_email, created);
      return respond(res, 201, booking(created));
    }

    // GET /wash/eta — uses Google Routes API with live traffic, falls back to OSRM then estimate
    if (m === "GET" && p === "/wash/eta") {
      const shopId = +url.searchParams.get("shopId");
      const fromLat = parseFloat(url.searchParams.get("fromLat"));
      const fromLng = parseFloat(url.searchParams.get("fromLng"));
      const s = await db1(`SELECT lat, lng, slot_duration_mins FROM wash_shops WHERE id=$1`, [shopId]);
      if (!s?.lat || !s?.lng || isNaN(fromLat) || isNaN(fromLng)) {
        return respond(res, 200, { etaMinutes: 15, source: "fallback" });
      }

      // Haversine distance for fallback / reference
      const R = 6371;
      const dLat = (s.lat - fromLat) * Math.PI / 180;
      const dLon = (s.lng - fromLng) * Math.PI / 180;
      const a = Math.sin(dLat/2)**2 + Math.cos(fromLat*Math.PI/180) * Math.cos(s.lat*Math.PI/180) * Math.sin(dLon/2)**2;
      const straightDist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

      // 1) Try Google Routes API (real-time traffic-aware driving time)
      if (GOOGLE_MAPS_API_KEY) {
        try {
          const https = require('https');
          const body = JSON.stringify({
            origin: { location: { latLng: { latitude: fromLat, longitude: fromLng } } },
            destination: { location: { latLng: { latitude: s.lat, longitude: s.lng } } },
            travelMode: "DRIVE",
            routingPreference: "TRAFFIC_AWARE",
          });
          const googleRes = await new Promise((resolve, reject) => {
            const req = https.request({
              hostname: 'routes.googleapis.com',
              path: '/directions/v2:computeRoutes',
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
                'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters',
                'Content-Length': Buffer.byteLength(body),
              },
              timeout: 5000,
            }, (r) => {
              let data = '';
              r.on('data', chunk => data += chunk);
              r.on('end', () => resolve(data));
            });
            req.on('error', reject);
            req.on('timeout', () => reject(new Error('timeout')));
            req.write(body);
            req.end();
          });
          const googleData = JSON.parse(googleRes);
          if (googleData.routes?.[0]) {
            const route = googleData.routes[0];
            const durationSecs = parseInt(route.duration.replace('s', ''));
            const durationMins = Math.max(3, Math.round(durationSecs / 60));
            const distKm = Math.round(route.distanceMeters / 100) / 10;
            return respond(res, 200, { etaMinutes: durationMins, source: "google", distanceKm: distKm });
          } else {
            console.log("Google Routes API response:", JSON.stringify(googleData).slice(0, 300));
          }
        } catch (e) {
          console.log("Google Routes API failed, trying OSRM:", e.message);
        }
      }

      // 2) Try OSRM (free, no traffic data)
      try {
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${s.lng},${s.lat}?overview=false`;
        const osrmRes = await new Promise((resolve, reject) => {
          const https = require('https');
          https.get(osrmUrl, { timeout: 4000 }, (r) => {
            let data = '';
            r.on('data', chunk => data += chunk);
            r.on('end', () => resolve(data));
          }).on('error', reject).on('timeout', () => reject(new Error('timeout')));
        });
        const osrmData = JSON.parse(osrmRes);
        if (osrmData.code === 'Ok' && osrmData.routes?.[0]) {
          const route = osrmData.routes[0];
          const durationMins = Math.max(3, Math.round(route.duration / 60));
          const distKm = Math.round(route.distance / 100) / 10;
          return respond(res, 200, { etaMinutes: durationMins, source: "osrm", distanceKm: distKm });
        }
      } catch (e) {
        console.log("OSRM routing failed, using estimate:", e.message);
      }

      // 3) Fallback to straight-line estimate
      const etaMinutes = Math.max(3, Math.round(straightDist * 3.5));
      return respond(res, 200, { etaMinutes, source: "estimate", distanceKm: Math.round(straightDist*10)/10 });
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
        `SELECT * FROM wash_bookings WHERE shop_id=$1 AND scheduled_date=$2 AND kind NOT IN ('scheduled','maintenance') ORDER BY created_at DESC`,
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
      const nextUpByBay = await predictNextUpByBay(shopId);
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
        const nextUp = (state === "free") ? nextUpByBay.get(i) : null;
        bays.push({ bayNumber: i, state, booking: b && b.kind !== "maintenance" ? booking(b) : null, reason: b?.kind === "maintenance" ? b.notes : null, nextUp: nextUp ? booking(nextUp) : null });
      }
      return respond(res, 200, { shopId, maxBays: s.max_workers, bays });
    }

    // GET /partners/shop/:id/customers — customer list for this shop only. Same email/cars
    // enrichment as GET /owner/customers, just scoped to bookings at this one shop.
    if (m === "GET" && /\/partners\/shop\/\d+\/customers$/.test(p)) {
      const search = url.searchParams.get('search') || '';
      let q = `
        SELECT
          customer_phone as phone,
          MAX(customer_name) as name,
          MAX(license_plate) as license_plate,
          MAX(car_model) as car_model,
          MAX(car_color) as car_color,
          MAX(user_id) as user_id,
          COUNT(id) as total_visits,
          COUNT(id) FILTER (WHERE status='completed') as completed_visits,
          COALESCE(SUM(price) FILTER (WHERE status='completed'), 0) as total_spent,
          MIN(created_at) as first_visit,
          MAX(created_at) as last_visit,
          COUNT(id) FILTER (WHERE kind='reservation') as online_bookings,
          COUNT(id) FILTER (WHERE kind='walkin') as walkin_bookings
        FROM wash_bookings
        WHERE shop_id = $1 AND customer_phone IS NOT NULL AND customer_phone != ''
      `;
      const params = [shopId];
      if (search) {
        q += ` AND (customer_name ILIKE $2 OR customer_phone ILIKE $2 OR license_plate ILIKE $2)`;
        params.push(`%${search}%`);
      }
      q += ` GROUP BY customer_phone ORDER BY total_visits DESC LIMIT 200`;
      const rows = await db(q, params);

      const userIds = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
      let usersById = {}, carsByUserId = {};
      if (userIds.length) {
        const users = await db(`SELECT id, email, created_at FROM wash_users WHERE id = ANY($1)`, [userIds]);
        usersById = Object.fromEntries(users.map(u => [u.id, u]));
        const cars = await db(`SELECT * FROM user_cars WHERE user_id = ANY($1) ORDER BY is_default DESC, created_at ASC`, [userIds]);
        for (const c of cars) {
          (carsByUserId[c.user_id] = carsByUserId[c.user_id] || []).push({
            id: c.id, make: c.make, model: c.model, color: c.color,
            licensePlate: c.license_plate, carType: c.car_type, isDefault: c.is_default === 1,
          });
        }
      }
      const result = rows.map(r => ({
        ...r,
        email: usersById[r.user_id]?.email || null,
        account_created_at: usersById[r.user_id]?.created_at || null,
        cars: carsByUserId[r.user_id] || [],
      }));
      return respond(res, 200, result);
    }

    // GET /partners/shop/:id/customers/:phone/history — one customer's history at this shop
    if (m === "GET" && /\/partners\/shop\/\d+\/customers\/[^\/]+\/history$/.test(p)) {
      const parts = p.split("/");
      const phone = decodeURIComponent(parts[parts.length - 2]);
      const rows = await db(
        `SELECT * FROM wash_bookings WHERE shop_id = $1 AND customer_phone = $2 ORDER BY created_at DESC LIMIT 100`,
        [shopId, phone]
      );
      return respond(res, 200, rows.map(booking));
    }

    // GET /partners/shop/:id/dashboard
    if (m === "GET" && /\/partners\/shop\/\d+\/dashboard$/.test(p)) {
      const date = url.searchParams.get("date") || today();
      const s = await db1(`SELECT * FROM wash_shops WHERE id=$1`, [shopId]);
      const bookings = (await db(`SELECT * FROM wash_bookings WHERE shop_id=$1 AND scheduled_date=$2 ORDER BY scheduled_time`, [shopId, date]))
        .filter(b => b.kind !== 'maintenance');
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

    // GET /partners/shop/:id/addons
    if (m === "GET" && /\/partners\/shop\/\d+\/addons$/.test(p)) {
      const addons = await db(`SELECT * FROM wash_addons WHERE shop_id=$1 ORDER BY display_order`, [shopId]);
      return respond(res, 200, addons.map(addon));
    }

    // POST /partners/shop/:id/addons
    if (m === "POST" && /\/partners\/shop\/\d+\/addons$/.test(p)) {
      const { name, description, price, durationMins, displayOrder } = await readBody(req);
      if (!name || price == null) return respond(res, 400, { error: "name and price required" });
      const [a] = await db(
        `INSERT INTO wash_addons (shop_id,name,description,price,duration_mins,display_order,is_active,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,1,NOW(),NOW()) RETURNING *`,
        [shopId, name.trim(), description?.trim()||null, price, durationMins||0, displayOrder||0]
      );
      return respond(res, 201, addon(a));
    }

    // PUT /partners/shop/:id/addons/:addonId
    if (m === "PUT" && /\/partners\/shop\/\d+\/addons\/\d+$/.test(p)) {
      const addonId = +p.split("/").pop();
      const body = await readBody(req);
      const ex = await db1(`SELECT * FROM wash_addons WHERE id=$1 AND shop_id=$2`, [addonId, shopId]);
      if (!ex) return respond(res, 404, { error: "Add-on not found" });
      const [updated] = await db(
        `UPDATE wash_addons SET name=COALESCE($1,name), description=COALESCE($2,description), price=COALESCE($3,price), duration_mins=COALESCE($4,duration_mins), display_order=COALESCE($5,display_order), is_active=COALESCE($6,is_active), updated_at=NOW() WHERE id=$7 RETURNING *`,
        [body.name?.trim()||null, body.description?.trim()||null, body.price!=null?body.price:null, body.durationMins!=null?body.durationMins:null, body.displayOrder!=null?body.displayOrder:null, body.isActive!=null?(body.isActive?1:0):null, addonId]
      );
      return respond(res, 200, addon(updated));
    }

    // DELETE /partners/shop/:id/addons/:addonId
    if (m === "DELETE" && /\/partners\/shop\/\d+\/addons\/\d+$/.test(p)) {
      const addonId = +p.split("/").pop();
      await db(`DELETE FROM wash_addons WHERE id=$1 AND shop_id=$2`, [addonId, shopId]);
      return respond(res, 200, { success: true });
    }

    // GET /partners/shop/:id/settings
    if (m === "GET" && /\/partners\/shop\/\d+\/settings$/.test(p)) {
      const s = await db1(`SELECT * FROM wash_shops WHERE id=$1`, [shopId]);
      if (!s) return respond(res, 404, { error: "Not found" });
      return respond(res, 200, { priceExterior:s.price_exterior, priceInterior:s.price_interior, priceFull:s.price_full, minsExterior:s.mins_exterior, minsInterior:s.mins_interior, minsFull:s.mins_full, maxWorkers:s.max_workers, slotDurationMins:s.slot_duration_mins, openTime:s.open_time, closeTime:s.close_time, locationDescription:s.location_description, phone:s.phone, isPaused: !!s.is_paused, notificationEmail: s.notification_email });
    }

    // PATCH /partners/shop/:id/settings
    if (m === "PATCH" && /\/partners\/shop\/\d+\/settings$/.test(p)) {
      const body = await readBody(req);
      const numericMap = { priceExterior:"price_exterior", priceInterior:"price_interior", priceFull:"price_full", minsExterior:"mins_exterior", minsInterior:"mins_interior", minsFull:"mins_full", slotDurationMins:"slot_duration_mins" };
      const textMap = { openTime:"open_time", closeTime:"close_time", locationDescription:"location_description", phone:"phone", notificationEmail:"notification_email" };
      const boolMap = { isPaused: "is_paused" };
      const sets = []; const vals = []; let i = 1;
      for (const [k,col] of Object.entries(numericMap)) {
        if (body[k]!=null) { sets.push(`${col}=$${i++}`); vals.push(+body[k]); }
      }
      for (const [k,col] of Object.entries(textMap)) {
        if (body[k]!=null) { sets.push(`${col}=$${i++}`); vals.push(String(body[k])); }
      }
      for (const [k,col] of Object.entries(boolMap)) {
        if (body[k]!=null) { sets.push(`${col}=$${i++}`); vals.push(body[k] ? 1 : 0); }
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

      const { durationMins } = await resolveService(shopId, b.wash_type);
      const now = new Date();
      const eta = new Date(now.getTime() + durationMins * 60000);

      // The Bay tab shows each pending booking as "next up" in a specific bay (see
      // predictNextUpByBay above). Starting it from there should honor that exact bay, not
      // silently land it in whichever bay happens to be lowest-numbered — otherwise the bay
      // shown on screen and the bay it actually starts in can disagree. requestedBay is only
      // ever a hint the caller already displayed; if it's no longer free, this fails cleanly
      // rather than substituting a different bay (auto-pick still applies with no requestedBay,
      // e.g. from the Queue tab, which has no specific-bay context to honor).
      const { bayNumber: requestedBay } = await readBody(req);
      const requestedBayInt = requestedBay != null ? +requestedBay : null;

      // Bay number is computed inside this same UPDATE (not read separately beforehand) and
      // the WHERE guard re-checks bay availability at write time too — see withBayRetry() above
      // for why this is still safe under concurrent Start requests.
      const updated = await withBayRetry(() => db1(
        `UPDATE wash_bookings SET status='in_progress',
           bay_number=COALESCE($5::int, (
             SELECT bn FROM generate_series(1, $1::int) AS bn
             WHERE bn NOT IN (
               SELECT bay_number FROM wash_bookings WHERE shop_id=$2 AND status='in_progress' AND bay_number IS NOT NULL
             )
             ORDER BY bn LIMIT 1
           )),
           arrived_at=NOW(), wash_started_at=NOW(), eta_ready_at=$3, updated_at=NOW()
         WHERE id=$4
           AND (SELECT COUNT(*) FROM wash_bookings WHERE shop_id=$2 AND status='in_progress' AND bay_number IS NOT NULL) < $1
           AND ($5::int IS NULL OR NOT EXISTS (
             SELECT 1 FROM wash_bookings WHERE shop_id=$2 AND status='in_progress' AND bay_number=$5::int
           ))
         RETURNING *`,
        [s.max_workers, shopId, eta, bookingId, requestedBayInt]
      ));
      if (!updated) {
        return respond(res, 409, {
          error: requestedBayInt != null
            ? `Bay ${requestedBayInt} isn't free anymore — refresh and try again.`
            : `All ${s.max_workers} bays are occupied. Wait for a bay to free up.`
        });
      }
      // Notify user their wash has started
      try {
        if (b.clerk_user_id || b.customer_phone) {
          const userRow = await db1(`SELECT id FROM wash_users WHERE phone=$1`, [b.customer_phone]);
          if (userRow) await notifyUser(userRow.id, { title: 'Your wash has started! 🚗', body: `Your car is being washed at ${(await db1('SELECT name FROM wash_shops WHERE id=$1',[shopId]))?.name}`, icon: '/icon-192.png' });
        }
      } catch(e) {}
      sendBookingEmail(updated, s.name, 'started');
      return respond(res, 200, booking(updated));
    }

    // PATCH /partners/shop/:id/reservations/:bookingId/done — FIXED
    if (m === "PATCH" && /\/partners\/shop\/\d+\/reservations\/\d+\/done$/.test(p)) {
      const parts = p.split("/");
      const bookingId = +parts[parts.length-2];
      const b = await db1(`SELECT * FROM wash_bookings WHERE id=$1 AND shop_id=$2`, [bookingId, shopId]);
      if (!b) return respond(res, 404, { error: "Booking not found" });
      if (b.status !== "in_progress") return respond(res, 409, { error: `Booking is ${b.status}, not in progress — can't mark it done.` });

      // No real wash finishes in seconds — this catches an accidental instant Start-then-Done
      // (e.g. a second tap landing on the Done button that appears in the same spot right after
      // a card re-renders from Start) that a client-side disabled-button guard alone can't fully
      // prevent, since it only protects against clicks that overlap the in-flight request itself.
      if (b.status === "in_progress" && b.wash_started_at) {
        const secondsSinceStart = (Date.now() - new Date(b.wash_started_at).getTime()) / 1000;
        if (secondsSinceStart < 60) {
          return respond(res, 409, { error: `This wash only started ${Math.max(1, Math.round(secondsSinceStart))}s ago — too soon to be finished. Wait a moment and try again if that's really what you meant.` });
        }
      }

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

      // Bay is freed here — staff pick who starts next from the queue themselves (see Start button),
      // rather than the system auto-assigning by booking order, since only staff can see who's
      // actually arrived.

      // Notify user their car is ready
      try {
        const userRow = await db1(`SELECT id FROM wash_users WHERE phone=$1`, [b.customer_phone]);
        if (userRow) await notifyUser(userRow.id, { title: 'Your car is ready! ✅', body: `Your wash at ${(await db1('SELECT name FROM wash_shops WHERE id=$1',[shopId]))?.name} is complete. Come pick it up!`, icon: '/icon-192.png' });
      } catch(e) {}
      sendBookingEmail(updated, s.name, 'done');

      return respond(res, 200, booking(updated));
    }

    // PATCH /partners/shop/:id/reservations/:bookingId/cancel
    if (m === "PATCH" && /\/partners\/shop\/\d+\/reservations\/\d+\/cancel$/.test(p)) {
      const parts = p.split("/");
      const bookingId = +parts[parts.length-2];
      const b = await db1(`SELECT * FROM wash_bookings WHERE id=$1 AND shop_id=$2`, [bookingId, shopId]);
      if (!b) return respond(res, 404, { error: "Booking not found" });
      const [updated] = await db(
        `UPDATE wash_bookings SET status='cancelled', updated_at=NOW() WHERE id=$1 RETURNING *`,
        [bookingId]
      );
      return respond(res, 200, booking(updated));
    }

    // GET /partners/shop/:id/stale-bookings — pending/in_progress bookings overdue by 4+ hours,
    // regardless of date, so the partner can resolve ones forgotten from a previous day
    if (m === "GET" && /\/partners\/shop\/\d+\/stale-bookings$/.test(p)) {
      const rows = await db(
        `SELECT * FROM wash_bookings WHERE shop_id=$1 AND status IN ('pending','in_progress')
         AND eta_ready_at IS NOT NULL AND eta_ready_at <= NOW() - INTERVAL '4 hours'
         ORDER BY created_at ASC`,
        [shopId]
      );
      return respond(res, 200, rows.map(booking));
    }

    // POST /partners/shop/:id/walkin — links to user account by phone if registered
    if (m === "POST" && /\/partners\/shop\/\d+\/walkin$/.test(p)) {
      const { washType, customerName, customerPhone, licensePlate, carMake, carModel, carColor } = await readBody(req);
      if (!washType) return respond(res, 400, { error: "washType required" });
      const s = await db1(`SELECT * FROM wash_shops WHERE id=$1`, [shopId]);
      if (!s) return respond(res, 404, { error: "Shop not found" });

      // Try to link this walk-in to a registered user account by phone number
      let linkedUserId = null;
      let linkedCarId = null;
      let finalCarModel = [carMake, carModel].filter(Boolean).join(' ') || carModel || null;
      let finalCarColor = carColor || null;
      let finalName = customerName || "Walk-in";
      let finalPlate = licensePlate || null;

      if (customerPhone) {
        const matchedUser = await db1(`SELECT * FROM wash_users WHERE phone=$1`, [customerPhone.trim()]);
        if (matchedUser) {
          linkedUserId = matchedUser.id;
          finalName = customerName || matchedUser.name;
          // Try to match an existing car by plate, else by model, else use their default car
          let matchedCar = null;
          if (licensePlate) {
            matchedCar = await db1(`SELECT * FROM user_cars WHERE user_id=$1 AND license_plate=$2`, [matchedUser.id, licensePlate.trim()]);
          }
          if (!matchedCar && carModel) {
            matchedCar = await db1(`SELECT * FROM user_cars WHERE user_id=$1 AND model ILIKE $2`, [matchedUser.id, `%${carModel.trim()}%`]);
          }
          if (!matchedCar) {
            matchedCar = await db1(`SELECT * FROM user_cars WHERE user_id=$1 AND is_default=1`, [matchedUser.id]);
          }
          if (matchedCar) {
            linkedCarId = matchedCar.id;
            finalCarModel = [matchedCar.make, matchedCar.model].filter(Boolean).join(' ') || matchedCar.model;
            finalCarColor = matchedCar.color || finalCarColor;
            finalPlate = matchedCar.license_plate || finalPlate;
          } else if (finalCarModel || finalPlate) {
            // New car for this registered user — save it to their account automatically
            const existingCount = await db1(`SELECT COUNT(*) as cnt FROM user_cars WHERE user_id=$1`, [matchedUser.id]);
            const [newCar] = await db(
              `INSERT INTO user_cars (user_id, make, model, color, license_plate, is_default, created_at)
               VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *`,
              [matchedUser.id, carMake || null, carModel || finalCarModel || 'Car', carColor || null, finalPlate, parseInt(existingCount.cnt) === 0 ? 1 : 0]
            );
            linkedCarId = newCar.id;
          }
        }
      }

      const { price, durationMins } = await resolveService(shopId, washType);
      const now = new Date();

      const conflict = await findWalkinConflict(shopId, durationMins);
      if (conflict) {
        return respond(res, 409, {
          error: `Can't add this walk-in — ${conflict.customer_name || 'a customer'}'s ${conflict.wash_type || 'booking'} is arriving before this ${durationMins}-min wash would finish, and there's no other bay for them.`,
          conflictingBookingId: conflict.id,
        });
      }

      // Bay number (if any is free) is computed inside this same INSERT rather than read
      // separately beforehand — see withBayRetry() above for why that matters under concurrent
      // walk-in/Start requests. Falls back to a pending walk-in (no bay yet) when none is free.
      const eta = new Date(now.getTime() + durationMins * 60000);
      const created = await withBayRetry(() => db1(
        `INSERT INTO wash_bookings (shop_id,customer_name,customer_phone,wash_type,scheduled_date,scheduled_time,price,status,payment_status,kind,bay_number,arrived_at,wash_started_at,eta_ready_at,license_plate,car_model,car_color,user_id,car_id,created_at,updated_at)
         SELECT $1,$2,$3,$4,$5,$6,$7,
           CASE WHEN bay.bn IS NOT NULL THEN 'in_progress' ELSE 'pending' END,
           'paid','walkin', bay.bn,
           CASE WHEN bay.bn IS NOT NULL THEN NOW() END,
           CASE WHEN bay.bn IS NOT NULL THEN NOW() END,
           CASE WHEN bay.bn IS NOT NULL THEN $8::timestamptz END,
           $9,$10,$11,$12,$13,NOW(),NOW()
         FROM (
           SELECT (
             SELECT bn FROM generate_series(1, $14::int) AS bn
             WHERE bn NOT IN (SELECT bay_number FROM wash_bookings WHERE shop_id=$1 AND status='in_progress' AND bay_number IS NOT NULL)
             ORDER BY bn LIMIT 1
           ) AS bn
         ) bay
         RETURNING *`,
        [shopId, finalName, customerPhone||"", washType, today(), nowTime(), price, eta, finalPlate, finalCarModel, finalCarColor, linkedUserId, linkedCarId, s.max_workers]
      ));
      return respond(res, 201, { ...booking(created), linkedToAccount: !!linkedUserId });
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
      const { bookingId, shopId: sId, stars, comment, customerName, photoUrl, userId } = await readBody(req);
      if (!sId || !stars) return respond(res, 400, { error: "shopId and stars required" });
      const [r] = await db(
        `INSERT INTO wash_ratings (booking_id,shop_id,customer_name,stars,comment,photo_url,user_id,created_at) 
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *`,
        [bookingId||null, sId, customerName||"", stars, comment||null, photoUrl||null, userId||null]
      );
      return respond(res, 201, r);
    }

    // GET /wash/ratings/:shopId — get ratings for a shop
    if (m === "GET" && /^\/wash\/ratings\/\d+$/.test(p)) {
      const sId = +p.split("/")[3];
      const ratings = await db(
        `SELECT r.*, u.name as user_name FROM wash_ratings r
         LEFT JOIN wash_users u ON u.id = r.user_id
         WHERE r.shop_id=$1 ORDER BY r.created_at DESC LIMIT 20`,
        [sId]
      );
      return respond(res, 200, ratings);
    }

    // POST /wash/upload-photo — upload base64 photo and store inline
    if (m === "POST" && p === "/wash/upload-photo") {
      const { photo, bookingId } = await readBody(req);
      if (!photo) return respond(res, 400, { error: "photo required" });
      // Store as data URL directly (base64) — simple approach, no cloud storage needed
      // Limit to 500KB
      if (photo.length > 700000) return respond(res, 400, { error: "Photo too large, max 500KB" });
      return respond(res, 200, { url: photo });
    }

    // ─── OWNER: SHOP & PARTNER MANAGEMENT ──────────────────────────────
    function checkOwnerKey(req) {
      return req.headers['x-owner-key'] === OWNER_KEY;
    }

    // GET /owner/shops — full shop list with partner info
    if (m === "GET" && p === "/owner/shops") {
      if (!checkOwnerKey(req)) return respond(res, 401, { error: "Unauthorized" });
      const shopsList = await db(`SELECT * FROM wash_shops ORDER BY id`);
      const partnersList = await db(`SELECT id, shop_id, username, is_active FROM wash_partners ORDER BY shop_id`);
      const result = shopsList.map(s => ({
        ...shop(s),
        partner: partnersList.find(pp => pp.shop_id === s.id) || null
      }));
      return respond(res, 200, result);
    }

    // POST /owner/shops — create a new wash centre
    if (m === "POST" && p === "/owner/shops") {
      if (!checkOwnerKey(req)) return respond(res, 401, { error: "Unauthorized" });
      const { name, address, city, phone, lat, lng, openTime, closeTime, maxWorkers,
              priceExterior, priceInterior, priceFull, minsExterior, minsInterior, minsFull,
              username, password, isActive, isTest, secretSlug } = await readBody(req);
      if (!name || !username || !password) return respond(res, 400, { error: "name, username, password required" });
      const existing = await db1(`SELECT id FROM wash_partners WHERE username=$1`, [username.toLowerCase().trim()]);
      if (existing) return respond(res, 409, { error: "Username already taken" });
      const [newShop] = await db(
        `INSERT INTO wash_shops (name,address,city,phone,lat,lng,open_time,close_time,max_workers,
          price_exterior,price_interior,price_full,mins_exterior,mins_interior,mins_full,is_active,is_test,secret_slug,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),NOW()) RETURNING *`,
        [name.trim(), address||'', city||'Sheikh Zayed', phone||'', lat||null, lng||null,
         openTime||'09:00', closeTime||'22:00', maxWorkers||3,
         priceExterior||150, priceInterior||150, priceFull||250,
         minsExterior||20, minsInterior||25, minsFull||45,
         isActive === undefined ? 1 : (isActive ? 1 : 0), isTest ? 1 : 0, secretSlug || null]
      );
      const hash = await bcryptHash(password);
      await db(
        `INSERT INTO wash_partners (shop_id,username,password_hash,is_active,created_at) VALUES ($1,$2,$3,1,NOW())`,
        [newShop.id, username.toLowerCase().trim(), hash]
      );
      // Seed default services
      const svcRows = [
        { n: 'exterior', d: 'Exterior hand wash', p: priceExterior||150, t: minsExterior||20 },
        { n: 'interior', d: 'Interior vacuum and detail', p: priceInterior||150, t: minsInterior||25 },
        { n: 'full', d: 'Complete exterior and interior wash', p: priceFull||250, t: minsFull||45 },
      ];
      for (let i = 0; i < svcRows.length; i++) {
        const sv = svcRows[i];
        await db(
          `INSERT INTO wash_services (shop_id,name,description,price,duration_mins,display_order,is_active,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,1,NOW(),NOW())`,
          [newShop.id, sv.n, sv.d, sv.p, sv.t, i]
        );
      }
      return respond(res, 201, shop(newShop));
    }

    // PATCH /owner/shops/:id — update shop details (name, address, location, hours, prices)
    if (m === "PATCH" && /^\/owner\/shops\/\d+$/.test(p)) {
      if (!checkOwnerKey(req)) return respond(res, 401, { error: "Unauthorized" });
      const shopId = +p.split("/")[3];
      const body = await readBody(req);
      const fieldMap = {
        name: 'name', address: 'address', city: 'city', phone: 'phone',
        lat: 'lat', lng: 'lng', openTime: 'open_time', closeTime: 'close_time',
        maxWorkers: 'max_workers', isActive: 'is_active',
        priceExterior: 'price_exterior', priceInterior: 'price_interior', priceFull: 'price_full',
        minsExterior: 'mins_exterior', minsInterior: 'mins_interior', minsFull: 'mins_full',
        isTest: 'is_test', secretSlug: 'secret_slug',
      };
      const sets = []; const vals = []; let i = 1;
      for (const [key, col] of Object.entries(fieldMap)) {
        if (body[key] !== undefined) { sets.push(`${col}=$${i++}`); vals.push(body[key]); }
      }
      if (!sets.length) return respond(res, 400, { error: "No valid fields" });
      vals.push(shopId);
      const [updated] = await db(`UPDATE wash_shops SET ${sets.join(",")},updated_at=NOW() WHERE id=$${i} RETURNING *`, vals);
      if (!updated) return respond(res, 404, { error: "Shop not found" });
      return respond(res, 200, shop(updated));
    }

    // DELETE /owner/shops/:id — deactivate a shop
    if (m === "DELETE" && /^\/owner\/shops\/\d+$/.test(p)) {
      if (!checkOwnerKey(req)) return respond(res, 401, { error: "Unauthorized" });
      const shopId = +p.split("/")[3];
      await db(`UPDATE wash_shops SET is_active=0, updated_at=NOW() WHERE id=$1`, [shopId]);
      return respond(res, 200, { success: true });
    }

    // PATCH /owner/partners/:id — update partner username/password
    if (m === "PATCH" && /^\/owner\/partners\/\d+$/.test(p)) {
      if (!checkOwnerKey(req)) return respond(res, 401, { error: "Unauthorized" });
      const partnerId = +p.split("/")[3];
      const { username, password, isActive } = await readBody(req);
      const sets = []; const vals = []; let i = 1;
      if (username) {
        const existing = await db1(`SELECT id FROM wash_partners WHERE username=$1 AND id != $2`, [username.toLowerCase().trim(), partnerId]);
        if (existing) return respond(res, 409, { error: "Username already taken" });
        sets.push(`username=$${i++}`); vals.push(username.toLowerCase().trim());
      }
      if (password) {
        const hash = await bcryptHash(password);
        sets.push(`password_hash=$${i++}`); vals.push(hash);
      }
      if (isActive !== undefined) {
        sets.push(`is_active=$${i++}`); vals.push(isActive ? 1 : 0);
      }
      if (!sets.length) return respond(res, 400, { error: "No valid fields" });
      vals.push(partnerId);
      const [updated] = await db(`UPDATE wash_partners SET ${sets.join(",")} WHERE id=$${i} RETURNING id,shop_id,username,is_active`, vals);
      if (!updated) return respond(res, 404, { error: "Partner not found" });
      return respond(res, 200, updated);
    }

    // POST /owner/partners — create a new partner login for a shop (if missing one)
    if (m === "POST" && p === "/owner/partners") {
      if (!checkOwnerKey(req)) return respond(res, 401, { error: "Unauthorized" });
      const { shopId, username, password } = await readBody(req);
      if (!shopId || !username || !password) return respond(res, 400, { error: "shopId, username, password required" });
      const existing = await db1(`SELECT id FROM wash_partners WHERE username=$1`, [username.toLowerCase().trim()]);
      if (existing) return respond(res, 409, { error: "Username already taken" });
      const hash = await bcryptHash(password);
      const [created] = await db(
        `INSERT INTO wash_partners (shop_id,username,password_hash,is_active,created_at) VALUES ($1,$2,$3,1,NOW()) RETURNING id,shop_id,username,is_active`,
        [shopId, username.toLowerCase().trim(), hash]
      );
      return respond(res, 201, created);
    }

    // GET /owner/customers — aggregated customer profiles across all shops. Grouped by phone
    // (not account) so walk-ins who never signed up still show up here — then enriched with
    // email and their full saved car list for whoever *does* have a registered account, since
    // a booking only ever remembers the one car used for that specific visit.
    if (m === "GET" && p === "/owner/customers") {
      const ownerKey = req.headers['x-owner-key'];
      if (ownerKey !== OWNER_KEY) return respond(res, 401, { error: "Unauthorized" });
      const search = url.searchParams.get('search') || '';
      let q = `
        SELECT
          b.customer_phone as phone,
          MAX(b.customer_name) as name,
          MAX(b.license_plate) as license_plate,
          MAX(b.car_model) as car_model,
          MAX(b.car_color) as car_color,
          MAX(b.user_id) as user_id,
          COUNT(b.id) as total_visits,
          COUNT(b.id) FILTER (WHERE b.status='completed') as completed_visits,
          COALESCE(SUM(b.price) FILTER (WHERE b.status='completed'), 0) as total_spent,
          MIN(b.created_at) as first_visit,
          MAX(b.created_at) as last_visit,
          ARRAY_AGG(DISTINCT s.name) as shops_visited,
          COUNT(b.id) FILTER (WHERE b.kind='reservation') as online_bookings,
          COUNT(b.id) FILTER (WHERE b.kind='walkin') as walkin_bookings
        FROM wash_bookings b
        JOIN wash_shops s ON s.id = b.shop_id
        WHERE b.customer_phone IS NOT NULL AND b.customer_phone != '' AND s.is_test = 0
      `;
      const params = [];
      if (search) {
        q += ` AND (b.customer_name ILIKE $1 OR b.customer_phone ILIKE $1 OR b.license_plate ILIKE $1)`;
        params.push(`%${search}%`);
      }
      q += ` GROUP BY b.customer_phone ORDER BY total_visits DESC LIMIT 200`;
      const rows = await db(q, params);

      const userIds = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
      let usersById = {}, carsByUserId = {};
      if (userIds.length) {
        const users = await db(`SELECT id, email, created_at FROM wash_users WHERE id = ANY($1)`, [userIds]);
        usersById = Object.fromEntries(users.map(u => [u.id, u]));
        const cars = await db(`SELECT * FROM user_cars WHERE user_id = ANY($1) ORDER BY is_default DESC, created_at ASC`, [userIds]);
        for (const c of cars) {
          (carsByUserId[c.user_id] = carsByUserId[c.user_id] || []).push({
            id: c.id, make: c.make, model: c.model, color: c.color,
            licensePlate: c.license_plate, carType: c.car_type, isDefault: c.is_default === 1,
          });
        }
      }
      const result = rows.map(r => ({
        ...r,
        email: usersById[r.user_id]?.email || null,
        account_created_at: usersById[r.user_id]?.created_at || null,
        cars: carsByUserId[r.user_id] || [],
      }));
      return respond(res, 200, result);
    }

    // GET /owner/customers/:phone/history — full booking history for one customer
    if (m === "GET" && /^\/owner\/customers\/[^\/]+\/history$/.test(p)) {
      const ownerKey = req.headers['x-owner-key'];
      if (ownerKey !== OWNER_KEY) return respond(res, 401, { error: "Unauthorized" });
      const phone = decodeURIComponent(p.split("/")[3]);
      const rows = await db(
        `SELECT b.*, s.name as shop_name FROM wash_bookings b
         JOIN wash_shops s ON s.id = b.shop_id
         WHERE b.customer_phone = $1 AND s.is_test = 0 ORDER BY b.created_at DESC LIMIT 100`,
        [phone]
      );
      return respond(res, 200, rows.map(b => ({
        id: b.id, shopName: b.shop_name, washType: b.wash_type,
        scheduledDate: b.scheduled_date, price: b.price, status: b.status,
        kind: b.kind, createdAt: b.created_at, licensePlate: b.license_plate,
        carModel: b.car_model,
      })));
    }

    // GET /owner/bookings — all bookings across all shops (owner only)
    if (m === "GET" && p === "/owner/bookings") {
      const ownerKey = req.headers['x-owner-key'];
      if (ownerKey !== OWNER_KEY) return respond(res, 401, { error: "Unauthorized" });
      const limit = url.searchParams.get('limit') || 200;
      const shopId = url.searchParams.get('shopId');
      const status = url.searchParams.get('status');
      const dateFrom = url.searchParams.get('from');
      const dateTo = url.searchParams.get('to');
      let q = `SELECT b.*, s.name as shop_name, u.email as user_email, u.name as account_name,
                      uc.make as car_make, uc.model as car_make_model, uc.color as car_color, uc.car_type as car_body_type
               FROM wash_bookings b
               JOIN wash_shops s ON s.id = b.shop_id
               LEFT JOIN wash_users u ON u.id = b.user_id
               LEFT JOIN user_cars uc ON uc.id = b.car_id
               WHERE 1=1`;
      const params = [];
      let i = 1;
      // Ghost/test shops only show up here if explicitly filtered to by shopId — otherwise
      // they'd clutter the real "All Bookings" list with test data.
      if (shopId) { q += ` AND b.shop_id=$${i++}`; params.push(shopId); }
      else { q += ` AND s.is_test = 0`; }
      if (status) { q += ` AND b.status=$${i++}`; params.push(status); }
      if (dateFrom) { q += ` AND b.scheduled_date >= $${i++}`; params.push(dateFrom); }
      if (dateTo) { q += ` AND b.scheduled_date <= $${i++}`; params.push(dateTo); }
      q += ` ORDER BY b.created_at DESC LIMIT $${i}`;
      params.push(limit);
      const rows = await db(q, params);
      return respond(res, 200, rows.map(b => ({
        id: b.id, shopId: b.shop_id, shopName: b.shop_name,
        customerName: b.customer_name, customerPhone: b.customer_phone,
        customerEmail: b.user_email || null, accountName: b.account_name || null,
        washType: b.wash_type, scheduledDate: b.scheduled_date,
        scheduledTime: b.scheduled_time, price: b.price,
        status: b.status, kind: b.kind, bayNumber: b.bay_number,
        licensePlate: b.license_plate, carModel: b.car_model,
        carMake: b.car_make || null, carColor: b.car_color || null, carType: b.car_body_type || null,
        createdAt: b.created_at, updatedAt: b.updated_at,
        etaArrivalAt: b.eta_arrival_at, etaReadyAt: b.eta_ready_at,
        washStartedAt: b.wash_started_at, washFinishedAt: b.wash_finished_at,
      })));
    }

    // GET /owner/stats — summary stats for owner dashboard
    if (m === "GET" && p === "/owner/stats") {
      const ownerKey = req.headers['x-owner-key'];
      if (ownerKey !== OWNER_KEY) return respond(res, 401, { error: "Unauthorized" });
      const todayStr = today();
      const stats = await db(`
        SELECT 
          s.id, s.name, s.max_workers,
          COUNT(b.id) FILTER (WHERE b.scheduled_date = $1) as today_total,
          COUNT(b.id) FILTER (WHERE b.scheduled_date = $1 AND b.status = 'completed') as today_completed,
          COUNT(b.id) FILTER (WHERE b.scheduled_date = $1 AND b.kind = 'reservation') as today_online,
          COUNT(b.id) FILTER (WHERE b.scheduled_date = $1 AND b.kind = 'walkin') as today_walkin,
          COUNT(b.id) FILTER (WHERE b.status = 'pending') as pending,
          COUNT(b.id) FILTER (WHERE b.status = 'in_progress') as in_progress,
          COALESCE(SUM(b.price) FILTER (WHERE b.scheduled_date = $1 AND b.status = 'completed'), 0) as today_revenue,
          COALESCE(SUM(b.price) FILTER (WHERE b.scheduled_date = $1 AND b.status = 'completed' AND b.kind = 'reservation'), 0) as today_online_revenue,
          COALESCE(SUM(b.price) FILTER (WHERE b.scheduled_date = $1 AND b.status = 'completed' AND b.kind = 'walkin'), 0) as today_walkin_revenue,
          COALESCE(AVG(r.stars), 0) as avg_rating,
          COUNT(r.id) as rating_count
        FROM wash_shops s
        LEFT JOIN wash_bookings b ON b.shop_id = s.id AND b.kind IN ('reservation','walkin')
        LEFT JOIN wash_ratings r ON r.shop_id = s.id
        WHERE s.is_active = 1
        GROUP BY s.id, s.name, s.max_workers
        ORDER BY s.id
      `, [todayStr]);
      return respond(res, 200, stats);
    }

    // GET /push/vapid-public-key
    if (m === "GET" && p === "/push/vapid-public-key") {
      return respond(res, 200, { publicKey: VAPID_PUBLIC_KEY });
    }

    // POST /push/subscribe
    if (m === "POST" && p === "/push/subscribe") {
      const { subscription, userId, partnerId } = await readBody(req);
      if (!subscription?.endpoint) return respond(res, 400, { error: "Invalid subscription" });
      try {
        await db(
          `INSERT INTO push_subscriptions (user_id, partner_id, endpoint, p256dh, auth)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (endpoint) DO UPDATE SET user_id=$1, partner_id=$2, p256dh=$4, auth=$5`,
          [userId||null, partnerId||null, subscription.endpoint, subscription.keys?.p256dh||'', subscription.keys?.auth||'']
        );
        return respond(res, 200, { success: true });
      } catch(e) {
        return respond(res, 500, { error: e.message });
      }
    }

    // POST /users/register
    if (m === "POST" && p === "/users/register") {
      const { name, email, phone, password, carMake, carModel, carColor, licensePlate } = await readBody(req);
      if (!name || !email || !password) return respond(res, 400, { error: "name, email, password required" });
      const existing = await db1(`SELECT id FROM wash_users WHERE email=$1`, [email.toLowerCase()]);
      if (existing) return respond(res, 409, { error: "Email already registered" });
      const hash = await bcryptHash(password);
      const combinedCarLabel = [carMake, carModel].filter(v => v && v.trim()).join(' ') || null;
      const [user] = await db(
        `INSERT INTO wash_users (name,email,phone,password_hash,car_model,license_plate,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW()) RETURNING id,name,email,phone,car_model,license_plate`,
        [name.trim(), email.toLowerCase().trim(), phone||"", hash, combinedCarLabel, licensePlate||null]
      );
      // The signup form already asks for a car — save it straight into their car list as the
      // default, instead of making them re-enter the same details on the Account tab afterward.
      if (carModel && carModel.trim()) {
        await db(
          `INSERT INTO user_cars (user_id, make, model, color, license_plate, is_default, created_at)
           VALUES ($1,$2,$3,$4,$5,1,NOW())`,
          [user.id, carMake && carMake.trim() ? carMake.trim() : null, carModel.trim(), carColor && carColor.trim() ? carColor.trim() : null, licensePlate || null]
        );
      }
      const token = signJWT({ userId: user.id, email: user.email });
      return respond(res, 201, { token, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, carModel: user.car_model, licensePlate: user.license_plate } });
    }

    // POST /users/login
    if (m === "POST" && p === "/users/login") {
      const { email, password } = await readBody(req);
      if (!email || !password) return respond(res, 400, { error: "email and password required" });
      const user = await db1(`SELECT * FROM wash_users WHERE email=$1`, [email.toLowerCase().trim()]);
      if (!user) return respond(res, 401, { error: "Incorrect email or password" });
      const valid = await bcryptCompare(password, user.password_hash);
      if (!valid) return respond(res, 401, { error: "Incorrect email or password" });
      const token = signJWT({ userId: user.id, email: user.email });
      return respond(res, 200, { token, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, carModel: user.car_model, licensePlate: user.license_plate } });
    }

    // POST /users/forgot-password — always responds success, doesn't reveal whether the email exists
    if (m === "POST" && p === "/users/forgot-password") {
      const { email } = await readBody(req);
      if (!email) return respond(res, 400, { error: "email required" });
      const user = await db1(`SELECT id, name FROM wash_users WHERE email=$1`, [email.toLowerCase().trim()]);
      if (user) {
        const code = String(crypto.randomInt(100000, 1000000));
        const codeHash = await bcryptHash(code);
        const expires = new Date(Date.now() + 15 * 60000);
        await db(`UPDATE wash_users SET reset_code_hash=$1, reset_code_expires=$2, updated_at=NOW() WHERE id=$3`, [codeHash, expires, user.id]);
        await sendEmail(email.toLowerCase().trim(), "Your ClearQ password reset code",
          `<div style="font-family:sans-serif;max-width:420px;margin:0 auto;">
            <h2 style="color:#21867B;">ClearQ</h2>
            <p>Hi ${user.name || ''},</p>
            <p>Use this code to reset your password. It expires in 15 minutes.</p>
            <div style="font-size:28px;font-weight:800;letter-spacing:6px;background:#E6F7F5;color:#21867B;padding:14px 20px;border-radius:8px;text-align:center;margin:16px 0;">${code}</div>
            <p style="color:#64748b;font-size:12px;">If you didn't request this, you can safely ignore this email.</p>
          </div>`);
      }
      return respond(res, 200, { success: true });
    }

    // POST /users/reset-password
    if (m === "POST" && p === "/users/reset-password") {
      const { email, code, newPassword } = await readBody(req);
      if (!email || !code || !newPassword) return respond(res, 400, { error: "email, code and newPassword required" });
      if (newPassword.length < 6) return respond(res, 400, { error: "Password must be at least 6 characters" });
      const user = await db1(`SELECT * FROM wash_users WHERE email=$1`, [email.toLowerCase().trim()]);
      if (!user || !user.reset_code_hash || !user.reset_code_expires) return respond(res, 400, { error: "Invalid or expired code" });
      if (new Date(user.reset_code_expires) < new Date()) return respond(res, 400, { error: "Code has expired — request a new one" });
      const valid = await bcryptCompare(code, user.reset_code_hash);
      if (!valid) return respond(res, 400, { error: "Invalid or expired code" });
      const hash = await bcryptHash(newPassword);
      await db(`UPDATE wash_users SET password_hash=$1, reset_code_hash=NULL, reset_code_expires=NULL, updated_at=NOW() WHERE id=$2`, [hash, user.id]);
      const token = signJWT({ userId: user.id, email: user.email });
      return respond(res, 200, { token, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, carModel: user.car_model, licensePlate: user.license_plate } });
    }

    // GET /users/me
    if (m === "GET" && p === "/users/me") {
      const payload = verifyJWT(getToken(req));
      if (!payload?.userId) return respond(res, 401, { error: "Unauthorized" });
      const user = await db1(`SELECT id,name,email,phone,car_model,license_plate FROM wash_users WHERE id=$1`, [payload.userId]);
      if (!user) return respond(res, 404, { error: "User not found" });
      return respond(res, 200, { id: user.id, name: user.name, email: user.email, phone: user.phone, carModel: user.car_model, licensePlate: user.license_plate });
    }

    // PUT /users/me
    if (m === "PUT" && p === "/users/me") {
      const payload = verifyJWT(getToken(req));
      if (!payload?.userId) return respond(res, 401, { error: "Unauthorized" });
      const { name, phone, carModel, licensePlate } = await readBody(req);
      const [updated] = await db(
        `UPDATE wash_users SET name=COALESCE($1,name), phone=COALESCE($2,phone), car_model=COALESCE($3,car_model), license_plate=COALESCE($4,license_plate), updated_at=NOW() WHERE id=$5 RETURNING id,name,email,phone,car_model,license_plate`,
        [name||null, phone||null, carModel||null, licensePlate||null, payload.userId]
      );
      return respond(res, 200, { id: updated.id, name: updated.name, email: updated.email, phone: updated.phone, carModel: updated.car_model, licensePlate: updated.license_plate });
    }

    // GET /users/me/cars — list all cars for logged-in user
    if (m === "GET" && p === "/users/me/cars") {
      const payload = verifyJWT(getToken(req));
      if (!payload?.userId) return respond(res, 401, { error: "Unauthorized" });
      const cars = await db(`SELECT * FROM user_cars WHERE user_id=$1 ORDER BY is_default DESC, created_at ASC`, [payload.userId]);
      return respond(res, 200, cars.map(c => ({
        id: c.id, make: c.make, model: c.model, color: c.color,
        licensePlate: c.license_plate, carType: c.car_type, isDefault: c.is_default === 1
      })));
    }

    // POST /users/me/cars — add a new car
    if (m === "POST" && p === "/users/me/cars") {
      const payload = verifyJWT(getToken(req));
      if (!payload?.userId) return respond(res, 401, { error: "Unauthorized" });
      const { make, model, color, licensePlate, carType, isDefault } = await readBody(req);
      if (!model) return respond(res, 400, { error: "Car model is required" });
      if (isDefault) {
        await db(`UPDATE user_cars SET is_default=0 WHERE user_id=$1`, [payload.userId]);
      }
      // If this is their first car, make it default automatically
      const existingCount = await db1(`SELECT COUNT(*) as cnt FROM user_cars WHERE user_id=$1`, [payload.userId]);
      const shouldBeDefault = isDefault || parseInt(existingCount.cnt) === 0;
      const [created] = await db(
        `INSERT INTO user_cars (user_id, make, model, color, license_plate, car_type, is_default, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *`,
        [payload.userId, make||null, model.trim(), color||null, licensePlate||null, carType||null, shouldBeDefault ? 1 : 0]
      );
      return respond(res, 201, {
        id: created.id, make: created.make, model: created.model, color: created.color,
        licensePlate: created.license_plate, carType: created.car_type, isDefault: created.is_default === 1
      });
    }

    // PUT /users/me/cars/:id — edit a car
    if (m === "PUT" && /^\/users\/me\/cars\/\d+$/.test(p)) {
      const payload = verifyJWT(getToken(req));
      if (!payload?.userId) return respond(res, 401, { error: "Unauthorized" });
      const carId = +p.split("/").pop();
      const car = await db1(`SELECT * FROM user_cars WHERE id=$1 AND user_id=$2`, [carId, payload.userId]);
      if (!car) return respond(res, 404, { error: "Car not found" });
      const { make, model, color, licensePlate, carType, isDefault } = await readBody(req);
      if (isDefault) {
        await db(`UPDATE user_cars SET is_default=0 WHERE user_id=$1`, [payload.userId]);
      }
      const [updated] = await db(
        `UPDATE user_cars SET make=COALESCE($1,make), model=COALESCE($2,model), color=COALESCE($3,color),
         license_plate=COALESCE($4,license_plate), car_type=COALESCE($5,car_type), is_default=COALESCE($6,is_default)
         WHERE id=$7 RETURNING *`,
        [make||null, model||null, color||null, licensePlate||null, carType||null, isDefault ? 1 : null, carId]
      );
      return respond(res, 200, {
        id: updated.id, make: updated.make, model: updated.model, color: updated.color,
        licensePlate: updated.license_plate, carType: updated.car_type, isDefault: updated.is_default === 1
      });
    }

    // DELETE /users/me/cars/:id — remove a car
    if (m === "DELETE" && /^\/users\/me\/cars\/\d+$/.test(p)) {
      const payload = verifyJWT(getToken(req));
      if (!payload?.userId) return respond(res, 401, { error: "Unauthorized" });
      const carId = +p.split("/").pop();
      await db(`DELETE FROM user_cars WHERE id=$1 AND user_id=$2`, [carId, payload.userId]);
      return respond(res, 200, { success: true });
    }

    // GET /users/me/bookings — all bookings linked to this account (reservations + linked walk-ins)
    if (m === "GET" && p === "/users/me/bookings") {
      const payload = verifyJWT(getToken(req));
      if (!payload?.userId) return respond(res, 401, { error: "Unauthorized" });
      const rows = await db(
        `SELECT b.*, s.name as shop_name,
                EXISTS(SELECT 1 FROM wash_ratings r WHERE r.booking_id = b.id) as has_rating
         FROM wash_bookings b
         JOIN wash_shops s ON s.id = b.shop_id
         WHERE b.user_id = $1 ORDER BY b.created_at DESC LIMIT 100`,
        [payload.userId]
      );
      return respond(res, 200, rows.map(b => ({ ...booking(b), shopName: b.shop_name, hasRating: b.has_rating })));
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
