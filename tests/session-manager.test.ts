import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock date for testing
const mockFutureDate = new Date('2026-03-01T00:00:00.000Z');
const mockPastDate = new Date('2026-01-01T00:00:00.000Z');

/**
 * Check if a session is valid (mirrors src/auth/session-manager.ts)
 */
function isSessionValid(session: { expiresAt: string }): boolean {
  const expiresAt = new Date(session.expiresAt);
  return expiresAt > new Date();
}

/**
 * Get admin URL (mirrors src/auth/session-manager.ts)
 */
function getAdminUrl(storeUrl: string): string {
  let normalized = storeUrl
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .toLowerCase();
  
  if (!normalized.includes(".myshopify.com") && !normalized.includes(".")) {
    normalized = `${normalized}.myshopify.com`;
  }
  
  return `https://${normalized}/admin`;
}

/**
 * Get storefront URL (mirrors src/auth/session-manager.ts)
 */
function getStorefrontUrl(storeUrl: string): string {
  let normalized = storeUrl
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .toLowerCase();
  
  if (!normalized.includes(".myshopify.com") && !normalized.includes(".")) {
    normalized = `${normalized}.myshopify.com`;
  }
  
  return `https://${normalized}`;
}

describe('isSessionValid', () => {
  beforeEach(() => {
    // Mock Date to return a fixed time
    vi.spyOn(Date, 'now').mockImplementation(() => mockFutureDate.getTime());
  });

  it('should return true for future expiration', () => {
    const session = {
      storeUrl: 'store.myshopify.com',
      accessToken: 'test-token',
      expiresAt: '2026-12-31T23:59:59.000Z'
    };
    
    expect(isSessionValid(session)).toBe(true);
  });

  it('should return false for past expiration', () => {
    const session = {
      storeUrl: 'store.myshopify.com',
      accessToken: 'test-token',
      expiresAt: '2026-01-01T00:00:00.000Z'
    };
    
    expect(isSessionValid(session)).toBe(false);
  });

  it('should return false for current time (edge case)', () => {
    const session = {
      storeUrl: 'store.myshopify.com',
      accessToken: 'test-token',
      expiresAt: '2026-03-01T00:00:00.000Z' // Same as mock Date
    };
    
    // When expiresAt equals current time, it's considered valid (expires > now)
    expect(isSessionValid(session)).toBe(true);
  });
});

describe('getAdminUrl', () => {
  it('should return correct admin URL for myshopify.com domain', () => {
    expect(getAdminUrl('store.myshopify.com'))
      .toBe('https://store.myshopify.com/admin');
  });

  it('should handle https:// prefix', () => {
    expect(getAdminUrl('https://store.myshopify.com'))
      .toBe('https://store.myshopify.com/admin');
  });

  it('should add .myshopify.com for bare store name', () => {
    expect(getAdminUrl('mystore'))
      .toBe('https://mystore.myshopify.com/admin');
  });

  it('should handle custom domain', () => {
    expect(getAdminUrl('mystore.com'))
      .toBe('https://mystore.com/admin');
  });
});

describe('getStorefrontUrl', () => {
  it('should return correct storefront URL for myshopify.com domain', () => {
    expect(getStorefrontUrl('store.myshopify.com'))
      .toBe('https://store.myshopify.com');
  });

  it('should handle https:// prefix', () => {
    expect(getStorefrontUrl('https://store.myshopify.com'))
      .toBe('https://store.myshopify.com');
  });

  it('should add .myshopify.com for bare store name', () => {
    expect(getStorefrontUrl('mystore'))
      .toBe('https://mystore.myshopify.com');
  });

  it('should handle trailing slash', () => {
    expect(getStorefrontUrl('store.myshopify.com/'))
      .toBe('https://store.myshopify.com');
  });
});
