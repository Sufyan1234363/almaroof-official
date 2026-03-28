-- ╔══════════════════════════════════════════════════════════╗
-- ║         AL MAROOF — Full Production Database             ║
-- ║   mysql -u root -p < almaroof.sql                        ║
-- ╚══════════════════════════════════════════════════════════╝

CREATE DATABASE IF NOT EXISTS almaroof
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE almaroof;

-- ─── USERS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(120)         NOT NULL,
  email          VARCHAR(180) UNIQUE  NOT NULL,
  phone          VARCHAR(20)  UNIQUE  NOT NULL,
  password       VARCHAR(255)         NOT NULL,
  account_number VARCHAR(20)  UNIQUE,
  balance        DECIMAL(15,2)        NOT NULL DEFAULT 0.00,
  role           ENUM('user','admin') NOT NULL DEFAULT 'user',
  is_verified    TINYINT(1)           NOT NULL DEFAULT 0,
  verify_token   VARCHAR(100)         DEFAULT NULL,
  verify_expires DATETIME             DEFAULT NULL,
  reset_token    VARCHAR(100)         DEFAULT NULL,
  reset_expires  DATETIME             DEFAULT NULL,
  created_at     TIMESTAMP            DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP            DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_phone (phone)
) ENGINE=InnoDB;

-- ─── TRANSACTIONS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED NOT NULL,
  type        ENUM('credit','debit')              NOT NULL,
  amount      DECIMAL(15,2)                        NOT NULL,
  description VARCHAR(255),
  reference   VARCHAR(120) UNIQUE,
  status      ENUM('pending','success','failed')   DEFAULT 'pending',
  created_at  TIMESTAMP                            DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_id   (user_id),
  INDEX idx_reference (reference),
  INDEX idx_created   (created_at)
) ENGINE=InnoDB;

-- ─── DEPOSITS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deposits (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED NOT NULL,
  amount      DECIMAL(15,2) NOT NULL,
  reference   VARCHAR(120) UNIQUE NOT NULL,
  status      ENUM('pending','success','failed') DEFAULT 'pending',
  gateway     VARCHAR(50)  DEFAULT 'paystack',
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_reference (reference)
) ENGINE=InnoDB;

-- ─── DATA PLANS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS data_plans (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  network      ENUM('mtn','airtel','glo','9mobile') NOT NULL,
  size         VARCHAR(20)   NOT NULL,
  validity     VARCHAR(30)   NOT NULL,
  price        DECIMAL(10,2) NOT NULL,
  vtpass_code  VARCHAR(50)   NOT NULL COMMENT 'VTPass variation_code',
  active       TINYINT(1)    DEFAULT 1,
  created_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_network (network)
) ENGINE=InnoDB;

-- ─── BILLS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bills (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      INT UNSIGNED NOT NULL,
  type         VARCHAR(50)   NOT NULL,
  provider     VARCHAR(100)  NOT NULL,
  service_id   VARCHAR(100),
  identifier   VARCHAR(100)  NOT NULL,
  amount       DECIMAL(15,2) NOT NULL,
  reference    VARCHAR(120) UNIQUE,
  status       ENUM('pending','success','failed') DEFAULT 'pending',
  created_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ─── SEED: DATA PLANS ────────────────────────────────────────
-- VTPass variation codes — verify at https://vtpass.com/documentation/data/
INSERT INTO data_plans (network, size, validity, price, vtpass_code) VALUES
  -- MTN
  ('mtn',     '500MB',  '1 Day',    150.00,  'mtn-50mb-100'),
  ('mtn',     '1GB',    '1 Day',    300.00,  'mtn-1gb'),
  ('mtn',     '2GB',    '30 Days',  500.00,  'mtn-2gb'),
  ('mtn',     '5GB',    '30 Days',  1500.00, 'mtn-5gb'),
  ('mtn',     '10GB',   '30 Days',  2500.00, 'mtn-10gb'),
  ('mtn',     '20GB',   '30 Days',  4000.00, 'mtn-20gb'),
  -- Airtel
  ('airtel',  '500MB',  '1 Day',    150.00,  'airt-500mb'),
  ('airtel',  '1.5GB',  '30 Days',  500.00,  'airt-1.5gb'),
  ('airtel',  '4GB',    '30 Days',  1500.00, 'airt-4gb'),
  ('airtel',  '10GB',   '30 Days',  2500.00, 'airt-10gb'),
  -- Glo
  ('glo',     '1GB',    '30 Days',  300.00,  'glo-1gb'),
  ('glo',     '5GB',    '30 Days',  1500.00, 'glo-5gb'),
  ('glo',     '10GB',   '30 Days',  2500.00, 'glo-10gb'),
  -- 9mobile
  ('9mobile', '1GB',    '30 Days',  300.00,  '9mobile-1gb'),
  ('9mobile', '3GB',    '30 Days',  1000.00, '9mobile-3gb'),
  ('9mobile', '5GB',    '30 Days',  1500.00, '9mobile-5gb');

-- ─── DEFAULT ADMIN USER ───────────────────────────────────────
-- Password: Admin@123  (CHANGE IMMEDIATELY AFTER FIRST LOGIN)
INSERT INTO users (name, email, phone, password, account_number, balance, role, is_verified)
VALUES (
  'Sufyan Sulayman Dawud',
  'admin@almaroof.com',
  '08000000000',
  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQyCgNXbFbTkOHHKKwZr6WAXC',
  '9000000000',
  0.00,
  'admin',
  1
) ON DUPLICATE KEY UPDATE id=id;
