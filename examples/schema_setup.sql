-- ============================================================================
-- schema_setup.sql — Order management example schema
-- Run with: psql postgres://postgres:postgres@localhost:5432/postgres -f schema_setup.sql
-- ============================================================================

-- ── Drop existing tables (reverse dependency order) ───────────────────────────
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders      CASCADE;
DROP TABLE IF EXISTS products    CASCADE;
DROP TABLE IF EXISTS customers   CASCADE;
DROP TABLE IF EXISTS order_status CASCADE;

-- ── Lookup table ──────────────────────────────────────────────────────────────
CREATE TABLE order_status (
  code  TEXT PRIMARY KEY,
  label TEXT NOT NULL
);

INSERT INTO order_status (code, label) VALUES
  ('pending',   'Pending'),
  ('shipped',   'Shipped'),
  ('delivered', 'Delivered'),
  ('cancelled', 'Cancelled');

-- ── Customers ─────────────────────────────────────────────────────────────────
CREATE TABLE customers (
  id    SERIAL PRIMARY KEY,
  name  TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE
);

INSERT INTO customers (name, email) VALUES
  ('Alice Nguyen',  'alice@example.com'),
  ('Bob Okafor',    'bob@example.com'),
  ('Carol Petrov',  'carol@example.com');

-- ── Products ──────────────────────────────────────────────────────────────────
CREATE TABLE products (
  id    SERIAL PRIMARY KEY,
  name  TEXT          NOT NULL,
  price NUMERIC(10,2) NOT NULL CHECK (price > 0)
);

INSERT INTO products (name, price) VALUES
  ('Widget A',  9.99),
  ('Widget B', 24.99),
  ('Gadget X',  4.99);

-- ── Orders ────────────────────────────────────────────────────────────────────
CREATE TABLE orders (
  id          SERIAL    PRIMARY KEY,
  customer_id INTEGER   NOT NULL REFERENCES customers(id),
  status      TEXT      NOT NULL REFERENCES order_status(code),
  placed_at   TIMESTAMP NOT NULL DEFAULT now()
);

INSERT INTO orders (customer_id, status) VALUES
  (1, 'delivered'),
  (1, 'pending'),
  (2, 'shipped'),
  (3, 'cancelled');

-- ── Order items ───────────────────────────────────────────────────────────────
CREATE TABLE order_items (
  id         SERIAL  PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity   INTEGER NOT NULL CHECK (quantity > 0)
);

INSERT INTO order_items (order_id, product_id, quantity) VALUES
  (1, 1, 2),
  (1, 3, 1),
  (2, 2, 1),
  (3, 1, 4),
  (4, 3, 2);
