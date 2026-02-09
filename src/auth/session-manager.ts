import fs from "fs";
import path from "path";
import os from "os";

// Session storage location
const SESSION_DIR = path.join(os.homedir(), ".shopify-theme-inspector");
const SESSION_FILE = path.join(SESSION_DIR, "sessions.json");

export interface ShopifySession {
  storeUrl: string;
  storeName: string;
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
  }>;
  createdAt: string;
  expiresAt: string;
}

export interface SessionStore {
  sessions: Record<string, ShopifySession>;
  lastUpdated: string;
}

/**
 * Ensures the session directory exists
 */
function ensureSessionDir(): void {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
}

/**
 * Load all sessions from disk
 */
export function loadSessions(): SessionStore {
  ensureSessionDir();
  
  if (!fs.existsSync(SESSION_FILE)) {
    return {
      sessions: {},
      lastUpdated: new Date().toISOString(),
    };
  }

  try {
    const data = fs.readFileSync(SESSION_FILE, "utf-8");
    return JSON.parse(data) as SessionStore;
  } catch (error) {
    console.error("Failed to load sessions:", error);
    return {
      sessions: {},
      lastUpdated: new Date().toISOString(),
    };
  }
}

/**
 * Save sessions to disk
 */
export function saveSessions(store: SessionStore): void {
  ensureSessionDir();
  store.lastUpdated = new Date().toISOString();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(store, null, 2));
}

/**
 * Get a session for a specific store
 */
export function getSession(storeUrl: string): ShopifySession | null {
  const store = loadSessions();
  const normalizedUrl = normalizeStoreUrl(storeUrl);
  return store.sessions[normalizedUrl] || null;
}

/**
 * Save a session for a specific store
 */
export function saveSession(session: ShopifySession): void {
  const store = loadSessions();
  const normalizedUrl = normalizeStoreUrl(session.storeUrl);
  store.sessions[normalizedUrl] = session;
  saveSessions(store);
}

/**
 * Delete a session for a specific store
 */
export function deleteSession(storeUrl: string): boolean {
  const store = loadSessions();
  const normalizedUrl = normalizeStoreUrl(storeUrl);
  
  if (store.sessions[normalizedUrl]) {
    delete store.sessions[normalizedUrl];
    saveSessions(store);
    return true;
  }
  
  return false;
}

/**
 * Get all authenticated stores
 */
export function getAuthenticatedStores(): string[] {
  const store = loadSessions();
  return Object.keys(store.sessions);
}

/**
 * Check if a session is still valid (not expired)
 */
export function isSessionValid(session: ShopifySession): boolean {
  const expiresAt = new Date(session.expiresAt);
  return expiresAt > new Date();
}

/**
 * Normalize store URL for consistent storage key
 */
export function normalizeStoreUrl(storeUrl: string): string {
  // Remove protocol and trailing slashes
  let normalized = storeUrl
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .toLowerCase();
  
  // Ensure .myshopify.com suffix if not present
  if (!normalized.includes(".myshopify.com") && !normalized.includes(".")) {
    normalized = `${normalized}.myshopify.com`;
  }
  
  return normalized;
}

/**
 * Get the admin URL for a store
 */
export function getAdminUrl(storeUrl: string): string {
  const normalized = normalizeStoreUrl(storeUrl);
  return `https://${normalized}/admin`;
}

/**
 * Get the storefront URL for a store
 */
export function getStorefrontUrl(storeUrl: string): string {
  const normalized = normalizeStoreUrl(storeUrl);
  return `https://${normalized}`;
}
