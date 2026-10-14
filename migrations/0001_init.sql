PRAGMA foreign_keys = ON;

CREATE TABLE stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE store_managers (
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  discord_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (store_id, discord_id)
);

CREATE TABLE employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  home_store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE hour_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,
  hours REAL NOT NULL DEFAULT 0 CHECK (hours >= 0 AND hours <= 168),
  updated_by_discord_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (store_id, employee_id, week_start)
);

CREATE INDEX idx_managers_discord ON store_managers(discord_id);
CREATE INDEX idx_employees_store ON employees(home_store_id, active);
CREATE INDEX idx_hours_store_week ON hour_entries(store_id, week_start);

INSERT INTO stores (name) VALUES ('Hillcrest');
INSERT INTO employees (name, home_store_id) VALUES
  ('Shane', 1),
  ('Casey', 1),
  ('Dennis', 1);
