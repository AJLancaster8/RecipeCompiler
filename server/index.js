// Recipe server for RecipeCompiler.
//
// Data lives in three separate SQLite databases (Node's built-in node:sqlite):
//
//   ./data/accounts.db  — users (id, username, email, password hash, role,
//                         created date) and sign-in sessions
//   ./data/recipes.db   — recipes, ingredients, steps
//   ./data/saved.db     — saved_recipes: which user saved which recipe
//
// They're linked by ids:
//   recipes.author_id         → users.id of the account that created it
//   saved_recipes.user_id     → users.id of the account that saved it
//   saved_recipes.recipe_id   → recipes.id of the saved recipe
// SQLite can't enforce foreign keys across separate database files, so the
// server keeps the links valid itself: these ids are always taken from the
// signed-in session or checked against the other database (never trusted
// from the request body), deleting a recipe also deletes its saves, and
// startup cleans up / warns about any dangling links.
//
// Accounts: sign up with a username, email and password; sign in with
// username or email + password, and get a session token the app sends as
// `Authorization: Bearer <token>`. Passwords are never stored — only a salted
// scrypt hash. Roles: "user" (can edit/delete their own recipes) or "admin"
// (can edit or delete any recipe). The first account created becomes an
// admin; promote others with:
//     npm run make-admin -- <username>
//
// Recipes are private by default. An author can publish one, which puts it
// in everyone's Discover list (GET /recipes?scope=public).
//
// No dependencies (needs Node 22.5+) — run with:  npm run server
// Env vars: PORT (default 3000), DATA_DIR (default ./server/data)

/* global __dirname, Buffer */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { createAdmin } = require("./admin");

let DatabaseSync;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch {
  console.error(
    `The recipe server needs Node 22.5 or newer (for built-in SQLite), but this is Node ${process.version}.\n` +
      "If you're in a WSL terminal, run it from Windows PowerShell instead, or upgrade Node."
  );
  process.exit(1);
}

const scrypt = promisify(crypto.scrypt);

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const ACCOUNTS_DB_PATH = path.join(DATA_DIR, "accounts.db");
const RECIPES_DB_PATH = path.join(DATA_DIR, "recipes.db");
const SAVED_DB_PATH = path.join(DATA_DIR, "saved.db");
const MAX_BODY_BYTES = 1024 * 1024; // 1 MB is far more than any recipe needs
const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,32}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;
const SESSION_DAYS = 30;

// author_id for recipes created before accounts existed. The first account
// created takes these over.
const NO_AUTHOR = 0;

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- accounts database ----------

const accountsDb = new DatabaseSync(ACCOUNTS_DB_PATH);
accountsDb.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at    TEXT NOT NULL
  );

  -- Only a SHA-256 of each session token is stored, so a leaked database
  -- can't be used to sign in as anyone.
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
`);

// ---------- saved-recipes database ----------

const savedDb = new DatabaseSync(SAVED_DB_PATH);
savedDb.exec(`
  PRAGMA journal_mode = WAL;

  -- One row per (user, recipe) the user has saved.
  CREATE TABLE IF NOT EXISTS saved_recipes (
    user_id    INTEGER NOT NULL, -- users.id in accounts.db
    recipe_id  INTEGER NOT NULL, -- recipes.id in recipes.db
    saved_at   TEXT NOT NULL,
    PRIMARY KEY (user_id, recipe_id)
  );
  CREATE INDEX IF NOT EXISTS saved_recipes_recipe ON saved_recipes (recipe_id);
`);

const savedSql = {
  save: savedDb.prepare(
    "INSERT OR IGNORE INTO saved_recipes (user_id, recipe_id, saved_at) VALUES (?, ?, ?)"
  ),
  unsave: savedDb.prepare("DELETE FROM saved_recipes WHERE user_id = ? AND recipe_id = ?"),
  forUser: savedDb.prepare(
    "SELECT recipe_id, saved_at FROM saved_recipes WHERE user_id = ? ORDER BY saved_at DESC"
  ),
  deleteForRecipe: savedDb.prepare("DELETE FROM saved_recipes WHERE recipe_id = ?"),
  distinctRecipes: savedDb.prepare("SELECT DISTINCT recipe_id FROM saved_recipes"),
  distinctUsers: savedDb.prepare("SELECT DISTINCT user_id FROM saved_recipes"),
};

// recipe id → saved_at, for one user
function savedMapFor(userId) {
  return new Map(savedSql.forUser.all(userId).map((r) => [r.recipe_id, r.saved_at]));
}

// ---------- recipes database ----------

const recipesDb = new DatabaseSync(RECIPES_DB_PATH);
recipesDb.exec("PRAGMA journal_mode = WAL;");

// Older versions kept accounts inside recipes.db and recorded the author in
// owner_user_id (plus a legacy owner_id). Split them apart before anything
// else touches the schema.
migrateCombinedDatabase();

recipesDb.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS recipes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    author_id   INTEGER NOT NULL, -- users.id in accounts.db (0 = created before accounts)
    is_public   INTEGER NOT NULL DEFAULT 0, -- 1 = published to Discover
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS recipes_author ON recipes (author_id);

  -- "position" keeps the order the user entered; "client_id" is the id the
  -- app assigned (steps refer to ingredients by it).
  CREATE TABLE IF NOT EXISTS ingredients (
    recipe_id   INTEGER NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    client_id   INTEGER NOT NULL,
    name        TEXT NOT NULL,
    amount      REAL NOT NULL,
    unit        TEXT NOT NULL,
    PRIMARY KEY (recipe_id, position)
  );

  CREATE TABLE IF NOT EXISTS steps (
    recipe_id   INTEGER NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    client_id   INTEGER NOT NULL,
    text        TEXT NOT NULL,
    description TEXT NOT NULL,
    time_value  REAL NOT NULL,
    time_unit   TEXT NOT NULL CHECK (time_unit IN ('s', 'm', 'h')),
    PRIMARY KEY (recipe_id, position)
  );

  -- Which ingredients each step uses (by the ingredient's client_id).
  CREATE TABLE IF NOT EXISTS step_ingredients (
    recipe_id     INTEGER NOT NULL,
    step_position INTEGER NOT NULL,
    position      INTEGER NOT NULL,
    ingredient_id INTEGER NOT NULL,
    PRIMARY KEY (recipe_id, step_position, position),
    FOREIGN KEY (recipe_id, step_position)
      REFERENCES steps (recipe_id, position) ON DELETE CASCADE
  );
`);

// Migration: recipes from before publishing existed are private.
if (!recipesDb.prepare("PRAGMA table_info(recipes)").all().some((c) => c.name === "is_public")) {
  recipesDb.exec("ALTER TABLE recipes ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0;");
}
recipesDb.exec("CREATE INDEX IF NOT EXISTS recipes_public ON recipes (is_public);");

function migrateCombinedDatabase() {
  const tables = new Set(
    recipesDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name)
  );
  const recipeCols = tables.has("recipes")
    ? recipesDb.prepare("PRAGMA table_info(recipes)").all().map((c) => c.name)
    : [];
  const needsRecipeRebuild = tables.has("recipes") && !recipeCols.includes("author_id");
  const hasOldAccounts = tables.has("users") || tables.has("sessions");
  if (!needsRecipeRebuild && !hasOldAccounts) return;

  if (tables.has("users") && recipesDb.prepare("SELECT COUNT(*) AS n FROM users").get().n > 0) {
    console.error(
      "recipes.db contains user accounts from an older version, but accounts now require an email\n" +
        "and live in accounts.db. Move them over manually (adding emails) and drop the users table."
    );
    process.exit(1);
  }

  // Keep a copy of the pre-migration database, just in case.
  recipesDb.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  const backup = `${RECIPES_DB_PATH}.before-split-${Date.now()}.bak`;
  fs.copyFileSync(RECIPES_DB_PATH, backup);

  // Rebuilding a parent table needs foreign keys off (must be set outside a
  // transaction); the children keep pointing at "recipes" by name.
  recipesDb.exec("PRAGMA foreign_keys = OFF;");
  recipesDb.exec("BEGIN");
  try {
    if (needsRecipeRebuild) {
      const authorExpr = recipeCols.includes("owner_user_id")
        ? `COALESCE(owner_user_id, ${NO_AUTHOR})`
        : String(NO_AUTHOR);
      recipesDb.exec(`
        CREATE TABLE recipes_new (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          name        TEXT NOT NULL,
          author_id   INTEGER NOT NULL,
          created_at  TEXT NOT NULL,
          updated_at  TEXT NOT NULL
        );
        INSERT INTO recipes_new (id, name, author_id, created_at, updated_at)
          SELECT id, name, ${authorExpr}, created_at, updated_at FROM recipes;
        DROP TABLE recipes;
        ALTER TABLE recipes_new RENAME TO recipes;
      `);
    }
    recipesDb.exec("DROP TABLE IF EXISTS sessions; DROP TABLE IF EXISTS users;");
    recipesDb.exec("COMMIT");
  } catch (err) {
    recipesDb.exec("ROLLBACK");
    throw err;
  } finally {
    recipesDb.exec("PRAGMA foreign_keys = ON;");
  }
  console.log(`Split accounts out of recipes.db (backup saved as ${path.basename(backup)}).`);
}

// ---------- queries ----------

const accountsSql = {
  countUsers: accountsDb.prepare("SELECT COUNT(*) AS n FROM users"),
  insertUser: accountsDb.prepare(
    "INSERT INTO users (username, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)"
  ),
  userById: accountsDb.prepare("SELECT * FROM users WHERE id = ?"),
  userByName: accountsDb.prepare("SELECT * FROM users WHERE username = ?"),
  userByLogin: accountsDb.prepare("SELECT * FROM users WHERE username = ? OR email = ?"),
  usernameById: accountsDb.prepare("SELECT username FROM users WHERE id = ?"),
  allUsernames: accountsDb.prepare("SELECT id, username FROM users"),
  setRole: accountsDb.prepare("UPDATE users SET role = ? WHERE id = ?"),
  setPassword: accountsDb.prepare("UPDATE users SET password_hash = ? WHERE id = ?"),
  deleteSessionsForUser: accountsDb.prepare("DELETE FROM sessions WHERE user_id = ?"),

  insertSession: accountsDb.prepare(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ),
  sessionUser: accountsDb.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `),
  deleteSession: accountsDb.prepare("DELETE FROM sessions WHERE token_hash = ?"),
  deleteExpiredSessions: accountsDb.prepare("DELETE FROM sessions WHERE expires_at <= ?"),
};

const recipesSql = {
  upsertRecipe: recipesDb.prepare(`
    INSERT INTO recipes (id, name, author_id, is_public, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      name = excluded.name, is_public = excluded.is_public, updated_at = excluded.updated_at
  `),
  deleteIngredients: recipesDb.prepare("DELETE FROM ingredients WHERE recipe_id = ?"),
  deleteSteps: recipesDb.prepare("DELETE FROM steps WHERE recipe_id = ?"),
  insertIngredient: recipesDb.prepare(`
    INSERT INTO ingredients (recipe_id, position, client_id, name, amount, unit)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  insertStep: recipesDb.prepare(`
    INSERT INTO steps (recipe_id, position, client_id, text, description, time_value, time_unit)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  insertStepIngredient: recipesDb.prepare(`
    INSERT INTO step_ingredients (recipe_id, step_position, position, ingredient_id)
    VALUES (?, ?, ?, ?)
  `),
  deleteRecipe: recipesDb.prepare("DELETE FROM recipes WHERE id = ?"),
  recipeById: recipesDb.prepare("SELECT * FROM recipes WHERE id = ?"),
  ingredientsFor: recipesDb.prepare("SELECT * FROM ingredients WHERE recipe_id = ? ORDER BY position"),
  stepsFor: recipesDb.prepare("SELECT * FROM steps WHERE recipe_id = ? ORDER BY position"),
  stepIngredientsFor: recipesDb.prepare(
    "SELECT * FROM step_ingredients WHERE recipe_id = ? ORDER BY step_position, position"
  ),
  allRecipes: recipesDb.prepare("SELECT * FROM recipes ORDER BY id"),
  allIngredients: recipesDb.prepare("SELECT * FROM ingredients ORDER BY recipe_id, position"),
  allSteps: recipesDb.prepare("SELECT * FROM steps ORDER BY recipe_id, position"),
  allStepIngredients: recipesDb.prepare(
    "SELECT * FROM step_ingredients ORDER BY recipe_id, step_position, position"
  ),
  distinctAuthors: recipesDb.prepare("SELECT DISTINCT author_id FROM recipes"),
  claimAuthorless: recipesDb.prepare(`UPDATE recipes SET author_id = ? WHERE author_id = ${NO_AUTHOR}`),
};

function transaction(db, fn) {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// ---------- recipe storage ----------

// Insert or update a recipe and replace its ingredients and steps.
// Pass id: null to create a new recipe. Returns the recipe's id.
function saveRecipe(recipe) {
  return transaction(recipesDb, () => {
    const result = recipesSql.upsertRecipe.run(
      recipe.id ?? null,
      recipe.name,
      recipe.authorId,
      recipe.isPublic ? 1 : 0,
      recipe.createdAt,
      recipe.updatedAt
    );
    const id = recipe.id ?? Number(result.lastInsertRowid);

    recipesSql.deleteIngredients.run(id);
    recipesSql.deleteSteps.run(id); // cascades to step_ingredients
    recipe.ingredients.forEach((ing, pos) => {
      recipesSql.insertIngredient.run(id, pos, ing.id, ing.name, ing.amount, ing.unit);
    });
    recipe.steps.forEach((step, pos) => {
      recipesSql.insertStep.run(
        id, pos, step.id, step.text, step.description, step.timeValue, step.timeUnit
      );
      step.ingredientIds.forEach((ingId, i) => {
        recipesSql.insertStepIngredient.run(id, pos, i, ingId);
      });
    });
    return id;
  });
}

// Turn database rows back into the recipe shape the app uses.
// authorName comes from accounts.db (looked up by author_id).
function assemble(row, ingredientRows, stepRows, linkRows, authorName) {
  return {
    id: row.id,
    name: row.name,
    ingredients: ingredientRows.map((i) => ({
      id: i.client_id,
      name: i.name,
      amount: i.amount,
      unit: i.unit,
    })),
    steps: stepRows.map((s) => ({
      id: s.client_id,
      text: s.text,
      description: s.description,
      timeValue: s.time_value,
      timeUnit: s.time_unit,
      ingredientIds: linkRows
        .filter((l) => l.step_position === s.position)
        .map((l) => l.ingredient_id),
    })),
    authorId: row.author_id,
    authorName: authorName ?? null,
    isPublic: row.is_public === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readStoredRecipe(id) {
  const row = recipesSql.recipeById.get(id);
  if (!row) return null;
  const author = accountsSql.usernameById.get(row.author_id);
  return assemble(
    row,
    recipesSql.ingredientsFor.all(id),
    recipesSql.stepsFor.all(id),
    recipesSql.stepIngredientsFor.all(id),
    author?.username
  );
}

// Five queries total (four recipe tables + one username lookup), however
// many recipes there are. `include(row)` picks which recipes to return.
function listStoredRecipes(include) {
  const group = (rows) => {
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.recipe_id)) map.set(r.recipe_id, []);
      map.get(r.recipe_id).push(r);
    }
    return map;
  };
  const ingredients = group(recipesSql.allIngredients.all());
  const steps = group(recipesSql.allSteps.all());
  const links = group(recipesSql.allStepIngredients.all());
  const usernames = new Map(accountsSql.allUsernames.all().map((u) => [u.id, u.username]));
  return recipesSql.allRecipes.all().filter(include).map((row) =>
    assemble(
      row,
      ingredients.get(row.id) || [],
      steps.get(row.id) || [],
      links.get(row.id) || [],
      usernames.get(row.author_id)
    )
  );
}

function deleteStoredRecipe(id) {
  recipesSql.deleteRecipe.run(id); // cascades to ingredients, steps, step_ingredients
  savedSql.deleteForRecipe.run(id); // and nobody has it saved any more
}

// saved.db can't enforce its links either: drop saves of recipes that no
// longer exist (e.g. deleted while the server was on an older version), and
// warn about saves by accounts that don't exist.
function checkSavedLinks() {
  let removed = 0;
  for (const { recipe_id } of savedSql.distinctRecipes.all()) {
    if (!recipesSql.recipeById.get(recipe_id)) {
      removed += Number(savedSql.deleteForRecipe.run(recipe_id).changes);
    }
  }
  if (removed > 0) console.log(`Removed ${removed} saved-recipe entr(ies) for deleted recipes.`);
  const missingUsers = savedSql.distinctUsers
    .all()
    .map((r) => r.user_id)
    .filter((id) => !accountsSql.userById.get(id));
  if (missingUsers.length > 0) {
    console.warn(
      `Warning: saved.db has saves by user_id(s) ${missingUsers.join(", ")}, ` +
        "which don't exist in accounts.db."
    );
  }
}

// The databases can't enforce the author link themselves, so check it.
function checkAuthorLinks() {
  const missing = recipesSql.distinctAuthors
    .all()
    .map((r) => r.author_id)
    .filter((id) => id !== NO_AUTHOR && !accountsSql.userById.get(id));
  if (missing.length > 0) {
    console.warn(
      `Warning: recipes.db has recipes by author_id(s) ${missing.join(", ")}, ` +
        "which don't exist in accounts.db."
    );
  }
}

// ---------- accounts ----------

// Stored as "scrypt$N$r$p$<salt>$<hash>" so the cost can be raised later
// without breaking existing passwords.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), hash.toString("base64")].join("$");
}

async function verifyPassword(password, stored) {
  const [scheme, N, r, p, saltB64, hashB64] = String(stored).split("$");
  if (scheme !== "scrypt") return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return crypto.timingSafeEqual(actual, expected);
}

// Used when the account doesn't exist, so a failed sign-in takes the same
// time either way and doesn't reveal which usernames/emails are registered.
let dummyHashPromise = null;
const dummyHash = () => (dummyHashPromise ??= hashPassword(crypto.randomUUID()));

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

function createSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  accountsSql.insertSession.run(sha256(token), userId, now.toISOString(), expires.toISOString());
  return token;
}

function getBearerToken(req) {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const match = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(header);
  return match ? match[1] : null;
}

function userFromRequest(req) {
  const token = getBearerToken(req);
  if (!token) return null;
  return accountsSql.sessionUser.get(sha256(token), new Date().toISOString()) || null;
}

// Only ever sent to the account's own owner (sign-in responses and /auth/me).
function publicUser(u) {
  return { id: u.id, username: u.username, email: u.email, role: u.role, createdAt: u.created_at };
}

// Simple brute-force guard: after 10 failed sign-ins for an account from
// one address, refuse further attempts for 15 minutes.
const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MS = 15 * 60 * 1000;
const failedLogins = new Map(); // key -> { count, firstAt }

function loginKey(req, login) {
  return `${req.socket.remoteAddress}|${login.toLowerCase()}`;
}
function isLockedOut(key) {
  const entry = failedLogins.get(key);
  if (!entry) return false;
  if (Date.now() - entry.firstAt > LOCKOUT_MS) {
    failedLogins.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILED_LOGINS;
}
function recordFailedLogin(key) {
  const entry = failedLogins.get(key);
  if (!entry || Date.now() - entry.firstAt > LOCKOUT_MS) {
    failedLogins.set(key, { count: 1, firstAt: Date.now() });
  } else {
    entry.count++;
  }
}

const asString = (v) => (typeof v === "string" ? v : "");

function validateRegistration(body) {
  if (!body || typeof body !== "object") return { error: "Body must be a JSON object" };
  const username = asString(body.username).trim();
  const email = asString(body.email).trim().toLowerCase();
  const password = asString(body.password);
  if (!username || !email || !password) {
    return { error: "Username, email and password are all required" };
  }
  if (!USERNAME_PATTERN.test(username)) {
    return { error: "Username must be 3–32 characters: letters, numbers, dots, dashes or underscores" };
  }
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    return { error: "Enter a valid email address" };
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }
  return { username, email, password };
}

// ---------- recipe validation ----------

const isFiniteNumber = (n) => typeof n === "number" && Number.isFinite(n);
const str = (v, max = 2000) => (typeof v === "string" ? v.slice(0, max) : "");

// Accept only the fields the app actually uses, so clients can't stash
// arbitrary data (or set the author) through the recipe body.
function sanitizeRecipeBody(body) {
  if (!body || typeof body !== "object") return { error: "Body must be a JSON object" };
  const name = str(body.name, 200).trim();
  if (!name) return { error: "Recipe name is required" };
  if (!Array.isArray(body.ingredients)) return { error: "ingredients must be an array" };
  if (!Array.isArray(body.steps)) return { error: "steps must be an array" };

  const ingredients = body.ingredients.slice(0, 500).map((i) => ({
    id: isFiniteNumber(i?.id) ? i.id : 0,
    name: str(i?.name, 200),
    amount: isFiniteNumber(i?.amount) ? i.amount : 0,
    unit: str(i?.unit, 50),
  }));

  const steps = body.steps.slice(0, 500).map((s) => ({
    id: isFiniteNumber(s?.id) ? s.id : 0,
    text: str(s?.text, 1000),
    description: str(s?.description, 5000),
    timeValue: isFiniteNumber(s?.timeValue) ? s.timeValue : 0,
    timeUnit: ["s", "m", "h"].includes(s?.timeUnit) ? s.timeUnit : "m",
    ingredientIds: Array.isArray(s?.ingredientIds)
      ? s.ingredientIds.filter(isFiniteNumber)
      : [],
  }));

  // Recipes are private unless the author explicitly publishes them.
  const isPublic = body.isPublic === true;

  return { value: { name, ingredients, steps, isPublic } };
}

const canEdit = (recipe, user) => recipe.authorId === user.id || user.role === "admin";
// Published recipes are visible to everyone signed in; private ones only to
// their author (and admins).
const canView = (recipe, user) => recipe.isPublic || canEdit(recipe, user);

// `saved` is the caller's savedMapFor(user.id); pass it in when converting a
// whole list so it's only looked up once.
function toPublic(recipe, user, saved = savedMapFor(user.id)) {
  return {
    ...recipe,
    isMine: recipe.authorId === user.id,
    canEdit: canEdit(recipe, user),
    isSaved: saved.has(recipe.id),
  };
}

// ---------- http helpers ----------

function send(res, status, data) {
  const body = data === undefined ? "" : JSON.stringify(data);
  if (status >= 400) res.errorMessage = data?.error; // for the admin error list
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(Object.assign(new Error("Invalid JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

const NOT_SIGNED_IN = { error: "You need to sign in" };

// Admin dashboard at /admin (see server/admin.js).
const admin = createAdmin({
  databases: {
    accounts: { db: accountsDb, path: ACCOUNTS_DB_PATH },
    recipes: { db: recipesDb, path: RECIPES_DB_PATH },
    saved: { db: savedDb, path: SAVED_DB_PATH },
  },
  dataDir: DATA_DIR,
  userFromRequest,
  send,
});

// ---------- routes ----------

async function handleAuth(req, res, action) {
  // POST /auth/register  { username, email, password }
  if (action === "register" && req.method === "POST") {
    const reg = validateRegistration(await readJsonBody(req));
    if (reg.error) return send(res, 400, { error: reg.error });
    const passwordHash = await hashPassword(reg.password);
    let user;
    try {
      user = transaction(accountsDb, () => {
        // The first account on a fresh server is the admin.
        const isFirst = accountsSql.countUsers.get().n === 0;
        const result = accountsSql.insertUser.run(
          reg.username,
          reg.email,
          passwordHash,
          isFirst ? "admin" : "user",
          new Date().toISOString()
        );
        return accountsSql.userById.get(Number(result.lastInsertRowid));
      });
    } catch (err) {
      const msg = String(err.message);
      if (msg.includes("UNIQUE") && msg.includes("users.email")) {
        return send(res, 409, { error: "An account with that email already exists" });
      }
      if (msg.includes("UNIQUE")) {
        return send(res, 409, { error: "That username is already taken" });
      }
      throw err;
    }
    if (user.role === "admin" && accountsSql.countUsers.get().n === 1) {
      recipesSql.claimAuthorless.run(user.id); // first account adopts pre-account recipes
    }
    return send(res, 201, { token: createSession(user.id), user: publicUser(user) });
  }

  // POST /auth/login  { login: username or email, password }
  if (action === "login" && req.method === "POST") {
    const body = await readJsonBody(req);
    // "username" accepted too, for older app builds.
    const login = asString(body?.login ?? body?.username).trim();
    const password = asString(body?.password);
    if (!login || !password) {
      return send(res, 400, { error: "Enter your username or email, and your password" });
    }
    const key = loginKey(req, login);
    if (isLockedOut(key)) {
      return send(res, 429, { error: "Too many failed sign-ins. Try again in 15 minutes." });
    }
    const user = accountsSql.userByLogin.get(login, login.toLowerCase());
    const ok = user
      ? await verifyPassword(password, user.password_hash)
      : (await verifyPassword(password, await dummyHash()), false);
    if (!ok) {
      recordFailedLogin(key);
      return send(res, 401, { error: "Incorrect username/email or password" });
    }
    failedLogins.delete(key);
    return send(res, 200, { token: createSession(user.id), user: publicUser(user) });
  }

  // GET /auth/me
  if (action === "me" && req.method === "GET") {
    const user = userFromRequest(req);
    if (!user) return send(res, 401, NOT_SIGNED_IN);
    return send(res, 200, { user: publicUser(user) });
  }

  // POST /auth/logout
  if (action === "logout" && req.method === "POST") {
    const token = getBearerToken(req);
    if (token) accountsSql.deleteSession.run(sha256(token));
    return send(res, 204);
  }

  return send(res, 404, { error: "Not found" });
}

async function handleRecipes(req, res, parts, url, user) {
  // /recipes
  if (parts.length === 1) {
    if (req.method === "GET") {
      // GET /recipes?scope=public  → every published recipe (Discover)
      // GET /recipes               → the signed-in user's own recipes
      const scope = url.searchParams.get("scope");
      if (scope !== null && scope !== "public" && scope !== "mine") {
        return send(res, 400, { error: "scope must be 'public' or 'mine'" });
      }
      const include =
        scope === "public" ? (row) => row.is_public === 1 : (row) => row.author_id === user.id;
      const saved = savedMapFor(user.id);
      return send(res, 200, listStoredRecipes(include).map((r) => toPublic(r, user, saved)));
    }
    if (req.method === "POST") {
      const { value, error } = sanitizeRecipeBody(await readJsonBody(req));
      if (error) return send(res, 400, { error });
      const now = new Date().toISOString();
      const id = saveRecipe({
        id: null,
        ...value,
        authorId: user.id, // always the signed-in account, never from the body
        createdAt: now,
        updatedAt: now,
      });
      return send(res, 201, toPublic(readStoredRecipe(id), user));
    }
    return send(res, 405, { error: "Method not allowed" });
  }

  // /recipes/:id
  if (parts.length !== 2 || !/^\d+$/.test(parts[1])) return send(res, 404, { error: "Not found" });
  const id = Number(parts[1]);
  const existing = readStoredRecipe(id);
  // Private recipes look the same as missing ones to people who can't see them.
  if (!existing || !canView(existing, user)) return send(res, 404, { error: "Recipe not found" });

  if (req.method === "GET") return send(res, 200, toPublic(existing, user));

  if (req.method === "PUT" || req.method === "DELETE") {
    if (!canEdit(existing, user)) {
      return send(res, 403, { error: "Only the recipe's author or an admin can change it" });
    }
    if (req.method === "DELETE") {
      deleteStoredRecipe(id);
      return send(res, 204);
    }
    const { value, error } = sanitizeRecipeBody(await readJsonBody(req));
    if (error) return send(res, 400, { error });
    saveRecipe({
      ...value,
      id: existing.id,
      authorId: existing.authorId, // an admin's edit doesn't change the author
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    });
    return send(res, 200, toPublic(readStoredRecipe(id), user));
  }

  return send(res, 405, { error: "Method not allowed" });
}

const DISCOVER_PAGE_SIZE = 10;
const MAX_SEARCH_LENGTH = 100;

// True if every word of the search appears in the recipe's name, its
// author's username, or one of its ingredient names (case-insensitive).
function matchesSearch(recipe, terms) {
  const haystacks = [
    recipe.name,
    recipe.authorName ?? "",
    ...recipe.ingredients.map((i) => i.name),
  ].map((s) => s.toLowerCase());
  return terms.every((term) => haystacks.some((h) => h.includes(term)));
}

// GET /discover?q=<search>&page=<n> → one page of published recipes,
// newest first:  { recipes, page, pageSize, total, pageCount, query }
function handleDiscover(req, res, url, user) {
  if (req.method !== "GET") return send(res, 405, { error: "Method not allowed" });
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, MAX_SEARCH_LENGTH);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const requestedPage = Number.parseInt(url.searchParams.get("page") ?? "1", 10);

  const matches = listStoredRecipes((row) => row.is_public === 1)
    .filter((r) => terms.length === 0 || matchesSearch(r, terms))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);

  const total = matches.length;
  const pageCount = Math.max(1, Math.ceil(total / DISCOVER_PAGE_SIZE));
  // Out-of-range pages (e.g. after a search shrinks the results) snap to the
  // nearest real page instead of coming back empty.
  const page = Math.min(Math.max(Number.isFinite(requestedPage) ? requestedPage : 1, 1), pageCount);
  const saved = savedMapFor(user.id);
  const recipes = matches
    .slice((page - 1) * DISCOVER_PAGE_SIZE, page * DISCOVER_PAGE_SIZE)
    .map((r) => toPublic(r, user, saved));

  return send(res, 200, { recipes, page, pageSize: DISCOVER_PAGE_SIZE, total, pageCount, query });
}

async function handleSaved(req, res, parts, user) {
  // GET /saved → the recipes this user has saved, most recently saved first
  if (parts.length === 1 && req.method === "GET") {
    const saved = savedMapFor(user.id);
    const recipes = listStoredRecipes((row) => saved.has(row.id))
      .map((r) => readableOrNull(r, user))
      .filter(Boolean)
      .map((r) => ({ ...toPublic(r, user, saved), savedAt: saved.get(r.id) }))
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    return send(res, 200, recipes);
  }

  // PUT /saved/:recipeId → save it    DELETE /saved/:recipeId → unsave it
  if (parts.length === 2 && /^\d+$/.test(parts[1])) {
    const recipeId = Number(parts[1]);
    if (req.method === "PUT") {
      const recipe = readStoredRecipe(recipeId);
      // You can only save recipes you're allowed to see.
      if (!recipe || !canView(recipe, user)) return send(res, 404, { error: "Recipe not found" });
      savedSql.save.run(user.id, recipeId, new Date().toISOString());
      return send(res, 200, toPublic(recipe, user));
    }
    if (req.method === "DELETE") {
      savedSql.unsave.run(user.id, recipeId);
      return send(res, 204);
    }
    return send(res, 405, { error: "Method not allowed" });
  }

  return send(res, 404, { error: "Not found" });
}

// A saved recipe that's since been made private by its author drops out of
// other people's saved lists (it comes back if it's published again).
const readableOrNull = (recipe, user) => (canView(recipe, user) ? recipe : null);

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean); // e.g. ["recipes", "3"]

  if (req.method === "OPTIONS") return send(res, 204);

  if (parts.length === 1 && parts[0] === "health" && req.method === "GET") {
    return send(res, 200, { ok: true });
  }

  if (parts[0] === "auth" && parts.length === 2) return handleAuth(req, res, parts[1]);

  if (parts[0] === "admin") return admin.handleAdmin(req, res, parts, url);

  if (parts[0] === "recipes") {
    const user = userFromRequest(req);
    if (!user) return send(res, 401, NOT_SIGNED_IN);
    return handleRecipes(req, res, parts, url, user);
  }

  if (parts[0] === "discover" && parts.length === 1) {
    const user = userFromRequest(req);
    if (!user) return send(res, 401, NOT_SIGNED_IN);
    return handleDiscover(req, res, url, user);
  }

  if (parts[0] === "saved") {
    const user = userFromRequest(req);
    if (!user) return send(res, 401, NOT_SIGNED_IN);
    return handleSaved(req, res, parts, user);
  }

  return send(res, 404, { error: "Not found" });
}

// ---------- startup ----------

// `npm run make-admin -- <username>` promotes an existing account.
if (process.argv[2] === "make-admin") {
  const username = process.argv[3];
  const user = username && accountsSql.userByName.get(username);
  if (!user) {
    console.error(username ? `No account named "${username}".` : "Usage: npm run make-admin -- <username>");
    process.exit(1);
  }
  accountsSql.setRole.run("admin", user.id);
  console.log(`${user.username} is now an admin.`);
  process.exit(0);
}

// `npm run seed-examples` creates an "example_chef" account with three
// published example recipes. Running it again does nothing.
const runCommand = (task, what) =>
  task().then(
    () => process.exit(0),
    (err) => {
      console.error(`${what} failed:`, err);
      process.exit(1);
    }
  );

if (process.argv[2] === "seed-examples") {
  runCommand(seedExamples, "Seeding");
} else if (process.argv[2] === "reset-password") {
  runCommand(() => resetPassword(process.argv[3]), "Password reset");
} else {
  startServer();
}

// Lines from piped (non-terminal) input, shared by every ask(). (Kept on the
// function itself: commands run before a module-level `let` would be set.)
function nextPipedLine() {
  if (!nextPipedLine.read) {
    const rl = require("node:readline").createInterface({ input: process.stdin });
    const queue = [];
    const waiting = [];
    rl.on("line", (line) => (waiting.length ? waiting.shift()(line) : queue.push(line)));
    rl.on("close", () => waiting.splice(0).forEach((resolve) => resolve("")));
    nextPipedLine.read = () =>
      queue.length ? Promise.resolve(queue.shift()) : new Promise((r) => waiting.push(r));
  }
  return nextPipedLine.read();
}

// Asks a question on the terminal. With `hidden`, what's typed shows as *.
function ask(question, { hidden = false } = {}) {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) {
    stdout.write(question);
    return nextPipedLine().then((line) => {
      stdout.write("\n");
      return line;
    });
  }
  return new Promise((resolve) => {
    let value = "";
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          return resolve(value);
        }
        if (ch === "\u0003") {
          // Ctrl+C
          stdin.setRawMode(false);
          stdout.write("\nCancelled.\n");
          process.exit(1);
        }
        if (ch === "\u007f" || ch === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            stdout.write("\b \b");
          }
        } else if (ch >= " ") {
          value += ch;
          stdout.write(hidden ? "*" : ch);
        }
      }
    };
    stdin.on("data", onData);
  });
}

// `npm run reset-password` asks for a username (or email) and a new
// password, then signs that account out everywhere. Leave the password
// blank to get a random one. The username can also be given up front:
//     npm run reset-password -- <username>
async function resetPassword(loginArg) {
  const login = (loginArg || (await ask("Username or email: "))).trim();
  const user = login && accountsSql.userByLogin.get(login, login.toLowerCase());
  if (!user) {
    console.error(login ? `No account named "${login}".` : "No username entered.");
    process.exit(1);
  }

  let password = null;
  for (let attempt = 1; attempt <= 3 && password === null; attempt++) {
    const first = await ask(`New password for ${user.username} (blank = random): `, { hidden: true });
    if (first === "") {
      password = crypto.randomBytes(9).toString("base64url");
      console.log(`Generated password: ${password}`);
      break;
    }
    if (first.length < MIN_PASSWORD_LENGTH || first.length > MAX_PASSWORD_LENGTH) {
      console.log(`Password must be ${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} characters. Try again.`);
      continue;
    }
    const again = await ask("Type it again: ", { hidden: true });
    if (again !== first) {
      console.log("Those didn't match. Try again.");
      continue;
    }
    password = first;
  }
  if (password === null) {
    console.error("Password not changed.");
    process.exit(1);
  }

  accountsSql.setPassword.run(await hashPassword(password), user.id);
  const { changes } = accountsSql.deleteSessionsForUser.run(user.id);
  console.log(`Password for ${user.username} changed. Signed out of ${changes} session(s).`);
}

async function seedExamples() {
  const USERNAME = "example_chef";
  if (accountsSql.userByName.get(USERNAME)) {
    console.log(`The ${USERNAME} account already exists — nothing to do.`);
    return;
  }
  const password = crypto.randomBytes(9).toString("base64url");
  const now = new Date().toISOString();
  const result = accountsSql.insertUser.run(
    USERNAME,
    "example_chef@example.com",
    await hashPassword(password),
    accountsSql.countUsers.get().n === 0 ? "admin" : "user",
    now
  );
  const authorId = Number(result.lastInsertRowid);

  const ing = (id, name, amount, unit) => ({ id, name, amount, unit });
  const step = (id, text, description, timeValue, timeUnit, ingredientIds) => ({
    id, text, description, timeValue, timeUnit, ingredientIds,
  });
  const examples = [
    {
      name: "Classic Tomato Basil Pasta",
      ingredients: [
        ing(1, "Spaghetti", 400, "g"),
        ing(2, "Tomatoes", 500, "g"),
        ing(3, "Garlic cloves", 3, "whole"),
        ing(4, "Olive oil", 3, "tbsp"),
        ing(5, "Fresh basil", 1, "cup"),
        ing(6, "Salt", 1, "tsp"),
      ],
      steps: [
        step(7, "Boil the water", "Bring a large pot of salted water to a rolling boil.", 10, "m", [6]),
        step(8, "Cook the spaghetti", "Cook until al dente, then drain, saving a cup of pasta water.", 10, "m", [1]),
        step(9, "Sauté the garlic", "Warm the olive oil and gently cook the sliced garlic until fragrant.", 2, "m", [3, 4]),
        step(10, "Simmer the tomatoes", "Add chopped tomatoes and simmer until saucy.", 15, "m", [2]),
        step(11, "Toss and serve", "Toss the pasta with the sauce and torn basil, loosening with pasta water.", 2, "m", [1, 5]),
      ],
    },
    {
      name: "Garlic Butter Chicken",
      ingredients: [
        ing(1, "Chicken breasts", 2, "whole"),
        ing(2, "Butter", 3, "tbsp"),
        ing(3, "Garlic cloves", 4, "whole"),
        ing(4, "Lemon juice", 2, "tbsp"),
        ing(5, "Parsley", 0.25, "cup"),
        ing(6, "Salt", 1, "tsp"),
      ],
      steps: [
        step(7, "Season the chicken", "Pat the chicken dry and season both sides with salt.", 2, "m", [1, 6]),
        step(8, "Sear the chicken", "Cook in a hot pan with a little butter until golden and cooked through.", 12, "m", [1, 2]),
        step(9, "Make the garlic butter", "Lower the heat, add the rest of the butter and the minced garlic.", 2, "m", [2, 3]),
        step(10, "Finish with lemon", "Stir in the lemon juice and spoon the sauce over the chicken.", 1, "m", [4]),
        step(11, "Rest and garnish", "Rest the chicken, then scatter with chopped parsley.", 5, "m", [5]),
      ],
    },
    {
      name: "Fluffy Pancakes",
      ingredients: [
        ing(1, "Flour", 200, "g"),
        ing(2, "Milk", 300, "ml"),
        ing(3, "Eggs", 2, "whole"),
        ing(4, "Sugar", 2, "tbsp"),
        ing(5, "Baking powder", 2, "tsp"),
        ing(6, "Butter", 2, "tbsp"),
      ],
      steps: [
        step(7, "Mix the dry ingredients", "Whisk the flour, sugar and baking powder together.", 2, "m", [1, 4, 5]),
        step(8, "Add the wet ingredients", "Whisk in the milk, eggs and melted butter until just combined.", 3, "m", [2, 3, 6]),
        step(9, "Rest the batter", "Let the batter sit so the pancakes turn out fluffy.", 10, "m", []),
        step(10, "Cook the pancakes", "Cook ladlefuls on a buttered pan until bubbles form, then flip.", 15, "m", [6]),
      ],
    },
  ];
  for (const recipe of examples) {
    saveRecipe({ id: null, ...recipe, authorId, isPublic: true, createdAt: now, updatedAt: now });
  }
  console.log(`Created account "${USERNAME}" (user id ${authorId}) with ${examples.length} published recipes.`);
  console.log(`Sign in as ${USERNAME} with password: ${password}`);
}

function startServer() {
  accountsSql.deleteExpiredSessions.run(new Date().toISOString());
  checkAuthorLinks();
  checkSavedLinks();

  admin.startSampling();

  http
    .createServer((req, res) => {
      const start = process.hrtime.bigint();
      res.on("finish", () => admin.recordRequest(req, res, start));
      handle(req, res).catch((err) => {
        console.error(`${req.method} ${req.url} failed:`, err);
        if (!err.status) res.errorStack = err.stack;
        if (!res.headersSent) {
          send(res, err.status || 500, { error: err.status ? err.message : "Server error" });
        }
        // The admin list shows the real cause, not just "Server error".
        if (!err.status) res.errorMessage = String(err.message || err);
      });
    })
    .listen(PORT, () => {
      console.log(`Recipe server listening on http://0.0.0.0:${PORT}`);
      console.log(`Admin dashboard: http://localhost:${PORT}/admin`);
      console.log(`Accounts: ${ACCOUNTS_DB_PATH}`);
      console.log(`Recipes:  ${RECIPES_DB_PATH}`);
      console.log(`Saved:    ${SAVED_DB_PATH}`);
    });
}
