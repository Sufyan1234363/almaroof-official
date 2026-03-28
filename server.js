/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║           AL MAROOF — Production Backend                 ║
 * ║   Node.js + Express + MySQL + Paystack + VTPass + SMS    ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * npm install express mysql2 bcryptjs jsonwebtoken cors dotenv
 *             axios nodemailer crypto
 */

'use strict';
require('dotenv').config();

const express    = require('express');
const mysql      = require('mysql2/promise');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const cors       = require('cors');
const axios      = require('axios');
const nodemailer = require('nodemailer');
const crypto     = require('crypto');
const path       = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ════════════════════════════════════════════════════════════
//  DATABASE
// ════════════════════════════════════════════════════════════
const db = mysql.createPool({
  host:             process.env.DB_HOST || 'localhost',
  user:             process.env.DB_USER || 'root',
  password:         process.env.DB_PASS || '',
  database:         process.env.DB_NAME || 'almaroof',
  waitForConnections: true,
  connectionLimit:  10,
});

// ════════════════════════════════════════════════════════════
//  JWT
// ════════════════════════════════════════════════════════════
const JWT_SECRET = process.env.JWT_SECRET || 'almaroof_jwt_secret';

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return fail(res, 'Unauthorized', 401);
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { fail(res, 'Invalid or expired token', 401); }
}

// ════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════
const success = (res, data, status = 200) => res.status(status).json({ success: true,  ...data });
const fail    = (res, msg,  status = 400) => res.status(status).json({ success: false, message: msg });

function genRef(prefix = 'AM') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

// ════════════════════════════════════════════════════════════
//  EMAIL (Nodemailer)
// ════════════════════════════════════════════════════════════
const mailer = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'smtp.gmail.com',
  port:   587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendEmail(to, subject, html) {
  if (!process.env.SMTP_USER) return; // skip if not configured
  try {
    await mailer.sendMail({
      from: `"Al Maroof" <${process.env.SMTP_USER}>`,
      to, subject, html,
    });
  } catch (e) { console.error('Email error:', e.message); }
}

function emailWelcome(name, email) {
  return sendEmail(email, 'Welcome to Al Maroof! 🎉', `
    <div style="font-family:sans-serif;max-width:500px;margin:0 auto;background:#0A0A0A;color:#F5F5F0;padding:32px;border-radius:16px;">
      <h2 style="color:#D4A017;">Welcome, ${name}! 👋</h2>
      <p>Your Al Maroof account is ready. You can now buy data, airtime and pay bills instantly.</p>
      <p style="color:#999;">— Al Maroof Team</p>
    </div>`);
}

function emailTransaction(email, name, desc, amount, type, balance) {
  const color = type === 'credit' ? '#2ECC71' : '#E74C3C';
  const sign  = type === 'credit' ? '+' : '-';
  return sendEmail(email, `Transaction Alert — Al Maroof`, `
    <div style="font-family:sans-serif;max-width:500px;margin:0 auto;background:#0A0A0A;color:#F5F5F0;padding:32px;border-radius:16px;">
      <h2 style="color:#D4A017;">Transaction Alert</h2>
      <p>Hi ${name},</p>
      <p>${desc}</p>
      <p style="font-size:28px;font-weight:bold;color:${color};">${sign}₦${Number(amount).toLocaleString()}</p>
      <p>New Balance: <strong>₦${Number(balance).toLocaleString()}</strong></p>
      <p style="color:#999;font-size:12px;">If you did not initiate this, contact support immediately.</p>
    </div>`);
}

// ════════════════════════════════════════════════════════════
//  SMS (Termii — Nigerian SMS provider)
// ════════════════════════════════════════════════════════════
async function sendSMS(to, message) {
  if (!process.env.TERMII_KEY) return;
  try {
    await axios.post('https://api.ng.termii.com/api/sms/send', {
      to,
      from:    'AlMaroof',
      sms:     message,
      type:    'plain',
      channel: 'generic',
      api_key: process.env.TERMII_KEY,
    });
  } catch (e) { console.error('SMS error:', e.message); }
}

// ════════════════════════════════════════════════════════════
//  VTPASS — Data, Airtime & Bills Provider
// ════════════════════════════════════════════════════════════
const VTPASS = {
  BASE: process.env.VTPASS_ENV === 'live'
    ? 'https://vtpass.com/api'
    : 'https://sandbox.vtpass.com/api',

  headers() {
    const key = Buffer.from(
      `${process.env.VTPASS_USER}:${process.env.VTPASS_PASS}`
    ).toString('base64');
    return {
      'Authorization': `Basic ${key}`,
      'Content-Type':  'application/json',
    };
  },

  // Network serviceID map
  dataService(network) {
    const map = { mtn:'mtn-data', airtel:'airtel-data', glo:'glo-data', '9mobile':'etisalat-data' };
    return map[network] || 'mtn-data';
  },

  airtimeService(network) {
    const map = { mtn:'mtn', airtel:'airtel', glo:'glo', '9mobile':'etisalat' };
    return map[network] || 'mtn';
  },

  async buyData(network, phone, variationCode, requestId) {
    const { data } = await axios.post(`${VTPASS.BASE}/pay`, {
      request_id:     requestId,
      serviceID:      VTPASS.dataService(network),
      billersCode:    phone,
      variation_code: variationCode,
      amount:         '',
      phone,
    }, { headers: VTPASS.headers() });
    return data;
  },

  async buyAirtime(network, phone, amount, requestId) {
    const { data } = await axios.post(`${VTPASS.BASE}/pay`, {
      request_id:  requestId,
      serviceID:   VTPASS.airtimeService(network),
      billersCode: phone,
      amount,
      phone,
    }, { headers: VTPASS.headers() });
    return data;
  },

  async verifyMeter(serviceID, meterNumber, meterType) {
    const { data } = await axios.post(`${VTPASS.BASE}/merchant-verify`, {
      billersCode: meterNumber,
      serviceID,
      type: meterType,
    }, { headers: VTPASS.headers() });
    return data;
  },

  async payElectricity(serviceID, meterNumber, meterType, amount, phone, requestId) {
    const { data } = await axios.post(`${VTPASS.BASE}/pay`, {
      request_id:     requestId,
      serviceID,
      billersCode:    meterNumber,
      variation_code: meterType,
      amount,
      phone,
    }, { headers: VTPASS.headers() });
    return data;
  },

  async payCableTV(serviceID, smartCard, variationCode, phone, requestId) {
    const { data } = await axios.post(`${VTPASS.BASE}/pay`, {
      request_id:     requestId,
      serviceID,
      billersCode:    smartCard,
      variation_code: variationCode,
      phone,
    }, { headers: VTPASS.headers() });
    return data;
  },
};

// ════════════════════════════════════════════════════════════
//  PAYSTACK — Payment Gateway
// ════════════════════════════════════════════════════════════
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || '';

const Paystack = {
  headers() {
    return {
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      'Content-Type': 'application/json',
    };
  },

  // Initialize a payment
  async initiate(email, amount, reference, metadata = {}) {
    const { data } = await axios.post('https://api.paystack.co/transaction/initialize', {
      email,
      amount: Math.round(amount * 100), // kobo
      reference,
      callback_url: `${process.env.APP_URL}/api/paystack/callback`,
      metadata,
    }, { headers: Paystack.headers() });
    return data.data; // { authorization_url, access_code, reference }
  },

  // Verify a payment
  async verify(reference) {
    const { data } = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      { headers: Paystack.headers() }
    );
    return data.data;
  },
};

// ════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ════════════════════════════════════════════════════════════

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !phone || !password)
    return fail(res, 'All fields are required');

  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return fail(res, 'Invalid email address');

  // Nigerian phone check
  if (!/^(0[7-9][01]\d{8})$/.test(phone))
    return fail(res, 'Enter a valid Nigerian phone number (e.g. 09039211704)');

  try {
    const [existing] = await db.query(
      'SELECT id FROM users WHERE email=? OR phone=?', [email, phone]
    );
    if (existing.length) return fail(res, 'Email or phone already registered');

    const hash        = await bcrypt.hash(password, 12);
    const acctNo      = '9' + Math.floor(Math.random() * 900000000 + 100000000);
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyExp   = new Date(Date.now() + 24 * 3600 * 1000); // 24 hours

    await db.query(
      `INSERT INTO users
         (name, email, phone, password, account_number, balance, is_verified, verify_token, verify_expires)
       VALUES (?,?,?,?,?,0,0,?,?)`,
      [name, email, phone, hash, acctNo, verifyToken, verifyExp]
    );

    // Send verification email
    const verifyURL = `${process.env.APP_URL}/api/auth/verify-email?token=${verifyToken}`;
    await sendEmail(email, 'Verify Your Al Maroof Account ✉️', `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#0A0A0A;color:#F5F5F0;padding:40px;border-radius:20px;">
        <div style="text-align:center;margin-bottom:28px;">
          <div style="background:linear-gradient(135deg,#F0C040,#D4A017);width:60px;height:60px;border-radius:16px;display:inline-flex;align-items:center;justify-content:center;font-size:28px;">🛡️</div>
          <h1 style="font-size:24px;margin:16px 0 4px;color:#F5F5F0;">Al Maroof</h1>
          <p style="color:#D4A017;font-size:12px;letter-spacing:2px;text-transform:uppercase;">Your Trusted Digital Services</p>
        </div>
        <h2 style="color:#D4A017;margin-bottom:12px;">Welcome, ${name}! 👋</h2>
        <p style="color:#ccc;line-height:1.7;margin-bottom:24px;">
          Thank you for creating an Al Maroof account. Please verify your email address to activate your account and start buying data, airtime and paying bills instantly.
        </p>
        <div style="text-align:center;margin:28px 0;">
          <a href="${verifyURL}"
             style="display:inline-block;background:linear-gradient(135deg,#F0C040,#D4A017);color:#000;padding:14px 36px;border-radius:12px;text-decoration:none;font-weight:700;font-size:15px;letter-spacing:0.5px;">
            ✅ Verify My Email
          </a>
        </div>
        <p style="color:#666;font-size:12px;text-align:center;">This link expires in 24 hours. If you didn't create this account, ignore this email.</p>
        <hr style="border-color:#222;margin:24px 0;">
        <p style="color:#444;font-size:11px;text-align:center;">© Al Maroof — Your Trusted Digital Services</p>
      </div>`);

    // Also send SMS notification
    sendSMS(phone, `Al Maroof: Welcome ${name}! Check your email (${email}) to verify your account and get started.`);

    success(res, {
      message: 'Account created! Please check your email to verify your account.',
      requires_verification: true
    }, 201);
  } catch (err) {
    console.error(err);
    fail(res, 'Server error', 500);
  }
});

// GET /api/auth/verify-email?token=xxx
app.get('/api/auth/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect(`${process.env.APP_URL}/?verified=invalid`);

  try {
    const [rows] = await db.query(
      'SELECT * FROM users WHERE verify_token=? AND verify_expires > NOW()', [token]
    );
    if (!rows.length) return res.redirect(`${process.env.APP_URL}/?verified=expired`);

    await db.query(
      'UPDATE users SET is_verified=1, verify_token=NULL, verify_expires=NULL WHERE id=?',
      [rows[0].id]
    );

    // Send welcome SMS after verification
    sendSMS(rows[0].phone, `Al Maroof: Your account is verified! You can now fund your wallet and enjoy fast data, airtime & bill payments. Welcome! 🎉`);

    res.redirect(`${process.env.APP_URL}/?verified=success`);
  } catch {
    res.redirect(`${process.env.APP_URL}/?verified=error`);
  }
});

// POST /api/auth/resend-verification
app.post('/api/auth/resend-verification', async (req, res) => {
  const { email } = req.body;
  if (!email) return fail(res, 'Email required');

  try {
    const [rows] = await db.query('SELECT * FROM users WHERE email=?', [email]);
    if (!rows.length) return fail(res, 'Account not found');
    if (rows[0].is_verified) return fail(res, 'Account already verified');

    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyExp   = new Date(Date.now() + 24 * 3600 * 1000);

    await db.query(
      'UPDATE users SET verify_token=?, verify_expires=? WHERE email=?',
      [verifyToken, verifyExp, email]
    );

    const verifyURL = `${process.env.APP_URL}/api/auth/verify-email?token=${verifyToken}`;
    await sendEmail(email, 'Verify Your Al Maroof Account ✉️', `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#0A0A0A;color:#F5F5F0;padding:40px;border-radius:20px;">
        <h2 style="color:#D4A017;">Verification Resent</h2>
        <p>Click the button below to verify your account.</p>
        <div style="text-align:center;margin:28px 0;">
          <a href="${verifyURL}" style="display:inline-block;background:linear-gradient(135deg,#F0C040,#D4A017);color:#000;padding:14px 36px;border-radius:12px;text-decoration:none;font-weight:700;">✅ Verify My Email</a>
        </div>
        <p style="color:#666;font-size:12px;text-align:center;">Expires in 24 hours.</p>
      </div>`);

    success(res, { message: 'Verification email resent' });
  } catch {
    fail(res, 'Server error', 500);
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return fail(res, 'Email and password required');

  try {
    const [rows] = await db.query(
      'SELECT * FROM users WHERE email=? OR phone=?', [email, email]
    );
    if (!rows.length) return fail(res, 'Invalid credentials', 401);

    const user  = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return fail(res, 'Invalid credentials', 401);

    // Block unverified accounts
    if (!user.is_verified) {
      return fail(res, 'Please verify your email before logging in. Check your inbox or request a new verification link.', 403);
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    success(res, {
      token,
      user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role },
    });
  } catch {
    fail(res, 'Server error', 500);
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', authMiddleware, (req, res) => {
  success(res, { message: 'Logged out' });
});

// POST /api/auth/forgot-password
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return fail(res, 'Email required');

  try {
    const [rows] = await db.query('SELECT * FROM users WHERE email=?', [email]);
    if (!rows.length) return success(res, { message: 'If account exists, reset email sent' });

    const resetToken   = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 3600000); // 1 hour

    await db.query(
      'UPDATE users SET reset_token=?, reset_expires=? WHERE email=?',
      [resetToken, resetExpires, email]
    );

    const resetURL = `${process.env.APP_URL}/reset-password?token=${resetToken}`;
    await sendEmail(email, 'Reset Your Al Maroof Password', `
      <div style="font-family:sans-serif;background:#0A0A0A;color:#F5F5F0;padding:32px;border-radius:16px;">
        <h2 style="color:#D4A017;">Password Reset</h2>
        <p>Click the link below to reset your password. It expires in 1 hour.</p>
        <a href="${resetURL}" style="display:inline-block;background:#D4A017;color:#000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:16px;">Reset Password</a>
      </div>`);

    success(res, { message: 'If account exists, reset email sent' });
  } catch {
    fail(res, 'Server error', 500);
  }
});

// POST /api/auth/reset-password
app.post('/api/auth/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return fail(res, 'Token and password required');

  try {
    const [rows] = await db.query(
      'SELECT * FROM users WHERE reset_token=? AND reset_expires > NOW()', [token]
    );
    if (!rows.length) return fail(res, 'Invalid or expired reset token');

    const hash = await bcrypt.hash(password, 12);
    await db.query(
      'UPDATE users SET password=?, reset_token=NULL, reset_expires=NULL WHERE id=?',
      [hash, rows[0].id]
    );
    success(res, { message: 'Password reset successfully' });
  } catch {
    fail(res, 'Server error', 500);
  }
});

// ════════════════════════════════════════════════════════════
//  WALLET ROUTES
// ════════════════════════════════════════════════════════════

// GET /api/wallet/balance
app.get('/api/wallet/balance', authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT balance, account_number FROM users WHERE id=?', [req.user.id]
    );
    success(res, { balance: rows[0].balance, account_number: rows[0].account_number });
  } catch { fail(res, 'Server error', 500); }
});

// GET /api/wallet/transactions
app.get('/api/wallet/transactions', authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    );
    success(res, { transactions: rows });
  } catch { fail(res, 'Server error', 500); }
});

// POST /api/wallet/deposit/initiate  — Paystack
app.post('/api/wallet/deposit/initiate', authMiddleware, async (req, res) => {
  const { amount } = req.body;
  if (!amount || amount < 100) return fail(res, 'Minimum deposit is ₦100');

  try {
    const [users] = await db.query('SELECT email FROM users WHERE id=?', [req.user.id]);
    const reference = genRef('DEP');

    // Save pending deposit
    await db.query(
      'INSERT INTO deposits (user_id, amount, reference, status) VALUES (?,?,?,?)',
      [req.user.id, amount, reference, 'pending']
    );

    const payment = await Paystack.initiate(users[0].email, amount, reference, {
      user_id: req.user.id,
    });

    success(res, {
      authorization_url: payment.authorization_url,
      reference: payment.reference,
    });
  } catch (err) {
    console.error(err.message);
    fail(res, 'Could not initiate payment', 500);
  }
});

// GET /api/paystack/callback  — Paystack redirects here after payment
app.get('/api/paystack/callback', async (req, res) => {
  const { reference } = req.query;
  if (!reference) return res.redirect('/?payment=failed');

  try {
    const payment = await Paystack.verify(reference);
    if (payment.status !== 'success') return res.redirect('/?payment=failed');

    const [deps] = await db.query(
      'SELECT * FROM deposits WHERE reference=? AND status=?', [reference, 'pending']
    );
    if (!deps.length) return res.redirect('/?payment=already_processed');

    const dep  = deps[0];
    const conn = await db.getConnection();
    await conn.beginTransaction();
    try {
      await conn.query('UPDATE deposits SET status=? WHERE reference=?', ['success', reference]);
      await conn.query('UPDATE users SET balance = balance + ? WHERE id=?', [dep.amount, dep.user_id]);
      await conn.query(
        'INSERT INTO transactions (user_id,type,amount,description,reference,status) VALUES (?,?,?,?,?,?)',
        [dep.user_id, 'credit', dep.amount, `Wallet deposit via Paystack`, reference, 'success']
      );
      await conn.commit();

      // Notify user
      const [u] = await db.query('SELECT name,email,phone,balance FROM users WHERE id=?', [dep.user_id]);
      emailTransaction(u[0].email, u[0].name, 'Wallet funded via Paystack', dep.amount, 'credit', u[0].balance);
      sendSMS(u[0].phone, `Al Maroof: ₦${Number(dep.amount).toLocaleString()} added to your wallet. Balance: ₦${Number(u[0].balance).toLocaleString()}`);

      res.redirect('/?payment=success');
    } catch (e) {
      await conn.rollback();
      res.redirect('/?payment=failed');
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error(err.message);
    res.redirect('/?payment=failed');
  }
});

// POST /api/paystack/webhook  — Paystack webhook (backup verification)
app.post('/api/paystack/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const hash = crypto
    .createHmac('sha512', PAYSTACK_SECRET)
    .update(req.body)
    .digest('hex');

  if (hash !== req.headers['x-paystack-signature']) return res.sendStatus(401);

  const event = JSON.parse(req.body);
  if (event.event === 'charge.success') {
    const ref = event.data.reference;
    const [deps] = await db.query(
      'SELECT * FROM deposits WHERE reference=? AND status=?', [ref, 'pending']
    );
    if (deps.length) {
      const dep  = deps[0];
      const conn = await db.getConnection();
      await conn.beginTransaction();
      try {
        await conn.query('UPDATE deposits SET status=? WHERE reference=?', ['success', ref]);
        await conn.query('UPDATE users SET balance = balance + ? WHERE id=?', [dep.amount, dep.user_id]);
        await conn.query(
          'INSERT INTO transactions (user_id,type,amount,description,reference,status) VALUES (?,?,?,?,?,?)',
          [dep.user_id, 'credit', dep.amount, 'Wallet deposit via Paystack', ref, 'success']
        );
        await conn.commit();
      } catch { await conn.rollback(); }
      finally { conn.release(); }
    }
  }
  res.sendStatus(200);
});

// POST /api/wallet/withdraw
app.post('/api/wallet/withdraw', authMiddleware, async (req, res) => {
  const { bank, account_number, amount } = req.body;
  if (!bank || !account_number || !amount) return fail(res, 'All fields required');
  const amt = parseFloat(amount);
  if (amt < 500) return fail(res, 'Minimum withdrawal is ₦500');

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM users WHERE id=? FOR UPDATE', [req.user.id]);
    if (rows[0].balance < amt) { await conn.rollback(); return fail(res, 'Insufficient balance'); }

    const ref = genRef('WIT');
    await conn.query('UPDATE users SET balance = balance - ? WHERE id=?', [amt, req.user.id]);
    await conn.query(
      'INSERT INTO transactions (user_id,type,amount,description,reference,status) VALUES (?,?,?,?,?,?)',
      [req.user.id, 'debit', amt, `Withdrawal to ${bank} - ${account_number}`, ref, 'pending']
    );
    await conn.commit();

    const u = rows[0];
    emailTransaction(u.email, u.name, `Withdrawal to ${bank} (${account_number})`, amt, 'debit', u.balance - amt);
    sendSMS(u.phone, `Al Maroof: ₦${Number(amt).toLocaleString()} withdrawal initiated. Ref: ${ref}`);

    success(res, { message: 'Withdrawal request submitted', reference: ref });
  } catch (err) {
    await conn.rollback();
    fail(res, 'Server error', 500);
  } finally {
    conn.release();
  }
});

// ════════════════════════════════════════════════════════════
//  DATA ROUTES
// ════════════════════════════════════════════════════════════

// GET /api/data/plans?network=mtn
app.get('/api/data/plans', authMiddleware, async (req, res) => {
  const { network } = req.query;
  try {
    const [plans] = await db.query(
      'SELECT * FROM data_plans WHERE network=? AND active=1 ORDER BY price ASC',
      [network || 'mtn']
    );
    success(res, { plans });
  } catch { fail(res, 'Server error', 500); }
});

// POST /api/data/buy
app.post('/api/data/buy', authMiddleware, async (req, res) => {
  const { network, phone, plan_id } = req.body;
  if (!network || !phone || !plan_id) return fail(res, 'All fields required');

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [plans] = await conn.query('SELECT * FROM data_plans WHERE id=?', [plan_id]);
    if (!plans.length) { await conn.rollback(); return fail(res, 'Plan not found'); }

    const plan  = plans[0];
    const [u]   = await conn.query('SELECT * FROM users WHERE id=? FOR UPDATE', [req.user.id]);
    if (u[0].balance < plan.price) { await conn.rollback(); return fail(res, 'Insufficient balance'); }

    const ref = genRef('DAT');

    // Deduct balance first
    await conn.query('UPDATE users SET balance = balance - ? WHERE id=?', [plan.price, req.user.id]);

    // Call VTPass
    let vtStatus = 'success';
    try {
      const vtRes = await VTPASS.buyData(network, phone, plan.vtpass_code, ref);
      if (vtRes.code !== '000') {
        // VTPass failed — refund
        await conn.query('UPDATE users SET balance = balance + ? WHERE id=?', [plan.price, req.user.id]);
        await conn.rollback();
        return fail(res, vtRes.response_description || 'VTU delivery failed');
      }
    } catch (e) {
      console.error('VTPass error:', e.message);
      vtStatus = 'pending'; // Will retry manually
    }

    await conn.query(
      'INSERT INTO transactions (user_id,type,amount,description,reference,status) VALUES (?,?,?,?,?,?)',
      [req.user.id, 'debit', plan.price, `${network.toUpperCase()} ${plan.size} data to ${phone}`, ref, vtStatus]
    );
    await conn.commit();

    const user = u[0];
    const newBal = user.balance - plan.price;
    emailTransaction(user.email, user.name, `${network.toUpperCase()} ${plan.size} data to ${phone}`, plan.price, 'debit', newBal);
    sendSMS(user.phone, `Al Maroof: ${plan.size} ${network.toUpperCase()} data sent to ${phone}. Ref: ${ref}`);

    success(res, { message: `${plan.size} data sent to ${phone}`, reference: ref });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    fail(res, 'Server error', 500);
  } finally {
    conn.release();
  }
});

// ════════════════════════════════════════════════════════════
//  AIRTIME ROUTES
// ════════════════════════════════════════════════════════════

// POST /api/airtime/buy
app.post('/api/airtime/buy', authMiddleware, async (req, res) => {
  const { network, phone, amount } = req.body;
  if (!network || !phone || !amount) return fail(res, 'All fields required');
  const amt = parseFloat(amount);
  if (amt < 50) return fail(res, 'Minimum airtime is ₦50');

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [u] = await conn.query('SELECT * FROM users WHERE id=? FOR UPDATE', [req.user.id]);
    if (u[0].balance < amt) { await conn.rollback(); return fail(res, 'Insufficient balance'); }

    const ref = genRef('AIR');
    await conn.query('UPDATE users SET balance = balance - ? WHERE id=?', [amt, req.user.id]);

    let vtStatus = 'success';
    try {
      const vtRes = await VTPASS.buyAirtime(network, phone, amt, ref);
      if (vtRes.code !== '000') {
        await conn.query('UPDATE users SET balance = balance + ? WHERE id=?', [amt, req.user.id]);
        await conn.rollback();
        return fail(res, vtRes.response_description || 'Airtime delivery failed');
      }
    } catch (e) {
      console.error('VTPass airtime error:', e.message);
      vtStatus = 'pending';
    }

    await conn.query(
      'INSERT INTO transactions (user_id,type,amount,description,reference,status) VALUES (?,?,?,?,?,?)',
      [req.user.id, 'debit', amt, `${network.toUpperCase()} ₦${amt} airtime to ${phone}`, ref, vtStatus]
    );
    await conn.commit();

    const user   = u[0];
    const newBal = user.balance - amt;
    emailTransaction(user.email, user.name, `₦${amt} ${network.toUpperCase()} airtime to ${phone}`, amt, 'debit', newBal);
    sendSMS(user.phone, `Al Maroof: ₦${amt} ${network.toUpperCase()} airtime sent to ${phone}. Ref: ${ref}`);

    success(res, { message: `₦${amt} airtime sent to ${phone}`, reference: ref });
  } catch (err) {
    await conn.rollback();
    fail(res, 'Server error', 500);
  } finally {
    conn.release();
  }
});

// ════════════════════════════════════════════════════════════
//  BILLS ROUTES
// ════════════════════════════════════════════════════════════

// POST /api/bills/verify-meter
app.post('/api/bills/verify-meter', authMiddleware, async (req, res) => {
  const { serviceID, meterNumber, meterType } = req.body;
  if (!serviceID || !meterNumber) return fail(res, 'All fields required');
  try {
    const result = await VTPASS.verifyMeter(serviceID, meterNumber, meterType || 'prepaid');
    if (result.code === '000') {
      success(res, { name: result.content?.Customer_Name, address: result.content?.Address });
    } else {
      fail(res, 'Meter not found or invalid');
    }
  } catch {
    fail(res, 'Verification failed', 500);
  }
});

// POST /api/bills/pay
app.post('/api/bills/pay', authMiddleware, async (req, res) => {
  const { type, serviceID, provider, identifier, variationCode, amount, phone } = req.body;
  if (!type || !serviceID || !identifier || !amount) return fail(res, 'All fields required');
  const amt = parseFloat(amount);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [u] = await conn.query('SELECT * FROM users WHERE id=? FOR UPDATE', [req.user.id]);
    if (u[0].balance < amt) { await conn.rollback(); return fail(res, 'Insufficient balance'); }

    const ref = genRef('BIL');
    await conn.query('UPDATE users SET balance = balance - ? WHERE id=?', [amt, req.user.id]);

    let vtStatus = 'success';
    try {
      let vtRes;
      if (type === 'electricity') {
        vtRes = await VTPASS.payElectricity(serviceID, identifier, variationCode || 'prepaid', amt, phone || u[0].phone, ref);
      } else {
        vtRes = await VTPASS.payCableTV(serviceID, identifier, variationCode, phone || u[0].phone, ref);
      }
      if (vtRes.code !== '000') {
        await conn.query('UPDATE users SET balance = balance + ? WHERE id=?', [amt, req.user.id]);
        await conn.rollback();
        return fail(res, vtRes.response_description || 'Bill payment failed');
      }
    } catch (e) {
      console.error('VTPass bills error:', e.message);
      vtStatus = 'pending';
    }

    const desc = `${provider} ${type} — ${identifier}`;
    await conn.query(
      'INSERT INTO transactions (user_id,type,amount,description,reference,status) VALUES (?,?,?,?,?,?)',
      [req.user.id, 'debit', amt, desc, ref, vtStatus]
    );
    await conn.commit();

    const user   = u[0];
    const newBal = user.balance - amt;
    emailTransaction(user.email, user.name, desc, amt, 'debit', newBal);
    sendSMS(user.phone, `Al Maroof: ${desc} — ₦${Number(amt).toLocaleString()} paid. Ref: ${ref}`);

    success(res, { message: 'Bill payment successful', reference: ref });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    fail(res, 'Server error', 500);
  } finally {
    conn.release();
  }
});

// ════════════════════════════════════════════════════════════
//  ADMIN ROUTES (protected)
// ════════════════════════════════════════════════════════════
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return fail(res, 'Admin access required', 403);
  next();
}

// GET /api/admin/stats
app.get('/api/admin/stats', authMiddleware, adminOnly, async (req, res) => {
  try {
    const [[users]]  = await db.query('SELECT COUNT(*) as total FROM users');
    const [[txns]]   = await db.query('SELECT COUNT(*) as total, SUM(amount) as volume FROM transactions WHERE status="success"');
    const [[revenue]]= await db.query('SELECT SUM(amount) as total FROM transactions WHERE type="debit" AND status="success"');
    success(res, {
      total_users:   users.total,
      total_txns:    txns.total,
      total_volume:  txns.volume || 0,
      total_revenue: revenue.total || 0,
    });
  } catch { fail(res, 'Server error', 500); }
});

// GET /api/admin/users
app.get('/api/admin/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id,name,email,phone,balance,account_number,created_at FROM users ORDER BY created_at DESC'
    );
    success(res, { users: rows });
  } catch { fail(res, 'Server error', 500); }
});

// POST /api/admin/fund-user  — manually credit a user
app.post('/api/admin/fund-user', authMiddleware, adminOnly, async (req, res) => {
  const { user_id, amount, note } = req.body;
  if (!user_id || !amount) return fail(res, 'user_id and amount required');
  try {
    await db.query('UPDATE users SET balance = balance + ? WHERE id=?', [amount, user_id]);
    await db.query(
      'INSERT INTO transactions (user_id,type,amount,description,reference,status) VALUES (?,?,?,?,?,?)',
      [user_id, 'credit', amount, note || 'Admin credit', genRef('ADM'), 'success']
    );
    success(res, { message: 'User funded successfully' });
  } catch { fail(res, 'Server error', 500); }
});

// ════════════════════════════════════════════════════════════
//  SERVE FRONTEND
// ════════════════════════════════════════════════════════════
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ════════════════════════════════════════════════════════════
//  START
// ════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║   Al Maroof API  — Port ${PORT}          ║
  ║   Environment: ${process.env.NODE_ENV || 'development'}            ║
  ╚══════════════════════════════════════╝`);
});
