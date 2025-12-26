# ChatGPT Setup Guide

This guide walks you through setting up the PostgreSQL MCP server with Auth0 OAuth for ChatGPT integration.

---

## Prerequisites

- A publicly accessible HTTPS endpoint for your MCP server
- Node.js 20+ installed

---

## Overview

| Step | Description |
|------|-------------|
| **Step 1** | Deploy the MCP Server |
| **Step 2** | Set Up HTTPS |
| **Step 3** | Set Up Auth0 |
| **Step 4** | Connect ChatGPT |

---

## OAuth Flow

![OAuth Flow](../assets/oauth-flow.png)

---

## Step 1: Deploy the MCP Server

Before configuring Auth0, deploy your MCP server. You'll need the public URL for Auth0 configuration.

### Option A: Run Directly

```bash
# Database connection (required)
export DATABASE_URI="postgresql://user:pass@localhost:5432/mydb"

# Auth0 configuration (set these after completing Auth0 setup)
export MCP_AUTH_MODE="oauth"
export AUTH0_DOMAIN="your-tenant.us.auth0.com"
export AUTH0_AUDIENCE="https://your-subdomain.example.com"

# Run the HTTP server
npx @zlash65/postgresql-ssh-mcp-http
```

### Option B: Docker

```bash
docker build --target runtime-http -t postgresql-mcp-http .

docker run -p 3000:3000 \
  -e DATABASE_URI="postgresql://user:pass@host:5432/mydb" \
  -e MCP_AUTH_MODE="oauth" \
  -e AUTH0_DOMAIN="your-tenant.us.auth0.com" \
  -e AUTH0_AUDIENCE="https://your-subdomain.example.com" \
  postgresql-mcp-http
```

---

## Step 2: Set Up HTTPS

ChatGPT requires HTTPS. Use a reverse proxy like nginx with Let's Encrypt:

```nginx
server {
    listen 443 ssl;
    server_name your-subdomain.example.com;

    ssl_certificate /etc/letsencrypt/live/your-subdomain.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-subdomain.example.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

> **Tip:** Use [Certbot](https://certbot.eff.org/) to obtain free Let's Encrypt certificates.

---

## Step 3: Set Up Auth0

### Step 3.1: Create Tenant & Note Domain

1. Go to [Auth0](https://auth0.com) and sign up for an account
2. During signup, set your **Tenant Domain** to something that suits your MCP server (e.g., `postgresql-ssh-mcp`)
3. Select your **Region** (e.g., US)
4. Click **Create Account**

![Auth0 Tenant Domain Signup](../assets/auth0-tenant-domain-signup.png)

> **Note:** Your `AUTH0_DOMAIN` will be `{tenant-domain}.{region}.auth0.com` (e.g., `postgresql-ssh-mcp.us.auth0.com`)
>
> Multiple tenants require a paid plan. One tenant is needed per MCP server.

---

### Step 3.2: Create API

1. In the Auth0 Dashboard, go to **Applications > APIs** in the left sidebar
2. Click the **+ Create API** button

![Auth0 Create API](../assets/auth0-create-api.png)

3. In the Create API dialog:
   - **Name:** `PostgreSQL SSH MCP` (or your preferred name)
   - **Identifier:** Your MCP server URL (e.g., `https://postgresql-ssh-mcp.zlash.xyz/mcp`)
   - **JSON Web Token (JWT) Profile:** `Auth0` (default)
   - **JSON Web Token (JWT) Signing Algorithm:** `RS256` (default)
4. Click **Create**

![Auth0 Create API Dialog](../assets/auth0-create-api-dialog.png)

> **Important:** The Identifier becomes your `AUTH0_AUDIENCE` environment variable.

---

### Step 3.3: Set Default Audience

This step is required for the OAuth flow to work correctly with ChatGPT.

1. Go to **Settings** in the left sidebar (this opens Tenant Settings)

![Auth0 Tenant Settings](../assets/auth0-tenant-settings.png)

2. In the **General** tab, scroll down to **API Authorization Settings**
3. Set **Default Audience** to the API Identifier you created (e.g., `https://postgresql-ssh-mcp.zlash.xyz/mcp`)
4. Click **Save**

![Auth0 API Authorization Settings](../assets/auth0-api-authorization-settings.png)

> **Why?** ChatGPT uses RFC 8707 `resource` parameter, but Auth0 requires the Default Audience to be set for proper token audience handling.
>
> See [Auth0 Community Discussion](https://community.auth0.com/t/rfc-8707-implementation-audience-vs-resource/188990/3) for details.

---

### Step 3.4: Enable Dynamic Client Registration (DCR)

DCR allows ChatGPT to automatically register itself as an OAuth client.

1. In **Settings** (Tenant Settings), switch to the **Advanced** tab
2. Scroll down to find **Dynamic Client Registration (DCR)**
3. Enable the toggle
4. Save changes

![Auth0 DCR Settings](../assets/auth0-settings-dcr.png)

> **Warning:** Auth0 shows a notice that "anyone will be able to create applications in your tenant without a token." This is required for ChatGPT integration.

---

### Step 3.5: Configure Database Connection

For DCR to work properly, you need to promote the database connection to domain level.

1. Go to **Authentication > Database** in the left sidebar
2. Click on **Username-Password-Authentication** (the default database)

![Auth0 Authentication Database](../assets/auth0-authentication-database.png)

3. In the **Settings** tab:

![Auth0 Database Settings](../assets/auth0-database-settings.png)

4. Scroll down and enable both toggles:
   - **Disable Sign Ups** - Prevents unauthorized users from creating accounts
   - **Promote Connection to Domain Level** - Required for DCR to use this connection

![Auth0 Database Promote Connection](../assets/auth0-database-promote-connection.png)

5. Save changes

---

### Step 3.6: Create a User

Since sign-ups are disabled, create a user manually for authentication.

1. Go to **User Management > Users** in the left sidebar
2. Click **+ Create User**
3. Fill in the details:
   - **Connection:** `Username-Password-Authentication`
   - **Email:** Your email address
   - **Password:** A secure password
4. Click **Create**

![Auth0 Create User](../assets/auth0-create-user.png)

> **Remember these credentials!** You'll need them when ChatGPT prompts you to authenticate.

---

## Step 4: Connect ChatGPT

Now connect your MCP server to ChatGPT.

### 4.1: Enable Developer Mode

1. Go to [ChatGPT](https://chatgpt.com)
2. Click on your profile icon > **Settings**
3. Go to **Apps** (or **Advanced Settings**)
4. Enable **Developer Mode**

### 4.2: Create MCP App

1. Once Developer Mode is enabled, click **Create App**
2. Fill in the details:
   - **Name:** `PostgreSQL SSH MCP` (or your preferred name)
   - **MCP Server URL:** Your MCP server URL (e.g., `https://postgresql-ssh-mcp.zlash.xyz`)
   - **Authentication:** `OAuth`
   - Leave OAuth Client ID and Secret empty (DCR handles this)
3. Check the acknowledgment box
4. Click **Create**

![ChatGPT Create App](../assets/chatgpt-create-app.png)

### 4.3: Authenticate with Auth0

After clicking Create, ChatGPT redirects you to Auth0 for authentication.

1. Enter the credentials for the user you created in Step 3.6
2. Click **Continue**

![Auth0 Login](../assets/chatgpt-auth0-auth-credentials.png)

3. Auth0 will ask you to authorize ChatGPT to access your account
4. Click **Accept** to grant access

![Auth0 Authorize App](../assets/chatgpt-auth0-auth-authenticate.png)

You'll be redirected back to ChatGPT. The MCP server is now connected!

### 4.4: Use the MCP Server

1. Open a new chat in ChatGPT
2. Click the **+** icon in the message input
3. Click **More**
4. Select your MCP server from the list

![ChatGPT Select MCP](../assets/chatgpt-select-mcp.png)

5. Start using the PostgreSQL tools!

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `MCP_AUTH_MODE` | Yes | Set to `oauth` |
| `AUTH0_DOMAIN` | Yes | Your Auth0 tenant domain (e.g., `postgresql-ssh-mcp.us.auth0.com`) |
| `AUTH0_AUDIENCE` | Yes | The API Identifier from Step 3.2 |
| `MCP_RESOURCE_DOCUMENTATION` | No | URL to your API documentation |
| `MCP_ALLOWED_ORIGINS` | Recommended | `https://chatgpt.com,https://chat.openai.com` |
| `MCP_ALLOWED_HOSTS` | Recommended | Your public hostname |

---

## Troubleshooting

### ChatGPT: "Unable to connect"

1. Verify your MCP server is running and accessible:
   ```bash
   curl https://your-subdomain.example.com/health
   ```
2. Check OAuth metadata is exposed:
   ```bash
   curl https://your-subdomain.example.com/.well-known/oauth-protected-resource
   ```

### Auth0: "Login failed"

1. Verify the user exists in **User Management > Users**
2. Check the user's connection is `Username-Password-Authentication`
3. Try resetting the password

### 401 Unauthorized on MCP requests

1. Verify `AUTH0_AUDIENCE` matches your API Identifier exactly
2. Check the Default Audience is set in Tenant Settings
3. Verify the token hasn't expired

### DCR not working

1. Ensure DCR is enabled in **Settings > Advanced**
2. Verify **Promote Connection to Domain Level** is enabled for the database
3. Check your Auth0 plan supports DCR

---

## Testing the Integration

After connecting, try these prompts in ChatGPT:

- "List all schemas in the database"
- "Show me the tables in the public schema"
- "Describe the users table"
- "What's the database version?"
- "Show me the largest tables by size"

ChatGPT will use the MCP tools to query your PostgreSQL database securely.
