# MCP Media Generator | مولّد الوسائط MCP

An Arabic-first MCP (Model Context Protocol) server that generates images and videos and merges clips — one tool, five functions, bilingual interface.

خادم MCP عربي بالكامل لتوليد الصور والفيديو ودمج المقاطع — أداة واحدة بخمس وظائف وواجهة ثنائية اللغة.

## Features | المميزات

- **MCP server** on `/mcp` (Streamable HTTP transport) | خادم MCP على المسار `/mcp`
- **5 tools**: `generate_image`, `generate_video`, `merge_videos`, `get_task`, `list_media`
- **Automatic key rotation** across providers on error or quota exhaustion | تبديل تلقائي للمفاتيح عند أي خطأ أو نفاد رصيد
- **Two providers**: kie.ai (primary) + CometAPI (fallback) | مزودان: kie.ai أساسي وCometAPI احتياطي
- **Video merging** via a companion service (`video-merger/`) | دمج الفيديوهات عبر خدمة مصاحبة
- **Arabic RTL admin UI** for keys, tasks, and connection links | واجهة عربية RTL لإدارة المفاتيح والمهام
- **Keys never exposed** in responses or logs | إخفاء المفاتيح في كل الاستجابات والسجلات

## Tech stack | التقنيات

Next.js (App Router) · TypeScript · Tailwind CSS · `@modelcontextprotocol/sdk` · Turso (`@libsql/client`) · Prisma · shadcn/ui

## Quick start | البدء السريع

1. Deploy `video-merger/` first and note its URL.
2. Set environment variables (Vercel → Settings → Environment Variables):

| Variable | Required |
|---|---|
| `TURSO_DATABASE_URL` | ✅ |
| `TURSO_AUTH_TOKEN` | ✅ |
| `MERGER_API_BASE` | ✅ |
| `MCP_ACCESS_TOKEN` | optional |

3. Deploy: `vercel --prod`

## Connect from MCP clients | الربط مع عملاء MCP

**ChatGPT / GPT Agents**: Settings → Connectors → Create → Custom MCP server → `https://your-app.vercel.app/mcp`

**Claude Desktop** (`claude_desktop_config.json`):
```json
{ "mcpServers": { "media-generator": { "type": "http", "url": "https://your-app.vercel.app/mcp" } } }
```

**Cursor / Windsurf / Cline** (`mcp.json`):
```json
{ "mcpServers": { "media-generator": { "url": "https://your-app.vercel.app/mcp" } } }
```

Full tool schemas and deployment notes: [README-mcp.md](README-mcp.md)

## License | الترخيص

MIT — see [LICENSE](LICENSE).
