import { ShopifySession, getAdminUrl } from "../auth/session-manager.js";

interface Asset {
  key: string;
  value?: string;
  attachment?: string;
  content_type?: string;
  size?: number;
  theme_id?: number;
}

/**
 * Fetch a specific asset from a theme.
 */
export async function fetchThemeAsset(
  session: ShopifySession,
  themeId: number,
  assetKey: string
): Promise<Asset | null> {
  const adminUrl = getAdminUrl(session.storeUrl);
  // Remove 'https://' from adminUrl for header if needed, but fetch handles URL.
  
  // Construct Cookies header
  const cookieHeader = session.cookies
    .map(c => `${c.name}=${c.value}`)
    .join("; ");

  const url = `${adminUrl}/themes/${themeId}/assets.json?asset[key]=${encodeURIComponent(assetKey)}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Cookie": cookieHeader,
        "User-Agent": "Shopify-Theme-Inspector-MCP/0.1.0",
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`Failed to fetch asset: ${response.status} ${response.statusText}`);
    }

    const json = await response.json() as { asset: Asset };
    return json.asset;
  } catch (error) {
    console.error(`Error fetching asset ${assetKey}:`, error);
    throw error;
  }
}

/**
 * List all assets in a theme.
 */
export async function listThemeAssets(
  session: ShopifySession,
  themeId: number
): Promise<Asset[]> {
  const adminUrl = getAdminUrl(session.storeUrl);
  const cookieHeader = session.cookies.map(c => `${c.name}=${c.value}`).join("; ");
  const url = `${adminUrl}/themes/${themeId}/assets.json`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Cookie": cookieHeader,
        "User-Agent": "Shopify-Theme-Inspector-MCP/0.1.0",
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
        throw new Error(`Failed to list assets: ${response.status} ${response.statusText}`);
    }

    const json = await response.json() as { assets: Asset[] };
    return json.assets;
  } catch (error) {
    console.error("Error listing assets:", error);
    throw error;
  }
}

export interface Theme {
  id: number;
  name: string;
  role: "main" | "unpublished" | "demo";
}

/**
 * List themes to find the main theme ID.
 */
export async function getThemes(session: ShopifySession): Promise<Theme[]> {
  const adminUrl = getAdminUrl(session.storeUrl);
  const cookieHeader = session.cookies.map(c => `${c.name}=${c.value}`).join("; ");
  const url = `${adminUrl}/themes.json`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Cookie": cookieHeader,
        "User-Agent": "Shopify-Theme-Inspector-MCP/0.1.0",
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
        throw new Error(`Failed to list themes: ${response.status} ${response.statusText}`);
    }

    const json = await response.json() as { themes: Theme[] };
    return json.themes;
  } catch (error) {
    console.error("Error listing themes:", error);
    throw error;
  }
}
