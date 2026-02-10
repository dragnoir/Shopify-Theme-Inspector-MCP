# Testing with MCP Inspector

A guide to testing the Shopify Theme Inspector MCP server using the MCP Inspector tool.

## Quick Start

```bash
# From the project directory
npm run build
npx -y @modelcontextprotocol/inspector node dist/index.js
```

This will:

1. Start the MCP server
2. Launch MCP Inspector at `http://localhost:6274`
3. Auto-open the browser

## Step-by-Step Testing

### 1. Connect to the Server

1. Open MCP Inspector (browser should open automatically)
2. Verify settings:
   - **Transport Type**: STDIO
   - **Command**: `node`
   - **Arguments**: `dist/index.js`
3. Click **"Connect"**
4. Wait for **"Connected"** status to appear

### 2. List Available Tools

1. Click the **"Tools"** tab
2. Click **"List Tools"** button
3. You should see these tools:
   - `health_check`
   - `login`
   - `logout`
   - `get_auth_status`
   - `profile_page`

### 3. Test Each Tool

#### Test `health_check`

1. Click on `health_check` in the tools list
2. Click **"Run Tool"**
3. Expected result:
   ```json
   {
     "status": "healthy",
     "server": "shopify-theme-inspector",
     "version": "0.1.0",
     "authenticatedStores": 0
   }
   ```

#### Test `get_auth_status`

1. Click on `get_auth_status`
2. Leave `storeUrl` empty to list all stores
3. Click **"Run Tool"**
4. Expected: `"totalStores": 0` (no authentication yet)

#### Test `login`

1. Click on `login`
2. Enter your store URL: `yourstore.myshopify.com`
3. Click **"Run Tool"**
4. A Chrome browser window will open
5. Log into your Shopify admin
6. Wait for success message (5 min timeout)

#### Test `logout`

1. Click on `logout`
2. Enter the store URL you logged into
3. Click **"Run Tool"**
4. Session will be removed

## Troubleshooting

| Issue                 | Solution                                |
| --------------------- | --------------------------------------- |
| Inspector won't start | Run `npm run build` first               |
| Connection failed     | Check if another process uses port 6274 |
| Login times out       | Complete login within 5 minutes         |
| Browser doesn't open  | Puppeteer may need to download Chrome   |

## Alternative: Using Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "shopify-theme-inspector": {
      "command": "node",
      "args": ["C:/path/to/dist/index.js"]
    }
  }
}
```

Then ask Claude: _"Check the health of the Shopify Theme Inspector"_
