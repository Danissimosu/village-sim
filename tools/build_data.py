#!/usr/bin/env python3
"""Fetch OSM (Overpass) + Terrarium elevation around Lyubimivka and bake to src/data/village.json + heights.bin"""
import json, math, os, sys, io, urllib.request, urllib.parse, struct, time
import numpy as np
from PIL import Image
LAT0, LON0 = 50.43477, 30.06655   # centre: between S2 cell of the Google ftid (50.4351,30.0621) and OSM place node (50.4344,30.0710)
HALF = 700.0                       # data margin (terrain is 1400 m; "playable" core is 1000 m)
KX = 111320*math.cos(math.radians(LAT0)); KZ = 110574.0
def tolocal(lat, lon): return [round((lon-LON0)*KX, 1), round(-(lat-LAT0)*KZ, 1)]
dlat = HALF/KZ; dlon = HALF/KX
bbox = (LAT0-dlat, LON0-dlon, LAT0+dlat, LON0+dlon)
os.makedirs('data_raw', exist_ok=True)
raw = 'data_raw/osm.json'
if not os.path.exists(raw):
    b = ','.join(f'{v:.5f}' for v in bbox)
    q = f'''[out:json][timeout:120];(
 way["building"]({b}); way["highway"]({b}); way["waterway"]({b});
 way["natural"~"water|wood|scrub|wetland|grassland|heath"]({b}); relation["natural"~"water|wood|wetland"]({b});
 way["landuse"]({b}); relation["landuse"]({b}); way["barrier"~"fence|wall|hedge"]({b});
 way["power"="line"]({b});
 node["natural"="tree"]({b}); way["natural"="tree_row"]({b}); node["amenity"]({b}); node["man_made"]({b}); node["power"="tower"]({b});
 way["amenity"]({b}); way["leisure"]({b});
);out geom;'''
    for url in ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']:
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode({'data': q}).encode(), headers={'User-Agent': 'village-sim/0.1'})
            open(raw, 'wb').write(urllib.request.urlopen(req, timeout=150).read()); break
        except Exception as e: print('overpass fail', url, e)
d = json.load(open(raw))
def geom(e): return [tolocal(p['lat'], p['lon']) for p in e.get('geometry', [])]
out = dict(origin=dict(lat=LAT0, lon=LON0), half=HALF, buildings=[], roads=[], water=[], waterways=[], areas=[], trees=[], fences=[], pois=[], powerLines=[])
ROADW = dict(trunk=9, trunk_link=6, primary=9, secondary=8, tertiary=7, unclassified=5, residential=5.5, service=3.5, track=3.2, path=1.4, footway=1.6, steps=1.4, cycleway=2)
def ring_closed(g): return len(g) >= 4 and g[0] == g[-1]
for e in d['elements']:
    t = e.get('tags', {}); ty = e['type']
    if ty == 'way':
        g = geom(e)
        if len(g) < 2: continue
        if 'building' in t and ring_closed(g):
            lv = t.get('building:levels') or t.get('building:levels:aboveground') or '1'
            try: lv = max(1, int(float(lv)))
            except: lv = 1
            out['buildings'].append(dict(id=e['id'], pts=g[:-1], levels=lv, type=t['building'], name=t.get('name'), amenity=t.get('amenity'), roof=t.get('roof:shape'), mat=t.get('building:material'), colour=t.get('building:colour')))
        elif 'highway' in t:
            hw = t['highway']; w = ROADW.get(hw, 3)
            try: w = float(t['width'])
            except: pass
            out['roads'].append(dict(kind=hw, name=t.get('name'), w=w, surface=t.get('surface'), pts=g))
        elif 'waterway' in t:
            out['waterways'].append(dict(kind=t['waterway'], name=t.get('name'), pts=g))
        elif t.get('natural') in ('water',) or t.get('landuse') == 'reservoir' or t.get('natural') == 'wetland' and ring_closed(g):
            if ring_closed(g): out['water'].append(dict(pts=g[:-1], kind=t.get('natural') or t.get('landuse'), holes=[]))
        elif 'barrier' in t:
            out['fences'].append(dict(kind=t['barrier'], pts=g))
        elif t.get('power') == 'line':
            out['powerLines'].append(g)
        elif t.get('natural') == 'tree_row':
            out['areas'].append(dict(kind='tree_row', pts=g))
        else:
            k = t.get('landuse') or t.get('natural') or t.get('leisure') or t.get('amenity')
            if k and ring_closed(g): out['areas'].append(dict(kind=k, name=t.get('name'), pts=g[:-1], holes=[]))
    elif ty == 'node':
        p = tolocal(e['lat'], e['lon'])
        if t.get('natural') == 'tree': out['trees'].append(p)
        elif t.get('power') == 'tower': pass
        else:
            k = t.get('amenity') or t.get('man_made')
            if k: out['pois'].append(dict(kind=k, name=t.get('name'), x=p[0], z=p[1]))
    elif ty == 'relation':
        outers = [geom(m) for m in e.get('members', []) if m.get('role') == 'outer' and m.get('geometry')]
        inners = [geom(m) for m in e.get('members', []) if m.get('role') == 'inner' and m.get('geometry')]
        k = t.get('landuse') or t.get('natural')
        # stitch outer ways into rings
        def stitch(ways):
            ways = [w for w in ways if len(w) > 1]; rings = []
            while ways:
                cur = ways.pop(0)
                changed = True
                while changed and cur[0] != cur[-1]:
                    changed = False
                    for i, w in enumerate(ways):
                        if w[0] == cur[-1]: cur = cur + w[1:]; ways.pop(i); changed = True; break
                        if w[-1] == cur[-1]: cur = cur + w[::-1][1:]; ways.pop(i); changed = True; break
                        if w[-1] == cur[0]: cur = w + cur[1:]; ways.pop(i); changed = True; break
                        if w[0] == cur[0]: cur = w[::-1] + cur[1:]; ways.pop(i); changed = True; break
                if cur[0] == cur[-1] and len(cur) >= 4: rings.append(cur[:-1])
            return rings
        ors = stitch(outers); ins = stitch(inners)
        for r in ors:
            if t.get('natural') == 'water': out['water'].append(dict(pts=r, kind='water', holes=ins))
            elif k: out['areas'].append(dict(kind=k, name=t.get('name'), pts=r, holes=ins))
# --- elevation: Terrarium tiles z14
Z = 14
def tile(lat, lon):
    n = 2**Z; x = (lon+180)/360*n; y = (1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n; return x, y
x0, y1 = tile(bbox[0]-0.003, bbox[1]-0.004); x1, y0 = tile(bbox[2]+0.003, bbox[3]+0.004)
tx0, tx1, ty0, ty1 = int(math.floor(min(x0, x1))), int(math.floor(max(x0, x1))), int(math.floor(min(y0, y1))), int(math.floor(max(y0, y1)))
img = Image.new('RGB', ((tx1-tx0+1)*256, (ty1-ty0+1)*256))
for tx in range(tx0, tx1+1):
    for ty in range(ty0, ty1+1):
        f = f'data_raw/t_{Z}_{tx}_{ty}.png'
        if not os.path.exists(f):
            r = urllib.request.Request(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{tx}/{ty}.png', headers={'User-Agent': 'village-sim/0.1'})
            open(f, 'wb').write(urllib.request.urlopen(r, timeout=60).read())
        img.paste(Image.open(f).convert('RGB'), ((tx-tx0)*256, (ty-ty0)*256))
a = np.asarray(img).astype(np.float64); elev = a[..., 0]*256 + a[..., 1] + a[..., 2]/256 - 32768
# sample grid for terrain 1400 m, step 5 m
STEP = 5.0; N = int(2*HALF/STEP)+1
from scipy.ndimage import map_coordinates, gaussian_filter
xs = (np.arange(N)*STEP - HALF); zs = xs.copy()
X, Zg = np.meshgrid(xs, zs)
lon = LON0 + X/KX; lat = LAT0 - Zg/KZ
n = 2**Z
px = ((lon+180)/360*n - tx0)*256
py = ((1-np.arcsinh(np.tan(np.radians(lat)))/np.pi)/2*n - ty0)*256
elev = gaussian_filter(elev, 2.0)
H = map_coordinates(elev, [py, px], order=1)
print('elev min/max/mean', H.min(), H.max(), H.mean())
base = float(np.floor(H.min()))
q = np.round((H-base)*20).astype(np.uint16)   # 5 cm units
os.makedirs('public/data', exist_ok=True)
open('public/data/heights.bin', 'wb').write(q.tobytes())
out['heights'] = dict(n=N, step=STEP, base=base, scale=1/20)
json.dump(out, open('public/data/village.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print({k: (len(v) if isinstance(v, list) else v) for k, v in out.items()})
