"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const scrypt = promisify(crypto.scrypt);

const ROOT = __dirname,
  DB_FILE = process.env.DATA_FILE
    ? path.resolve(ROOT, process.env.DATA_FILE)
    : path.join(ROOT, "data", "db.json"),
  DATA_DIR = path.dirname(DB_FILE);
const PORT = Number(process.env.PORT || 4173),
  PRODUCTION = process.env.NODE_ENV === "production";
const ORIGIN = process.env.APP_ORIGIN || `http://localhost:${PORT}`;
const SESSION_MS = Number(process.env.SESSION_DAYS || 7) * 86400000;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};
const rateBuckets = new Map();
let writeQueue = Promise.resolve();

function initialDb() {
  return {
    users: [],
    sessions: [],
    adminSessions: [],
    orders: [],
    feedback: [],
    subscribers: [],
    recoveryCodes: [],
    passwordChanges: [],
    emailVerificationCodes: [],
    customDishes: [],
    telegramDrafts: { invoice: {}, dish: {} },
  };
}
function ensureDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE))
    fs.writeFileSync(DB_FILE, JSON.stringify(initialDb(), null, 2));
}
function normalizeDb(db) {
  const defaults = initialDb();
  for (const [key, value] of Object.entries(defaults)) {
    if (Array.isArray(value)) {
      if (!Array.isArray(db[key])) db[key] = [];
    } else if (
      !db[key] ||
      typeof db[key] !== "object" ||
      Array.isArray(db[key])
    )
      db[key] = value;
  }
  return db;
}
let neonSql;
async function postgres() {
  if (!process.env.DATABASE_URL) return null;
  if (!neonSql) {
    const { neon } = await import("@neondatabase/serverless");
    neonSql = neon(process.env.DATABASE_URL);
    await neonSql`CREATE TABLE IF NOT EXISTS efood_state (id integer PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`;
  }
  return neonSql;
}
async function readDb() {
  const sql = await postgres();
  if (sql) {
    const rows = await sql`SELECT data FROM efood_state WHERE id=1`;
    if (rows[0]?.data) return normalizeDb(rows[0].data);
    let seed = initialDb();
    if (fs.existsSync(DB_FILE)) {
      try {
        seed = normalizeDb(JSON.parse(fs.readFileSync(DB_FILE, "utf8")));
      } catch {
        seed = initialDb();
      }
    }
    await sql`INSERT INTO efood_state (id,data) VALUES (1,${JSON.stringify(seed)}::jsonb) ON CONFLICT (id) DO NOTHING`;
    return seed;
  }
  ensureDb();
  try {
    return normalizeDb(JSON.parse(fs.readFileSync(DB_FILE, "utf8")));
  } catch {
    return initialDb();
  }
}
function writeDb(db) {
  writeQueue = writeQueue.then(async () => {
    const sql = await postgres();
    if (sql) {
      await sql`INSERT INTO efood_state (id,data,updated_at) VALUES (1,${JSON.stringify(db)}::jsonb,now()) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data,updated_at=now()`;
      return;
    }
    const temp = `${DB_FILE}.${process.pid}.tmp`;
    await fs.promises.writeFile(temp, JSON.stringify(db, null, 2));
    await fs.promises.rename(temp, DB_FILE);
  });
  return writeQueue;
}
function id() {
  return crypto.randomUUID();
}
function clean(value) {
  return String(value ?? "").trim();
}
function email(value) {
  return clean(value).toLowerCase();
}
function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function validPhone(value) {
  return /^\+?[\d\s()-]{7,20}$/.test(value);
}
function validPassword(value) {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    /[A-Za-z]/.test(value) &&
    /\d/.test(value)
  );
}
async function passwordHash(
  password,
  salt = crypto.randomBytes(16).toString("hex"),
) {
  const derived = await scrypt(password, salt, 64);
  return `${salt}:${derived.toString("hex")}`;
}
async function passwordMatches(password, stored = "") {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const candidate = Buffer.from(await scrypt(password, salt, 64));
  const expected = Buffer.from(key, "hex");
  return (
    candidate.length === expected.length &&
    crypto.timingSafeEqual(candidate, expected)
  );
}
function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    address: user.address,
    emailVerified: Boolean(user.emailVerified),
    createdAt: user.createdAt,
  };
}
function cookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf("=");
        return [
          decodeURIComponent(item.slice(0, index).trim()),
          decodeURIComponent(item.slice(index + 1)),
        ];
      }),
  );
}
function sessionUser(req, db) {
  const token = cookies(req).efood_session;
  if (!token) return null;
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const session = db.sessions.find(
    (item) => item.tokenHash === hash && item.expiresAt > Date.now(),
  );
  return session
    ? db.users.find((user) => user.id === session.userId) || null
    : null;
}
function sessionCookie(token) {
  const expires = new Date(Date.now() + SESSION_MS).toUTCString();
  return `efood_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(SESSION_MS / 1000)}; Expires=${expires}; Priority=High${PRODUCTION ? "; Secure" : ""}`;
}
function setSession(res, db, user) {
  const token = crypto.randomBytes(32).toString("base64url");
  db.sessions = db.sessions.filter(
    (item) => item.userId !== user.id && item.expiresAt > Date.now(),
  );
  db.sessions.push({
    id: id(),
    userId: user.id,
    tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
    expiresAt: Date.now() + SESSION_MS,
  });
  res.setHeader("Set-Cookie", sessionCookie(token));
}
function refreshSession(req, res, db) {
  const token = cookies(req).efood_session;
  if (!token) return false;
  const hash = crypto.createHash("sha256").update(token).digest("hex"),
    session = db.sessions.find(
      (item) => item.tokenHash === hash && item.expiresAt > Date.now(),
    );
  if (!session) return false;
  session.expiresAt = Date.now() + SESSION_MS;
  res.setHeader("Set-Cookie", sessionCookie(token));
  return true;
}
function clearSession(res) {
  res.setHeader(
    "Set-Cookie",
    `efood_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${PRODUCTION ? "; Secure" : ""}`,
  );
}
function defaultSiteContent() {
  return {
    general: {
      siteName: "EFood",
      pageTitle: "EFood — Fast Food Delivery",
      metaDescription: "Fast, friendly food delivery to your door.",
    },
    navigation: {
      homeLabel: "Home",
      homeHref: "#home",
      menuLabel: "Menu",
      menuHref: "#service",
      restaurantsLabel: "Restaurants",
      restaurantsHref: "#restaurants",
      contactLabel: "Contact",
      contactHref: "#support",
    },
    hero: {
      visible: true,
      eyebrow: "Fastest delivery in your city",
      title: "Super Fast <span>Food</span><br><span>Delivery</span> Service",
      description:
        "We provide super-fast delivery from the best local restaurants. Order now and enjoy discounts of up to 50%.",
      image: "assets/images/hero-courier.jpg",
      primaryButton: "Explore Food",
      secondaryButton: "Download App",
      trust: "12k+ happy customers",
    },
    menu: {
      visible: true,
      eyebrow: "Our menu",
      title: "Our Popular <span>Category</span>",
      description: "Choose from the dishes everyone is talking about.",
    },
    about: {
      visible: true,
      eyebrow: "Why choose us",
      title:
        "<span>Stay</span> At Home, We Will Provide <span>Good Food</span>",
      description:
        "Fresh food, clear order tracking and helpful support — from the restaurant kitchen all the way to your door.",
      image: "assets/images/contactless.jpg",
      features:
        "Fastest Delivery in 30 Minutes\n300+ Delivery Partners\n500+ Restaurants & Cafés",
      button: "See restaurants",
    },
    restaurants: {
      visible: true,
      eyebrow: "Local favorites",
      title: "Top Food <span>Restaurants</span>",
      description: "Explore the most-loved kitchens near you.",
    },
    app: {
      visible: true,
      eyebrow: "Food in your pocket",
      title: "Download Our <span>Mobile App</span>",
      description:
        "Discover restaurants, track orders live and save your favorites. Join the app waitlist and receive a 50% welcome discount.",
      image: "assets/images/app-phones.jpg",
    },
    testimonials: {
      visible: true,
      eyebrow: "Testimonials",
      title: "What Our Clients <span>Are Saying</span>",
    },
    support: {
      visible: true,
      eyebrow: "We are here to help",
      title: "Have a question about <span>your order?</span>",
      description:
        "Tell us what you would like to clarify. If you are signed in, your account contact details will be attached automatically.",
      phone: "+880 9438 33399",
    },
    footer: {
      address: "Dhaka, Bangladesh",
      phone: "+880 9438 33399",
      email: "support@efood.com",
      copyright: "© 2026 EFood. All rights reserved.",
    },
  };
}
function defaultNavigationItems() {
  return [
    { id: "nav-home", label: "Home", href: "#home" },
    { id: "nav-menu", label: "Menu", href: "#service" },
    { id: "nav-restaurants", label: "Restaurants", href: "#restaurants" },
    { id: "nav-contact", label: "Contact", href: "#support" },
  ];
}
function sanitizeNavigationItems(items) {
  return (Array.isArray(items) ? items : defaultNavigationItems())
    .slice(0, 12)
    .map((item, index) => ({
      id: clean(item.id) || `nav-${Date.now()}-${index}`,
      label: clean(item.label).slice(0, 50),
      href: clean(item.href).slice(0, 300),
    }))
    .filter((item) => item.label && item.href);
}
function sanitizeCustomSections(sections) {
  return (Array.isArray(sections) ? sections : [])
    .slice(0, 20)
    .map((section, index) => ({
      id: clean(section.id) || `section-${Date.now()}-${index}`,
      visible: section.visible !== false,
      eyebrow: clean(section.eyebrow).slice(0, 100),
      title: clean(section.title).slice(0, 500),
      description: clean(section.description).slice(0, 3000),
      image: clean(section.image).slice(0, 500),
      buttonLabel: clean(section.buttonLabel).slice(0, 100),
      buttonHref: clean(section.buttonHref).slice(0, 300),
    }))
    .filter((section) => section.title || section.description || section.image);
}
function getSiteContent(db) {
  const defaults = defaultSiteContent();
  if (
    !db.siteContent ||
    typeof db.siteContent !== "object" ||
    Array.isArray(db.siteContent)
  )
    db.siteContent = {};
  for (const [group, fields] of Object.entries(defaults))
    db.siteContent[group] = { ...fields, ...(db.siteContent[group] || {}) };
  if (!Array.isArray(db.siteContent.navigation.items))
    db.siteContent.navigation.items = defaultNavigationItems();
  db.siteContent.navigation.items = sanitizeNavigationItems(
    db.siteContent.navigation.items,
  );
  db.siteContent.customSections = sanitizeCustomSections(
    db.siteContent.customSections,
  );
  return db.siteContent;
}
function defaultMenuDishes() {
  const image = (id) =>
      `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=700&q=82`,
    groups = {
      Burger: [
        ["Cheeseburger with Salad", 18, "1568901346375-23c9450c58cd"],
        ["Classic Beef Burger", 15, "1550547660-d9450f859349"],
        ["Royal Cheeseburger", 16, "1550317138-10000687a72b"],
        ["Black Angus Burger", 14, "1571091718767-18b5b1457add"],
        ["Crispy Chicken Burger", 15, "1586816001966-79b736744398"],
      ],
      Pizza: [
        ["Margherita Pizza", 16, "1574071318508-1cdbab80d002"],
        ["Pepperoni Feast", 19, "1628840042765-356cda07504e"],
        ["Garden Supreme", 17, "1594007654729-407eedc4be65"],
        ["Cheese Volcano", 18, "1565299624946-b28f40a0ae38"],
        ["Chicken Deluxe", 20, "1579751626657-72bc17010498"],
      ],
      Sandwich: [
        ["Classic Club Sandwich", 12, "1553909489-cd47e0907980"],
        ["Double Stack Sandwich", 14, "1528735602780-2552fd46c7af"],
        ["Grilled Chicken Panini", 13, "1509722747041-616f39b57569"],
        ["Fresh Veggie Stack", 11, "1539252554453-80ab65ce3586"],
        ["Golden Tuna Melt", 15, "1481070414801-51fd732d7184"],
      ],
      Asian: [
        ["Spicy Miso Ramen", 17, "1569718212165-3a8278d5f624"],
        ["Teriyaki Bento", 19, "1547592180-85f173990554"],
        ["Salmon Sushi", 21, "1579871494447-9811cf80d66c"],
        ["Crispy Dumplings", 13, "1563245372-f21724e3856d"],
        ["Coconut Curry", 16, "1601050690597-df0568f70950"],
      ],
      "Set Menu": [
        ["Family Feast", 32, "1543353071-873f17a7a088"],
        ["Healthy Lunch Combo", 22, "1498837167922-ddd27525d352"],
        ["Protein Power Box", 24, "1543362906-acfc16c67564"],
        ["Kids Favorite", 17, "1490645935967-10de6ba17061"],
        ["Weekend Special", 29, "1547592180-85f173990554"],
      ],
    };
  return Object.entries(groups).flatMap(([category, items]) =>
    items.map(([name, price, photo], index) => ({
      id: `base-${category.toLowerCase().replace(/\s+/g, "-")}-${index + 1}`,
      name,
      category,
      price,
      rating: 4.8,
      image: image(photo),
      recipe: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      builtIn: true,
    })),
  );
}
function ensureMenu(db) {
  if (db.menuInitialized) return false;
  const existing = new Set(
    db.customDishes.map((item) => item.name.toLowerCase()),
  );
  db.customDishes = [
    ...defaultMenuDishes().filter(
      (item) => !existing.has(item.name.toLowerCase()),
    ),
    ...db.customDishes,
  ];
  db.menuInitialized = true;
  return true;
}
function adminSession(req, db) {
  const token = cookies(req).efood_admin;
  if (!token) return false;
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  return db.adminSessions.some(
    (item) => item.tokenHash === hash && item.expiresAt > Date.now(),
  );
}
function setAdminSession(res, db) {
  const token = crypto.randomBytes(32).toString("base64url");
  db.adminSessions = db.adminSessions.filter(
    (item) => item.expiresAt > Date.now(),
  );
  db.adminSessions.push({
    id: id(),
    tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
    expiresAt: Date.now() + 86400000,
  });
  res.setHeader(
    "Set-Cookie",
    `efood_admin=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=86400${PRODUCTION ? "; Secure" : ""}`,
  );
}
function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}
function error(res, status, message, fields) {
  json(res, status, { error: message, ...(fields ? { fields } : {}) });
}
function sanitizeSiteContent(input, current) {
  const defaults = defaultSiteContent(),
    output = {};
  for (const [group, fields] of Object.entries(defaults)) {
    output[group] = {};
    for (const [key, fallback] of Object.entries(fields)) {
      const value = input?.[group]?.[key];
      output[group][key] =
        typeof fallback === "boolean"
          ? Boolean(value)
          : clean(value ?? current?.[group]?.[key] ?? fallback).slice(
              0,
              key === "description" || key === "features" ? 2000 : 500,
            );
    }
  }
  output.navigation.items = sanitizeNavigationItems(
    input?.navigation?.items ?? current?.navigation?.items,
  );
  output.customSections = sanitizeCustomSections(
    input?.customSections ?? current?.customSections,
  );
  return output;
}
function sanitizeAdminDish(data, idValue = id()) {
  const name = clean(data.name).slice(0, 100),
    category = ["Burger", "Pizza", "Sandwich", "Asian", "Set Menu"].includes(
      data.category,
    )
      ? data.category
      : "Set Menu",
    price = Number(data.price),
    rating = Math.max(1, Math.min(5, Number(data.rating) || 5)),
    image = clean(data.image).slice(0, 500),
    recipe = Array.isArray(data.recipe)
      ? data.recipe
          .slice(0, 50)
          .map((item) => ({
            name: clean(item.name).slice(0, 150),
            amount: Number(item.amount),
            unit: ["г", "мл", "шт"].includes(item.unit) ? item.unit : "г",
          }))
          .filter(
            (item) =>
              item.name && Number.isFinite(item.amount) && item.amount > 0,
          )
      : [];
  if (name.length < 2 || !Number.isFinite(price) || price <= 0)
    throw Object.assign(new Error("Name and a positive price are required"), {
      status: 422,
    });
  return {
    id: idValue,
    name,
    category,
    price: Number(price.toFixed(2)),
    rating: Number(rating.toFixed(1)),
    image: image || dishImage(category),
    recipe,
    createdAt: data.createdAt || new Date().toISOString(),
  };
}
async function body(req, limit = 100000) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit)
      throw Object.assign(new Error("Payload too large"), { status: 413 });
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}
function rateLimit(req, res, key, limit = 10, windowMs = 60000) {
  const ip = req.socket.remoteAddress || "unknown",
    bucketKey = `${ip}:${key}`,
    now = Date.now(),
    items = (rateBuckets.get(bucketKey) || []).filter(
      (time) => time > now - windowMs,
    );
  if (items.length >= limit) {
    error(res, 429, "Too many attempts. Please try again later.");
    return false;
  }
  items.push(now);
  rateBuckets.set(bucketKey, items);
  return true;
}
function sameOrigin(req) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return true;
  const origin = req.headers.origin;
  return !origin || origin === ORIGIN || origin === `http://127.0.0.1:${PORT}`;
}
function validateProfile(data) {
  const fields = {},
    name = clean(data.name),
    mail = email(data.email),
    phone = clean(data.phone),
    address = clean(data.address);
  if (name.length < 2) fields.name = "Enter at least 2 characters.";
  if (!validEmail(mail)) fields.email = "Enter a valid email address.";
  if (!validPhone(phone)) fields.phone = "Enter a valid phone number.";
  if (address.length < 6) fields.address = "Enter a full delivery address.";
  return { fields, value: { name, email: mail, phone, address } };
}
async function sendRecovery(user, channel, code) {
  if (channel === "email" && process.env.RESEND_API_KEY) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "EFood <onboarding@resend.dev>",
        to: [user.email],
        subject: "Your EFood confirmation code",
        html: `<p>Your EFood confirmation code is <strong>${code}</strong>.</p><p>It expires in 10 minutes.</p>`,
      }),
    });
    if (!response.ok) throw new Error("Email provider rejected the message");
    return;
  }
  if (
    channel === "phone" &&
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_FROM_NUMBER
  ) {
    const form = new URLSearchParams({
      To: user.phone,
      From: process.env.TWILIO_FROM_NUMBER,
      Body: `Your EFood confirmation code is ${code}. It expires in 10 minutes.`,
    });
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form,
      },
    );
    if (!response.ok) throw new Error("SMS provider rejected the message");
    return;
  }
  if (PRODUCTION)
    throw new Error(
      `${channel === "email" ? "Email" : "SMS"} provider is not configured`,
    );
}
async function sendVerificationEmail(user, code) {
  if (process.env.RESEND_API_KEY) {
    const messageId = id(),
      response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `verify-${messageId}`,
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || "EFood <onboarding@resend.dev>",
          to: [user.email],
          subject: `EFood verification code: ${code}`,
          headers: { "X-Entity-Ref-ID": messageId },
          html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto"><h2>Verify your EFood email</h2><p>Enter this code to finish verifying your account:</p><p style="font-size:30px;font-weight:700;letter-spacing:6px;color:#fe7143">${code}</p><p>This code expires in 10 minutes. If you did not request it, you can ignore this email.</p></div>`,
        }),
      });
    if (!response.ok)
      throw new Error("Email provider rejected the verification message");
    return;
  }
  if (PRODUCTION) throw new Error("Email provider is not configured");
}
async function issueEmailVerification(db, user) {
  const code = String(crypto.randomInt(100000, 1000000));
  db.emailVerificationCodes = db.emailVerificationCodes.filter(
    (item) => item.userId !== user.id,
  );
  db.emailVerificationCodes.push({
    id: id(),
    userId: user.id,
    codeHash: crypto.createHash("sha256").update(code).digest("hex"),
    expiresAt: Date.now() + 600000,
    attempts: 0,
  });
  await sendVerificationEmail(user, code);
  return code;
}
function telegramEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
async function sendTelegramOrder(order, user) {
  const token = process.env.TELEGRAM_BOT_TOKEN,
    chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;
  const items = order.items
    .map(
      (item) =>
        `• ${telegramEscape(item.name)} — ${item.qty} × $${item.price.toFixed(2)} = $${(item.qty * item.price).toFixed(2)}`,
    )
    .join("\n");
  const text = `🛍 <b>New EFood order #${telegramEscape(order.number)}</b>\n\n👤 <b>Account</b>\n${telegramEscape(user.name)}\n${telegramEscape(user.email)}\n\n📦 <b>Recipient</b>\n${telegramEscape(order.recipient)}\n📞 ${telegramEscape(order.phone)}\n📍 ${telegramEscape(order.address)}\n\n🍽 <b>Items</b>\n${items}\n\n💳 <b>Total: $${order.total.toFixed(2)}</b>\n📌 Status: ${telegramEscape(order.status)}\n🕒 ${telegramEscape(new Date(order.createdAt).toLocaleString("en-US", { timeZone: "Asia/Yerevan" }))}`;
  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!response.ok) {
    const details = await response.text();
    throw new Error(
      `Telegram notification failed: ${response.status} ${details.slice(0, 200)}`,
    );
  }
  return true;
}
async function sendTelegramFeedback(feedback) {
  const token = process.env.TELEGRAM_BOT_TOKEN,
    chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;
  const text = `💬 <b>New customer question #${telegramEscape(feedback.number)}</b>\n\n📌 <b>Topic:</b> ${telegramEscape(feedback.topic)}\n👤 <b>Name:</b> ${telegramEscape(feedback.name)}\n📞 <b>Phone:</b> ${telegramEscape(feedback.phone)}\n✉ <b>Email:</b> ${telegramEscape(feedback.email)}\n\n❓ <b>Question</b>\n${telegramEscape(feedback.message)}\n\n🕒 ${telegramEscape(new Date(feedback.createdAt).toLocaleString("en-US", { timeZone: "Asia/Yerevan" }))}`;
  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!response.ok)
    throw new Error(
      `Telegram feedback notification failed: ${response.status}`,
    );
  return true;
}
async function sendOrderToGoogleSheets(order, user) {
  const url = process.env.GOOGLE_SHEETS_WEBHOOK_URL,
    secret = process.env.GOOGLE_SHEETS_WEBHOOK_SECRET;
  if (!url || !secret) return false;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, order, user: publicUser(user) }),
    redirect: "follow",
    signal: AbortSignal.timeout(12000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok)
    throw new Error(
      `Google Sheets notification failed: ${response.status} ${result.error || ""}`.trim(),
    );
  return true;
}
async function sendInvoiceToGoogleSheets(invoice) {
  const url = process.env.GOOGLE_SHEETS_WEBHOOK_URL,
    secret = process.env.GOOGLE_SHEETS_WEBHOOK_SECRET;
  if (!url || !secret) throw new Error("Google Sheets is not configured");
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, type: "invoice", invoice }),
    redirect: "follow",
    signal: AbortSignal.timeout(12000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok)
    throw new Error(
      `Google Sheets invoice failed: ${response.status} ${result.error || ""}`.trim(),
    );
  return result;
}
async function sendDishToGoogleSheets(dish) {
  const url = process.env.GOOGLE_SHEETS_WEBHOOK_URL,
    secret = process.env.GOOGLE_SHEETS_WEBHOOK_SECRET;
  if (!url || !secret) throw new Error("Google Sheets is not configured");
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, type: "dish", dish }),
    redirect: "follow",
    signal: AbortSignal.timeout(12000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok)
    throw new Error(
      `Google Sheets dish failed: ${response.status} ${result.error || ""}`.trim(),
    );
  return result;
}

const TELEGRAM_PROFIT_BUTTON = "💰 Прибыль за месяц";
const TELEGRAM_INVOICE_BUTTON = "📥 Добавить фактуру";
const TELEGRAM_DISH_BUTTON = "🍽 Добавить блюдо",
  TELEGRAM_ADD_DISH_INGREDIENT = "➕ Ингредиент",
  TELEGRAM_SHOW_RECIPE = "📋 Показать рецепт",
  TELEGRAM_PUBLISH_DISH = "🚀 Опубликовать блюдо";
const TELEGRAM_ADD_PRODUCT = "➕ Добавить продукт",
  TELEGRAM_FINISH_INVOICE = "✅ Завершить фактуру",
  TELEGRAM_SHOW_DRAFT = "📋 Показать черновик",
  TELEGRAM_REMOVE_LAST = "↩️ Удалить последний",
  TELEGRAM_CANCEL_INVOICE = "❌ Отмена";
const telegramInvoiceDrafts = new Map();
const telegramDishDrafts = new Map();
const KNOWN_INGREDIENTS = [
  "Авокадо",
  "Базилик",
  "Бекон",
  "Брокколи",
  "Булочка",
  "Бульон",
  "Васаби",
  "Ветчина",
  "Говядина",
  "Говядина Black Angus",
  "Говяжья котлета",
  "Горгонзола",
  "Горчица",
  "Горчичный соус",
  "Зеленый лук",
  "Индейка",
  "Капуста",
  "Карри-паста",
  "Картофель",
  "Кетчуп",
  "Киноа",
  "Кокосовое молоко",
  "Кунжут",
  "Куриное филе",
  "Лапша рамэн",
  "Лосось",
  "Лук",
  "Лук карамелизованный",
  "Майонез",
  "Мисо-паста",
  "Морковь",
  "Моцарелла",
  "Нори",
  "Нут",
  "Овощная смесь",
  "Огурцы",
  "Огурцы маринованные",
  "Оливки",
  "Оливковое масло",
  "Орегано",
  "Панировка",
  "Пармезан",
  "Пепперони",
  "Перец болгарский",
  "Помидоры",
  "Растительное масло",
  "Рис",
  "Рис для суши",
  "Салат айсберг",
  "Свинина",
  "Сливочный соус",
  "Соевый соус",
  "Сок",
  "Соус бургер",
  "Соус йогуртовый",
  "Соус песто",
  "Соус терияки",
  "Соус BBQ",
  "Сыр чеддер",
  "Тесто для пельменей",
  "Тесто для пиццы",
  "Томатный соус",
  "Тостовый хлеб",
  "Тунец",
  "Хлеб",
  "Хлеб чиабатта",
  "Хумус",
  "Цельнозерновой хлеб",
  "Шампиньоны",
  "Яблоко",
  "Яйцо",
];
async function telegramApi(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Telegram bot token is not configured");
  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(35000),
    },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok)
    throw new Error(
      `Telegram ${method} failed: ${response.status} ${result.description || ""}`.trim(),
    );
  return result.result;
}
async function currentMonthSales() {
  const now = new Date(),
    offsetMs = 4 * 60 * 60 * 1000,
    yerevanNow = new Date(now.getTime() + offsetMs),
    year = yerevanNow.getUTCFullYear(),
    month = yerevanNow.getUTCMonth(),
    start = Date.UTC(year, month, 1) - offsetMs,
    end = Date.UTC(year, month + 1, 1) - offsetMs,
    orders = (await readDb()).orders.filter((order) => {
      const created = Date.parse(order.createdAt);
      return (
        created >= start &&
        created < end &&
        order.status !== "cancelled" &&
        Number.isFinite(Number(order.total))
      );
    }),
    total = orders.reduce((sum, order) => sum + Number(order.total), 0),
    monthName = new Intl.DateTimeFormat("ru-RU", {
      month: "long",
      year: "numeric",
      timeZone: "Asia/Yerevan",
    }).format(now);
  return { orders: orders.length, total: Number(total.toFixed(2)), monthName };
}
function parseInvoice(text) {
  const errors = [],
    items = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        const parts = line.split("|").map((part) => part.trim());
        if (parts.length !== 4) {
          errors.push(`Строка ${index + 1}: нужно 4 поля через |`);
          return null;
        }
        const [name, priceRaw, quantityRaw, weight] = parts,
          price = Number(priceRaw.replace(",", ".")),
          quantity = Number(quantityRaw.replace(",", "."));
        if (
          !name ||
          !Number.isFinite(price) ||
          price < 0 ||
          !Number.isFinite(quantity) ||
          quantity <= 0 ||
          !weight
        ) {
          errors.push(
            `Строка ${index + 1}: проверьте название, цену, количество и вес`,
          );
          return null;
        }
        return {
          name: name.slice(0, 150),
          price: Number(price.toFixed(2)),
          quantity: Number(quantity.toFixed(3)),
          weight: weight.slice(0, 50),
          total: Number((price * quantity).toFixed(2)),
        };
      })
      .filter(Boolean);
  return { items, errors };
}
async function sendTelegramMenu(chatId, text = "👋 EFood Bot") {
  return telegramApi("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: {
      keyboard: [
        [{ text: TELEGRAM_PROFIT_BUTTON }],
        [{ text: TELEGRAM_INVOICE_BUTTON }, { text: TELEGRAM_DISH_BUTTON }],
      ],
      resize_keyboard: true,
      is_persistent: true,
    },
  });
}
function invoiceKeyboard() {
  return {
    keyboard: [
      [{ text: TELEGRAM_ADD_PRODUCT }],
      [{ text: TELEGRAM_SHOW_DRAFT }, { text: TELEGRAM_REMOVE_LAST }],
      [{ text: TELEGRAM_FINISH_INVOICE }],
      [{ text: TELEGRAM_CANCEL_INVOICE }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}
async function sendInvoiceControls(chatId, text) {
  return telegramApi("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: invoiceKeyboard(),
  });
}
function invoiceDraftText(draft) {
  if (!draft.items.length) return "📋 Черновик пуст.";
  return `📋 Черновик фактуры:\n\n${draft.items.map((item, index) => `${index + 1}. ${item.name} — $${item.price.toFixed(2)} × ${item.quantity}; ${item.weight}`).join("\n")}\n\nИтого: $${draft.items.reduce((sum, item) => sum + item.total, 0).toFixed(2)}`;
}
function dishKeyboard() {
  return {
    keyboard: [
      [{ text: TELEGRAM_ADD_DISH_INGREDIENT }],
      [{ text: TELEGRAM_SHOW_RECIPE }, { text: TELEGRAM_PUBLISH_DISH }],
      [{ text: TELEGRAM_CANCEL_INVOICE }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}
async function sendDishControls(chatId, text) {
  return telegramApi("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: dishKeyboard(),
  });
}
function dishDraftText(draft) {
  return `🍽 ${draft.name}\n🗂 ${draft.category}\n💵 $${Number(draft.price || 0).toFixed(2)}\n\n${draft.recipe.length ? draft.recipe.map((item, index) => `${index + 1}. ${item.name} — ${item.amount} ${item.unit}`).join("\n") : "Ингредиенты ещё не добавлены."}`;
}
function defaultRecipeUnit(name) {
  const purchase = defaultPurchaseUnit(name);
  return purchase === "кг" ? "г" : purchase === "л" ? "мл" : "шт";
}
const INGREDIENT_CATEGORIES = [
  ["meat", "🥩 Мясо и рыба"],
  ["dairy", "🧀 Сыры и яйца"],
  ["vegetables", "🥬 Овощи и зелень"],
  ["bakery", "🍞 Хлеб и тесто"],
  ["grains", "🍚 Крупы и лапша"],
  ["sauces", "🫙 Соусы и масла"],
  ["other", "📦 Остальное"],
];
function ingredientCategory(name) {
  if (/(говя|кури|свин|индей|бекон|ветчин|лосос|тунец|пепперони)/i.test(name))
    return "meat";
  if (/(сыр|моцарелл|пармезан|горгонзол|яйц)/i.test(name)) return "dairy";
  if (
    /(авокадо|базилик|брокколи|капуста|картофель|лук|морков|овощ|огур|оливки|перец|помидор|салат|шампиньон)/i.test(
      name,
    )
  )
    return "vegetables";
  if (/(булочка|хлеб|тесто)/i.test(name)) return "bakery";
  if (/(рис|киноа|лапша|нут)/i.test(name)) return "grains";
  if (/(соус|майонез|кетчуп|горчиц|масло|паста)/i.test(name)) return "sauces";
  return "other";
}
function defaultPurchaseUnit(name) {
  if (/(булочка|хлеб|нори|яблоко|яйцо)/i.test(name)) return "шт";
  if (/(бульон|молоко|сок|соус|масло)/i.test(name)) return "л";
  return "кг";
}
function categoryKeyboard() {
  return {
    inline_keyboard: INGREDIENT_CATEGORIES.map((item) => [
      { text: item[1], callback_data: `category:${item[0]}` },
    ]),
  };
}
async function showIngredientCategories(chatId) {
  return telegramApi("sendMessage", {
    chat_id: chatId,
    text: "🛍️ Выберите категорию:",
    reply_markup: categoryKeyboard(),
  });
}
function ingredientPicker(category, page = 0) {
  const indexes = KNOWN_INGREDIENTS.map((name, index) => ({
      name,
      index,
    })).filter((item) => ingredientCategory(item.name) === category),
    size = 10,
    pages = Math.max(1, Math.ceil(indexes.length / size)),
    safePage = Math.max(0, Math.min(page, pages - 1)),
    buttons = indexes
      .slice(safePage * size, (safePage + 1) * size)
      .map((item) => [
        { text: item.name, callback_data: `ingredient:${item.index}` },
      ]),
    nav = [];
  if (safePage > 0)
    nav.push({
      text: "◀️",
      callback_data: `ingredient_page:${category}:${safePage - 1}`,
    });
  nav.push({ text: `${safePage + 1}/${pages}`, callback_data: "noop" });
  if (safePage < pages - 1)
    nav.push({
      text: "▶️",
      callback_data: `ingredient_page:${category}:${safePage + 1}`,
    });
  buttons.push(nav);
  buttons.push([{ text: "⬅️ К категориям", callback_data: "categories" }]);
  return { inline_keyboard: buttons };
}
async function showIngredientPicker(chatId, category, page = 0) {
  const label =
    INGREDIENT_CATEGORIES.find((item) => item[0] === category)?.[1] ||
    "Продукты";
  return telegramApi("sendMessage", {
    chat_id: chatId,
    text: `${label}\n\nВыберите продукт:`,
    reply_markup: ingredientPicker(category, page),
  });
}
async function handleTelegramCallback(query) {
  const configuredChat = String(process.env.TELEGRAM_CHAT_ID || ""),
    chatId = query.message?.chat?.id,
    key = String(chatId),
    invoiceDraft = telegramInvoiceDrafts.get(key),
    dishDraft = telegramDishDrafts.get(key),
    draft = invoiceDraft || dishDraft,
    data = clean(query.data);
  await telegramApi("answerCallbackQuery", { callback_query_id: query.id });
  if (String(chatId) !== configuredChat || !draft) return;
  if (data.startsWith("dish_category:") && dishDraft) {
    dishDraft.category = data.split(":")[1];
    dishDraft.stage = "price";
    return telegramApi("sendMessage", {
      chat_id: chatId,
      text: `✅ Категория: ${dishDraft.category}\n\nВведите цену блюда, например: 18.50`,
    });
  }
  if (data === "categories") return showIngredientCategories(chatId);
  if (data.startsWith("category:"))
    return showIngredientPicker(chatId, data.split(":")[1], 0);
  if (data.startsWith("ingredient_page:")) {
    const [, category, page] = data.split(":");
    return showIngredientPicker(chatId, category, Number(page) || 0);
  }
  if (data.startsWith("ingredient:")) {
    const index = Number(data.split(":")[1]);
    if (!KNOWN_INGREDIENTS[index]) return;
    draft.selectedName = KNOWN_INGREDIENTS[index];
    if (dishDraft) {
      dishDraft.selectedUnit = defaultRecipeUnit(dishDraft.selectedName);
      dishDraft.awaitingIngredientAmount = true;
      return telegramApi("sendMessage", {
        chat_id: chatId,
        text: `✅ ${dishDraft.selectedName}\n\nСколько ${dishDraft.selectedUnit} нужно на 1 порцию?\nВведите число:`,
      });
    }
    invoiceDraft.selectedUnit = defaultPurchaseUnit(invoiceDraft.selectedName);
    invoiceDraft.awaitingNumbers = true;
    return telegramApi("sendMessage", {
      chat_id: chatId,
      text: `✅ ${invoiceDraft.selectedName}\n📦 Учёт: ${invoiceDraft.selectedUnit}\n\nОдной строкой введите:\nЦена за упаковку | Кол-во упаковок | Общий объём (${invoiceDraft.selectedUnit})\n\nПример: 2.50 | 10 | 5`,
    });
  }
}
function dishCategoryKeyboard() {
  return {
    inline_keyboard: [
      ["Burger", "Pizza"],
      ["Sandwich", "Asian"],
      ["Set Menu"],
    ].map((row) =>
      row.map((category) => ({
        text: category,
        callback_data: `dish_category:${category}`,
      })),
    ),
  };
}
function dishImage(category) {
  return (
    {
      Burger: "assets/images/burger-1.jpg",
      Pizza: "assets/images/restaurant-1.jpg",
      Sandwich: "assets/images/contactless.jpg",
      Asian: "assets/images/restaurant-3.jpg",
      "Set Menu": "assets/images/app-phones.jpg",
    }[category] || "assets/images/burger-1.jpg"
  );
}
async function handleDishDraftMessage(message, draft) {
  const chatId = message.chat.id,
    key = String(chatId),
    text = clean(message.text);
  if (draft.stage === "name") {
    if (text.length < 2 || text.length > 100)
      return telegramApi("sendMessage", {
        chat_id: chatId,
        text: "Название должно содержать от 2 до 100 символов.",
      });
    draft.name = text;
    draft.stage = "category";
    return telegramApi("sendMessage", {
      chat_id: chatId,
      text: "Выберите категорию блюда:",
      reply_markup: dishCategoryKeyboard(),
    });
  }
  if (draft.stage === "price") {
    const price = Number(text.replace(",", "."));
    if (!Number.isFinite(price) || price <= 0 || price > 10000)
      return telegramApi("sendMessage", {
        chat_id: chatId,
        text: "Введите корректную цену, например: 18.50",
      });
    draft.price = Number(price.toFixed(2));
    draft.stage = "recipe";
    return sendDishControls(
      chatId,
      `✅ Основа блюда готова.\n\n${dishDraftText(draft)}\n\nТеперь добавьте ингредиенты.`,
    );
  }
  if (text === TELEGRAM_ADD_DISH_INGREDIENT)
    return showIngredientCategories(chatId);
  if (text === TELEGRAM_SHOW_RECIPE)
    return sendDishControls(chatId, dishDraftText(draft));
  if (text === TELEGRAM_PUBLISH_DISH) {
    if (!draft.recipe.length)
      return sendDishControls(chatId, "❌ Добавьте хотя бы один ингредиент.");
    const db = await readDb();
    if (
      db.customDishes.some(
        (item) => item.name.toLowerCase() === draft.name.toLowerCase(),
      )
    )
      return sendDishControls(
        chatId,
        "❌ Блюдо с таким названием уже существует.",
      );
    const dish = {
      id: id(),
      name: draft.name,
      category: draft.category,
      price: draft.price,
      rating: 5,
      image: dishImage(draft.category),
      recipe: draft.recipe,
      createdAt: new Date().toISOString(),
    };
    await sendDishToGoogleSheets(dish);
    db.customDishes.push(dish);
    await writeDb(db);
    telegramDishDrafts.delete(key);
    return sendTelegramMenu(
      chatId,
      `🚀 Блюдо «${dish.name}» опубликовано.\n\nЦена: $${dish.price.toFixed(2)}\nКатегория: ${dish.category}\nИнгредиентов: ${dish.recipe.length}`,
    );
  }
  if (draft.awaitingIngredientAmount && draft.selectedName) {
    const amount = Number(text.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0)
      return telegramApi("sendMessage", {
        chat_id: chatId,
        text: "Введите положительное число.",
      });
    const existing = draft.recipe.find(
      (item) => item.name === draft.selectedName,
    );
    if (existing) {
      existing.amount = amount;
      existing.unit = draft.selectedUnit;
    } else
      draft.recipe.push({
        name: draft.selectedName,
        amount,
        unit: draft.selectedUnit,
      });
    delete draft.awaitingIngredientAmount;
    delete draft.selectedName;
    delete draft.selectedUnit;
    return sendDishControls(
      chatId,
      `✅ Ингредиент добавлен.\n\n${dishDraftText(draft)}`,
    );
  }
}
async function handleTelegramMessage(message) {
  const configuredChat = String(process.env.TELEGRAM_CHAT_ID || "");
  if (!message?.chat || String(message.chat.id) !== configuredChat) return;
  const chatId = message.chat.id,
    key = String(chatId),
    text = clean(message.text),
    draft = telegramInvoiceDrafts.get(key),
    dishDraft = telegramDishDrafts.get(key);
  if (text === "/cancel" || text === TELEGRAM_CANCEL_INVOICE) {
    telegramInvoiceDrafts.delete(key);
    telegramDishDrafts.delete(key);
    return sendTelegramMenu(chatId, "Действие отменено.");
  }
  if (text === "/start" || text === "/menu")
    return sendTelegramMenu(
      chatId,
      "👋 Панель EFood\n\nВыберите нужное действие.",
    );
  if (text === TELEGRAM_PROFIT_BUTTON) {
    const report = await currentMonthSales();
    return sendTelegramMenu(
      chatId,
      `📊 Отчёт за ${report.monthName}\n\n📦 Заказов: ${report.orders}\n💰 Общая прибыль: $${report.total.toFixed(2)}`,
    );
  }
  if (text === TELEGRAM_DISH_BUTTON) {
    telegramInvoiceDrafts.delete(key);
    telegramDishDrafts.set(key, { stage: "name", recipe: [] });
    return telegramApi("sendMessage", {
      chat_id: chatId,
      text: "🍽 Новое блюдо\n\nВведите название блюда:",
    });
  }
  if (dishDraft) return handleDishDraftMessage(message, dishDraft);
  if (text === TELEGRAM_INVOICE_BUTTON) {
    telegramDishDrafts.delete(key);
    telegramInvoiceDrafts.set(key, { items: [] });
    return sendInvoiceControls(
      chatId,
      "📥 Новая фактура\n\n1. Добавляйте продукты\n2. Проверьте черновик\n3. Завершите фактуру",
    );
  }
  if (!draft) return;
  if (text === TELEGRAM_ADD_PRODUCT) return showIngredientCategories(chatId);
  if (text === TELEGRAM_SHOW_DRAFT)
    return sendInvoiceControls(chatId, invoiceDraftText(draft));
  if (text === TELEGRAM_REMOVE_LAST) {
    const removed = draft.items.pop();
    return sendInvoiceControls(
      chatId,
      removed
        ? `↩️ Удалено: ${removed.name}\n\n${invoiceDraftText(draft)}`
        : "📋 Черновик уже пуст.",
    );
  }
  if (text === TELEGRAM_FINISH_INVOICE) {
    if (!draft.items.length)
      return sendInvoiceControls(
        chatId,
        "❌ Сначала добавьте хотя бы один продукт.",
      );
    const invoice = {
      number: `INV-${Date.now()}`,
      createdAt: new Date().toISOString(),
      items: draft.items,
      total: Number(
        draft.items.reduce((sum, item) => sum + item.total, 0).toFixed(2),
      ),
    };
    await sendInvoiceToGoogleSheets(invoice);
    telegramInvoiceDrafts.delete(key);
    return sendTelegramMenu(
      chatId,
      `✅ Фактура ${invoice.number} добавлена.\n\nПозиций: ${invoice.items.length}\nИтого: $${invoice.total.toFixed(2)}`,
    );
  }
  if (draft.awaitingNumbers && draft.selectedName && draft.selectedUnit) {
    const values = text
      .split("|")
      .map((value) => Number(value.trim().replace(",", ".")));
    if (
      values.length !== 3 ||
      values.some((value) => !Number.isFinite(value) || value <= 0)
    )
      return telegramApi("sendMessage", {
        chat_id: chatId,
        text: "❌ Формат: цена | упаковки | объём\n\nПример: 2.50 | 10 | 5",
      });
    const [price, quantity, amount] = values,
      item = {
        name: draft.selectedName,
        price: Number(price.toFixed(2)),
        quantity: Number(quantity.toFixed(3)),
        weight: `${amount} ${draft.selectedUnit}`,
        total: Number((price * quantity).toFixed(2)),
      };
    draft.items.push(item);
    delete draft.awaitingNumbers;
    delete draft.selectedName;
    delete draft.selectedUnit;
    return sendInvoiceControls(
      chatId,
      `✅ ${item.name} добавлен.\n\nПозиций в фактуре: ${draft.items.length}\nСумма: $${draft.items.reduce((sum, current) => sum + current.total, 0).toFixed(2)}`,
    );
  }
}
let telegramPolling = false;
async function startTelegramBot() {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return;
  telegramPolling = true;
  let offset = 0;
  try {
    await telegramApi("deleteWebhook", { drop_pending_updates: false });
    await sendTelegramMenu(
      process.env.TELEGRAM_CHAT_ID,
      "✅ EFood Bot запущен. Финансовый отчёт и фактуры доступны по кнопкам ниже.",
    );
  } catch (err) {
    console.error(err.message);
  }
  while (telegramPolling) {
    try {
      const updates = await telegramApi("getUpdates", {
        offset,
        timeout: 25,
        allowed_updates: ["message", "callback_query"],
      });
      for (const update of updates) {
        offset = update.update_id + 1;
        try {
          if (update.callback_query)
            await handleTelegramCallback(update.callback_query);
          else if (update.message) await handleTelegramMessage(update.message);
        } catch (err) {
          console.error(err.message);
        }
      }
    } catch (err) {
      if (telegramPolling) {
        console.error(err.message);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }
}

function restoreTelegramDrafts(db) {
  telegramInvoiceDrafts.clear();
  telegramDishDrafts.clear();
  for (const [key, draft] of Object.entries(db.telegramDrafts?.invoice || {}))
    telegramInvoiceDrafts.set(key, draft);
  for (const [key, draft] of Object.entries(db.telegramDrafts?.dish || {}))
    telegramDishDrafts.set(key, draft);
}

async function processTelegramWebhook(update) {
  restoreTelegramDrafts(await readDb());
  try {
    if (update.callback_query)
      await handleTelegramCallback(update.callback_query);
    else if (update.message) await handleTelegramMessage(update.message);
  } finally {
    const latest = await readDb();
    latest.telegramDrafts = {
      invoice: Object.fromEntries(telegramInvoiceDrafts),
      dish: Object.fromEntries(telegramDishDrafts),
    };
    await writeDb(latest);
  }
}

async function api(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/telegram/webhook") {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET || "";
    const received = clean(req.headers["x-telegram-bot-api-secret-token"]);
    if (!expected || received !== expected)
      return error(res, 403, "Invalid Telegram webhook secret.");
    await processTelegramWebhook(await body(req, 2000000));
    return json(res, 200, { ok: true });
  }
  if (!sameOrigin(req)) return error(res, 403, "Invalid request origin.");
  const db = await readDb();
  db.sessions = db.sessions.filter((item) => item.expiresAt > Date.now());
  db.adminSessions = db.adminSessions.filter(
    (item) => item.expiresAt > Date.now(),
  );
  db.recoveryCodes = db.recoveryCodes.filter(
    (item) => item.expiresAt > Date.now(),
  );
  db.passwordChanges = db.passwordChanges.filter(
    (item) => item.expiresAt > Date.now(),
  );
  db.emailVerificationCodes = db.emailVerificationCodes.filter(
    (item) => item.expiresAt > Date.now(),
  );
  if (ensureMenu(db)) await writeDb(db);
  if (req.method === "GET" && url.pathname === "/api/health")
    return json(res, 200, { status: "ok", time: new Date().toISOString() });
  if (req.method === "GET" && url.pathname === "/api/site")
    return json(res, 200, { content: getSiteContent(db) });
  if (req.method === "GET" && url.pathname === "/api/menu")
    return json(res, 200, {
      dishes: db.customDishes.map(({ recipe, ...dish }) => dish),
    });
  if (req.method === "POST" && url.pathname === "/api/admin/login") {
    if (!rateLimit(req, res, "admin-login", 6, 600000)) return;
    const data = await body(req),
      login = clean(data.login),
      expectedLogin = process.env.ADMIN_LOGIN || "admin",
      stored = process.env.ADMIN_PASSWORD_HASH || "";
    if (
      login !== expectedLogin ||
      !stored ||
      !(await passwordMatches(data.password, stored))
    )
      return error(res, 401, "Incorrect login or password.");
    setAdminSession(res, db);
    await writeDb(db);
    return json(res, 200, { ok: true });
  }
  if (req.method === "POST" && url.pathname === "/api/admin/logout") {
    const token = cookies(req).efood_admin;
    if (token) {
      const hash = crypto.createHash("sha256").update(token).digest("hex");
      db.adminSessions = db.adminSessions.filter(
        (item) => item.tokenHash !== hash,
      );
      await writeDb(db);
    }
    res.setHeader(
      "Set-Cookie",
      `efood_admin=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0`,
    );
    return json(res, 200, { ok: true });
  }
  if (url.pathname.startsWith("/api/admin/")) {
    if (!adminSession(req, db))
      return error(res, 401, "Administrator authentication required.");
    if (req.method === "GET" && url.pathname === "/api/admin/state")
      return json(res, 200, {
        content: getSiteContent(db),
        dishes: db.customDishes,
      });
    if (req.method === "PUT" && url.pathname === "/api/admin/content") {
      const data = await body(req);
      db.siteContent = sanitizeSiteContent(data.content, getSiteContent(db));
      await writeDb(db);
      return json(res, 200, { content: db.siteContent });
    }
    if (req.method === "POST" && url.pathname === "/api/admin/upload") {
      const data = await body(req, 7500000),
        match = clean(data.dataUrl).match(
          /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/,
        );
      if (!match) return error(res, 422, "Choose a JPEG, PNG or WebP image.");
      const buffer = Buffer.from(match[2], "base64");
      if (!buffer.length || buffer.length > 5000000)
        return error(res, 413, "Image must be smaller than 5 MB.");
      const extension = match[1] === "jpeg" ? "jpg" : match[1];
      const filename = `${Date.now()}-${crypto.randomBytes(5).toString("hex")}.${extension}`;
      if (process.env.BLOB_READ_WRITE_TOKEN) {
        const { put } = await import("@vercel/blob");
        const uploaded = await put(`uploads/${filename}`, buffer, {
          access: "public",
          contentType: `image/${match[1]}`,
          addRandomSuffix: false,
        });
        return json(res, 201, { url: uploaded.url });
      }
      const directory = path.join(ROOT, "assets", "uploads");
      await fs.promises.mkdir(directory, { recursive: true });
      await fs.promises.writeFile(path.join(directory, filename), buffer);
      return json(res, 201, { url: `assets/uploads/${filename}` });
    }
    if (req.method === "POST" && url.pathname === "/api/admin/dishes") {
      const dish = sanitizeAdminDish(await body(req));
      if (
        db.customDishes.some(
          (item) => item.name.toLowerCase() === dish.name.toLowerCase(),
        )
      )
        return error(res, 409, "A dish with this name already exists.");
      if (dish.recipe.length) await sendDishToGoogleSheets(dish);
      db.customDishes.push(dish);
      await writeDb(db);
      return json(res, 201, { dish });
    }
    const dishMatch = url.pathname.match(/^\/api\/admin\/dishes\/([^/]+)$/i);
    if (dishMatch && req.method === "PUT") {
      const index = db.customDishes.findIndex(
        (item) => item.id === dishMatch[1],
      );
      if (index < 0) return error(res, 404, "Dish not found.");
      db.customDishes[index] = sanitizeAdminDish(await body(req), dishMatch[1]);
      await writeDb(db);
      return json(res, 200, { dish: db.customDishes[index] });
    }
    if (dishMatch && req.method === "DELETE") {
      const index = db.customDishes.findIndex(
        (item) => item.id === dishMatch[1],
      );
      if (index < 0) return error(res, 404, "Dish not found.");
      const [dish] = db.customDishes.splice(index, 1);
      await writeDb(db);
      return json(res, 200, { dish });
    }
  }
  if (req.method === "POST" && url.pathname === "/api/auth/register") {
    if (!rateLimit(req, res, "register", 5, 300000)) return;
    const data = await body(req),
      { fields, value } = validateProfile(data);
    if (!validPassword(data.password))
      fields.password = "Use 8+ characters with a letter and number.";
    if (Object.keys(fields).length)
      return error(res, 422, "Please correct the highlighted fields.", fields);
    if (db.users.some((user) => user.email === value.email))
      return error(res, 409, "An account with this email already exists.");
    if (db.users.some((user) => user.phone === value.phone))
      return error(res, 409, "An account with this phone already exists.");
    const user = {
      id: id(),
      ...value,
      emailVerified: false,
      passwordHash: await passwordHash(data.password),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const code = await issueEmailVerification(db, user);
    db.users.push(user);
    setSession(res, db, user);
    await writeDb(db);
    return json(res, 201, {
      user: publicUser(user),
      requiresVerification: true,
      ...(!PRODUCTION && !process.env.RESEND_API_KEY ? { devCode: code } : {}),
    });
  }
  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    if (!rateLimit(req, res, "login", 8, 300000)) return;
    const data = await body(req),
      user = db.users.find((item) => item.email === email(data.email));
    if (!user || !(await passwordMatches(data.password, user.passwordHash)))
      return error(res, 401, "Incorrect email or password.");
    setSession(res, db, user);
    await writeDb(db);
    return json(res, 200, { user: publicUser(user) });
  }
  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const token = cookies(req).efood_session;
    if (token)
      db.sessions = db.sessions.filter(
        (item) =>
          item.tokenHash !==
          crypto.createHash("sha256").update(token).digest("hex"),
      );
    clearSession(res);
    await writeDb(db);
    return json(res, 200, { ok: true });
  }
  const user = sessionUser(req, db);
  if (req.method === "GET" && url.pathname === "/api/account") {
    if (!user) return error(res, 401, "Authentication required.");
    refreshSession(req, res, db);
    await writeDb(db);
    return json(res, 200, { user: publicUser(user) });
  }
  if (req.method === "PUT" && url.pathname === "/api/account") {
    if (!user) return error(res, 401, "Authentication required.");
    const data = await body(req),
      { fields, value } = validateProfile(data);
    if (Object.keys(fields).length)
      return error(res, 422, "Please correct the highlighted fields.", fields);
    if (
      db.users.some((item) => item.id !== user.id && item.email === value.email)
    )
      return error(res, 409, "This email is already registered.");
    if (
      db.users.some((item) => item.id !== user.id && item.phone === value.phone)
    )
      return error(res, 409, "This phone is already registered.");
    const emailChanged = user.email !== value.email;
    Object.assign(user, value, { updatedAt: new Date().toISOString() });
    let code;
    if (emailChanged) {
      user.emailVerified = false;
      code = await issueEmailVerification(db, user);
    }
    await writeDb(db);
    return json(res, 200, {
      user: publicUser(user),
      requiresVerification: emailChanged,
      ...(emailChanged && !PRODUCTION && !process.env.RESEND_API_KEY
        ? { devCode: code }
        : {}),
    });
  }
  if (req.method === "POST" && url.pathname === "/api/auth/verify-email") {
    if (!user) return error(res, 401, "Authentication required.");
    if (user.emailVerified) return json(res, 200, { user: publicUser(user) });
    if (!rateLimit(req, res, "verify-email", 8, 600000)) return;
    const data = await body(req),
      record = db.emailVerificationCodes.find(
        (item) => item.userId === user.id,
      );
    if (!record || record.expiresAt < Date.now())
      return error(res, 422, "Verification code has expired.");
    record.attempts++;
    const codeHash = crypto
      .createHash("sha256")
      .update(clean(data.code))
      .digest("hex");
    if (record.codeHash !== codeHash || record.attempts > 5) {
      await writeDb(db);
      return error(res, 422, "Incorrect verification code.", {
        code: "Incorrect verification code.",
      });
    }
    user.emailVerified = true;
    user.updatedAt = new Date().toISOString();
    db.emailVerificationCodes = db.emailVerificationCodes.filter(
      (item) => item.id !== record.id,
    );
    await writeDb(db);
    return json(res, 200, { user: publicUser(user) });
  }
  if (
    req.method === "POST" &&
    url.pathname === "/api/auth/resend-verification"
  ) {
    if (!user) return error(res, 401, "Authentication required.");
    if (user.emailVerified)
      return json(res, 200, {
        user: publicUser(user),
        message: "Email is already verified.",
      });
    if (!rateLimit(req, res, "resend-verification", 3, 600000)) return;
    const code = await issueEmailVerification(db, user);
    await writeDb(db);
    return json(res, 200, {
      message: "A new verification code was sent.",
      ...(!PRODUCTION && !process.env.RESEND_API_KEY ? { devCode: code } : {}),
    });
  }
  if (req.method === "POST" && url.pathname === "/api/auth/change-password") {
    if (!user) return error(res, 401, "Authentication required.");
    if (!rateLimit(req, res, "password", 4, 600000)) return;
    const data = await body(req);
    if (!(await passwordMatches(data.currentPassword, user.passwordHash)))
      return error(res, 422, "Current password is incorrect.", {
        current: "Current password is incorrect.",
      });
    if (!validPassword(data.password))
      return error(res, 422, "Password is too weak.", {
        password: "Use 8+ characters with a letter and number.",
      });
    const code = String(crypto.randomInt(100000, 1000000)),
      changeId = id();
    db.passwordChanges = db.passwordChanges.filter(
      (item) => item.userId !== user.id,
    );
    db.passwordChanges.push({
      id: changeId,
      userId: user.id,
      passwordHash: await passwordHash(data.password),
      codeHash: crypto.createHash("sha256").update(code).digest("hex"),
      expiresAt: Date.now() + 600000,
      attempts: 0,
    });
    try {
      await sendRecovery(user, "email", code);
    } catch (providerError) {
      return error(res, 503, providerError.message);
    }
    await writeDb(db);
    return json(res, 200, {
      message: "Confirmation code sent to your registered email.",
      changeId,
      ...(PRODUCTION ? {} : { devCode: code }),
    });
  }
  if (
    req.method === "POST" &&
    url.pathname === "/api/auth/change-password/confirm"
  ) {
    if (!user) return error(res, 401, "Authentication required.");
    if (!rateLimit(req, res, "password-confirm", 8, 600000)) return;
    const data = await body(req),
      record = db.passwordChanges.find(
        (item) => item.id === clean(data.changeId) && item.userId === user.id,
      );
    if (!record || record.expiresAt < Date.now())
      return error(res, 422, "Confirmation code has expired.");
    record.attempts++;
    const codeHash = crypto
      .createHash("sha256")
      .update(clean(data.code))
      .digest("hex");
    if (record.codeHash !== codeHash || record.attempts > 5) {
      await writeDb(db);
      return error(res, 422, "Incorrect confirmation code.", {
        code: "Incorrect confirmation code.",
      });
    }
    user.passwordHash = record.passwordHash;
    user.updatedAt = new Date().toISOString();
    db.passwordChanges = db.passwordChanges.filter(
      (item) => item.id !== record.id,
    );
    db.sessions = db.sessions.filter((item) => item.userId !== user.id);
    setSession(res, db, user);
    await writeDb(db);
    return json(res, 200, { ok: true, user: publicUser(user) });
  }
  if (req.method === "POST" && url.pathname === "/api/auth/recovery/request") {
    if (!rateLimit(req, res, "recovery", 3, 600000)) return;
    const data = await body(req),
      channel = data.channel === "phone" ? "phone" : "email",
      target =
        user || db.users.find((item) => item.email === email(data.identifier)),
      requestId = id();
    if (!target) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return json(res, 200, {
        message: "If that account exists, a confirmation code has been sent.",
        recoveryId: requestId,
      });
    }
    const code = String(crypto.randomInt(100000, 1000000));
    db.recoveryCodes = db.recoveryCodes.filter(
      (item) => item.userId !== target.id,
    );
    db.recoveryCodes.push({
      id: requestId,
      userId: target.id,
      codeHash: crypto.createHash("sha256").update(code).digest("hex"),
      expiresAt: Date.now() + 600000,
      attempts: 0,
    });
    try {
      await sendRecovery(target, channel, code);
    } catch (providerError) {
      return error(res, 503, providerError.message);
    }
    await writeDb(db);
    return json(res, 200, {
      message: `Confirmation code sent to your ${channel}.`,
      recoveryId: requestId,
      ...(PRODUCTION ? {} : { devCode: code }),
    });
  }
  if (req.method === "POST" && url.pathname === "/api/auth/recovery/confirm") {
    if (!rateLimit(req, res, "recovery-confirm", 8, 600000)) return;
    const data = await body(req),
      record = db.recoveryCodes.find(
        (item) => item.id === clean(data.recoveryId),
      ),
      target = record && db.users.find((item) => item.id === record.userId);
    if (!record || !target || record.expiresAt < Date.now())
      return error(res, 422, "Confirmation code has expired.");
    record.attempts++;
    const codeHash = crypto
      .createHash("sha256")
      .update(clean(data.code))
      .digest("hex");
    if (record.codeHash !== codeHash || record.attempts > 5) {
      await writeDb(db);
      return error(res, 422, "Incorrect confirmation code.", {
        code: "Incorrect confirmation code.",
      });
    }
    if (!validPassword(data.password))
      return error(res, 422, "Password is too weak.", {
        password: "Use 8+ characters with a letter and number.",
      });
    target.passwordHash = await passwordHash(data.password);
    db.recoveryCodes = db.recoveryCodes.filter((item) => item.id !== record.id);
    db.sessions = db.sessions.filter((item) => item.userId !== target.id);
    setSession(res, db, target);
    await writeDb(db);
    return json(res, 200, { ok: true, user: publicUser(target) });
  }
  if (req.method === "GET" && url.pathname === "/api/orders") {
    if (!user) return error(res, 401, "Authentication required.");
    return json(res, 200, {
      orders: db.orders
        .filter((order) => order.userId === user.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    });
  }
  if (req.method === "POST" && url.pathname === "/api/orders") {
    if (!user) return error(res, 401, "Authentication required.");
    if (!user.emailVerified)
      return error(res, 403, "Verify your email before placing an order.");
    const data = await body(req),
      recipient = clean(data.recipient),
      phone = clean(data.phone),
      address = clean(data.address),
      items = Array.isArray(data.items) ? data.items : [];
    if (
      recipient.length < 2 ||
      !validPhone(phone) ||
      address.length < 6 ||
      !items.length
    )
      return error(
        res,
        422,
        "Complete all delivery details and add at least one item.",
      );
    const safeItems = items
      .slice(0, 50)
      .map((item) => ({
        name: clean(item.name).slice(0, 100),
        image: clean(item.image).slice(0, 500),
        price: Number(item.price),
        qty: Math.max(1, Math.min(20, Number(item.qty) || 1)),
      }))
      .filter(
        (item) => item.name && Number.isFinite(item.price) && item.price >= 0,
      );
    if (!safeItems.length) return error(res, 422, "Order has no valid items.");
    const order = {
      id: id(),
      number: String(Date.now()).slice(-8),
      userId: user.id,
      recipient,
      phone,
      address,
      items: safeItems,
      total: Number(
        safeItems
          .reduce((sum, item) => sum + item.price * item.qty, 0)
          .toFixed(2),
      ),
      status: "confirmed",
      createdAt: new Date().toISOString(),
    };
    db.orders.push(order);
    await writeDb(db);
    const notifications = await Promise.allSettled([
      sendTelegramOrder(order, user),
      sendOrderToGoogleSheets(order, user),
    ]);
    for (const result of notifications)
      if (result.status === "rejected") console.error(result.reason.message);
    return json(res, 201, { order });
  }
  if (req.method === "POST" && url.pathname === "/api/feedback") {
    if (!rateLimit(req, res, "feedback", 5, 600000)) return;
    const data = await body(req),
      topic = clean(data.topic).slice(0, 100),
      message = clean(data.message).slice(0, 1500);
    if (message.length < 10)
      return error(res, 422, "Please describe your question in more detail.", {
        message: "Please provide more detail.",
      });
    const feedback = {
      id: id(),
      number: String(Date.now()).slice(-8),
      userId: user?.id || null,
      name: user?.name || "Anonymous guest",
      email: user?.email || "Not provided",
      phone: user?.phone || "Not provided",
      topic: topic || "Other question",
      message,
      status: "new",
      createdAt: new Date().toISOString(),
    };
    db.feedback.push(feedback);
    await writeDb(db);
    try {
      await sendTelegramFeedback(feedback);
    } catch (notificationError) {
      console.error(notificationError.message);
    }
    return json(res, 201, {
      message: "Your question was sent successfully.",
      reference: feedback.number,
    });
  }
  if (req.method === "POST" && url.pathname === "/api/subscribers") {
    if (!rateLimit(req, res, "subscribe", 5, 300000)) return;
    const data = await body(req),
      mail = email(data.email);
    if (!validEmail(mail))
      return error(res, 422, "Enter a valid email address.");
    if (!db.subscribers.some((item) => item.email === mail))
      db.subscribers.push({
        id: id(),
        email: mail,
        createdAt: new Date().toISOString(),
      });
    await writeDb(db);
    return json(res, 201, { ok: true });
  }
  return error(res, 404, "API endpoint not found.");
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const file = path.resolve(ROOT, `.${pathname}`);
  if (
    !file.startsWith(ROOT) ||
    file.includes(`${path.sep}data${path.sep}`) ||
    file.endsWith(".env")
  )
    return error(res, 403, "Forbidden.");
  fs.stat(file, (err, stats) => {
    if (err || !stats.isFile()) return error(res, 404, "Not found.");
    res.writeHead(200, {
      "Content-Type":
        MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": PRODUCTION ? "public, max-age=3600" : "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    });
    fs.createReadStream(file).pipe(res);
  });
}

if (!process.env.VERCEL) ensureDb();
const requestHandler = async (req, res) => {
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), camera=(), microphone=()",
  );
  try {
    const url = new URL(req.url, ORIGIN);
    if (url.pathname.startsWith("/api/")) await api(req, res, url);
    else serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    error(
      res,
      err.status || 500,
      PRODUCTION ? "Internal server error." : err.message,
    );
  }
};

module.exports = requestHandler;

if (require.main === module) {
  const server = http.createServer(requestHandler);
  server.listen(PORT, () => {
    console.log(`EFood running at ${ORIGIN}`);
    startTelegramBot();
  });
  server.on("close", () => {
    telegramPolling = false;
  });
}
