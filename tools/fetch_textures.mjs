// Downloads CC0 PBR texture sets from Poly Haven (2K jpg), converts to webp at SIZE (default 1024).
// Usage: node tools/fetch_textures.mjs [size]
import fs from 'node:fs'; import path from 'node:path'; import sharp from 'sharp';
const SIZE = parseInt(process.argv[2] || '1024');
const SETS = {
  grass: 'leafy_grass', dirt: 'dirt', gravel: 'gravel_ground_01', asphalt: 'worn_asphalt', field: 'farm_soil',
  plaster: 'white_plaster_rough_01', brick: 'red_brick', wood: 'wood_planks_grey',
  roofSlate: 'roof_slates_02', roofClay: 'clay_roof_tiles', roofRed: 'red_slate_roof_tiles_01',
};
const MAPS = { diff: 'Diffuse', nor: 'nor_gl', arm: 'arm' };
const cache = 'cache', out = 'public/tex';
fs.mkdirSync(cache, { recursive: true }); fs.mkdirSync(out, { recursive: true });
async function dl(url, f) { if (fs.existsSync(f) && fs.statSync(f).size > 1000) return; for (let i = 0; i < 4; i++) { try { const r = await fetch(url, { headers: { 'User-Agent': 'village-sim' } }); if (!r.ok) throw new Error(r.status); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); return; } catch (e) { console.log('retry', url, e.message); } } throw new Error('fail ' + url); }
for (const [name, id] of Object.entries(SETS)) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`, { headers: { 'User-Agent': 'village-sim' } })).json();
  for (const [k, key] of Object.entries(MAPS)) {
    const node = files[key]['2k']; const u = (node.jpg || node.png).url; const src = path.join(cache, `${id}_${k}_2k.jpg`);
    await dl(u, src);
    const dst = path.join(out, `${name}_${k}.webp`);
    let img = sharp(src).resize(SIZE, SIZE);
    // PH grass sets are autumn-toned: shift hue to summer green (baked into the albedo)
    if (name === 'grass' && k === 'diff') img = img.modulate({ hue: 48, saturation: 1.55, brightness: 0.88 });
    await img.webp({ quality: k === 'nor' ? 88 : 82, effort: 5 }).toFile(dst);
  }
  console.log('ok', name, id);
}
