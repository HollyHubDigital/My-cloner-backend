# Website Cloner Backend

Production-ready backend API for website cloning. Extracts HTML, CSS, and JavaScript from any website.

## Features

- ✅ Puppeteer-based rendering for SPA websites
- ✅ Axios-based fetching for static websites
- ✅ Automatic asset inlining (images, fonts)
- ✅ CSS normalization and extraction
- ✅ JavaScript extraction and minification detection
- ✅ CORS-enabled for frontend deployment

## Prerequisites

- Node.js 18+
- npm or yarn

## Installation

```bash
npm install
```

## Configuration

Create a `.env` file based on `.env.example`:

```env
NODE_ENV=production
PORT=3000
CORS_ORIGIN=https://your-frontend-domain.vercel.app
```

## Development

```bash
npm run dev
```

Server runs on `http://localhost:3000`

## API Endpoints

### POST /api/clone

Clone a website and extract HTML, CSS, JavaScript.

**Request:**
```json
{
  "url": "https://example.com",
  "includeHelpers": false
}
```

**Response:**
```json
{
  "success": true,
  "title": "Example Domain",
  "html": "...",
  "css": "...",
  "js": "...",
  "method": "puppeteer-static"
}
```

### GET /api/health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "message": "Website Cloner API is running"
}
```

## Deployment to Vercel

### 1. Push Backend to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/website-cloner-backend
git push -u origin main
```

### 2. Deploy to Vercel

```bash
npm i -g vercel
vercel
```

**During setup:**
- Select the GitHub repository
- Set `CORS_ORIGIN` to your frontend URL

Or configure in Vercel dashboard:
- Project Settings → Environment Variables
- Add `CORS_ORIGIN=https://your-frontend.vercel.app`

### 3. Get Backend URL

After deployment, you'll get a URL like:
```
https://website-cloner-backend.vercel.app
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment | `production` |
| `PORT` | Server port | `3000` |
| `CORS_ORIGIN` | Frontend URL for CORS | `*` |
| `FRONTEND_URL` | Alternative frontend URL | - |

## Performance Tips

- Vercel Serverless Functions have 10-second timeout
- Large websites (>50MB) may timeout
- Use async operations for heavy processing
- Cache responses on frontend when possible

## Troubleshooting

**CORS errors:**
- Check that `CORS_ORIGIN` environment variable matches frontend URL
- Ensure protocol (http vs https) matches

**Timeout errors:**
- Website too large or complex
- Too many external resources
- SPA requiring excessive JS rendering

**Memory errors:**
- Puppeteer requires more memory
- Increase Vercel function memory in Settings

## Support

For issues or questions, open an issue on GitHub.
