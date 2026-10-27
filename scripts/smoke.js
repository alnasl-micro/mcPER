// Calls the MCP server over stdio. Usage: node scripts/smoke.js <tool> '<json args>' [image-out-dir]
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const client = new Client({ name: 'smoke', version: '0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ['--no-warnings', 'src/index.js'], env: process.env }));
const [tool, args, imageDir] = process.argv.slice(2);
if (!tool) console.log((await client.listTools()).tools.map((t) => t.name).join(', '));
else {
  const r = await client.callTool({ name: tool, arguments: JSON.parse(args ?? '{}') });
  r.content.forEach((c, i) => {
    if (c.type === 'image') {
      const file = path.join(imageDir ?? '.', `${tool}-${i}.png`);
      fs.writeFileSync(file, Buffer.from(c.data, 'base64'));
      console.log(`[image ${c.mimeType} ${Math.round(c.data.length * 0.75 / 1024)}KB -> ${file}]`);
    } else if (r.isError) console.log(c.text);
    else {
      let t = c.text;
      try { t = JSON.stringify(JSON.parse(t), null, 1); } catch {}
      console.log(t.slice(0, Number(process.env.MAX ?? 4000)));
    }
  });
}
await client.close();
