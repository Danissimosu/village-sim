# helper snippets
HOUSE = lambda idx, dist=11, hgt=0: f"""(() => {{ const v = window.__village; const hs = v.layout.buildings.filter(b=>b.kind==='house'&&!b.osm); const b = hs[{idx}];
 const vx = -Math.sin(b.rot), vz = Math.cos(b.rot); const x = b.x + vx*{dist}, z = b.z + vz*{dist};
 v.player.teleport(x, z, Math.atan2(vx, vz)); v.player.pitch = -0.05; return [b.x|0,b.z|0,b.w|0,b.d|0, JSON.stringify(b.style).slice(0,80)]; }})()"""
