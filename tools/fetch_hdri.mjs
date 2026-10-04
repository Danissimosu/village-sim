import fs from 'node:fs';
const id = process.argv[2] || 'kloofendal_48d_partly_cloudy_puresky';
const files = await (await fetch(`https://api.polyhaven.com/files/${id}`, { headers: { 'User-Agent': 'village-sim' } })).json();
const r = await fetch(files.hdri['1k'].hdr.url); fs.mkdirSync('public/hdri', { recursive: true });
fs.writeFileSync('public/hdri/sky_1k.hdr', Buffer.from(await r.arrayBuffer())); console.log('ok');
