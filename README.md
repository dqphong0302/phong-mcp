# phong-mcp

AI-powered MCP (Model Context Protocol) server with web search, academic research, image generation, and content analysis tools.

## Tools

| Tool | Description |
|------|-------------|
| `perplexity_ask` | Web-grounded Q&A (Sonar Pro) |
| `perplexity_reason` | Step-by-step reasoning with web grounding |
| `perplexity_research` | Deep multi-source research |
| `perplexity_search` | Web search with ranked results |
| `consensus_search_papers` | Search academic papers |
| `consensus_deep_search_papers` | Deep academic research with ranking |
| `image_create_image` | AI image generation |
| `image_process_image` | Resize, crop, convert images |
| `distill` | Summarize and analyze content with AI |

## Quick Start

### Option 1: Docker (stdio mode — for Claude Desktop / Kiro)

```json
{
  "mcpServers": {
    "phong-mcp": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "NROUTER_API_KEY=your-key-here",
        "ghcr.io/phongdang/phong-mcp:latest"
      ]
    }
  }
}
```

### Option 2: Docker (HTTP/SSE mode — for custom clients)

```bash
docker run -d \
  -p 3100:3100 \
  -e TRANSPORT=http \
  -e NROUTER_API_KEY=your-key-here \
  ghcr.io/phongdang/phong-mcp:latest
```

Then connect your MCP client to `http://localhost:3100/sse`

### Option 3: Docker Compose

```bash
# Create .env file
echo "NROUTER_API_KEY=your-key-here" > .env

# Run
docker compose up -d
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NROUTER_API_KEY` | ✅ | — | API key for 9router gateway |
| `NROUTER_BASE_URL` | ❌ | `https://9router.phongdang.io.vn` | 9router endpoint |
| `TRANSPORT` | ❌ | `stdio` | Transport mode: `stdio` or `http` |
| `PORT` | ❌ | `3100` | HTTP server port (http mode only) |

## Getting an API Key

Contact [@phongdang](https://github.com/phongdang) to get a 9router API key.

## Health Check

```bash
curl http://localhost:3100/health
# {"status":"ok","name":"phong-mcp","version":"1.0.0"}
```

## Build from Source

```bash
git clone https://github.com/phongdang/phong-mcp.git
cd phong-mcp
docker build -t phong-mcp .
docker run -i -e NROUTER_API_KEY=xxx phong-mcp
```

## License

MIT
