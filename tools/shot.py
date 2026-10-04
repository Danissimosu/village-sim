import sys, json, time, base64
from playwright.sync_api import sync_playwright
# usage: shot.py out.png "query" w h steps [js-before-steps] [js-before-snap]
out = sys.argv[1]; q = (sys.argv[2] if len(sys.argv) > 2 else '') + '&manual=1&hud=0'
w = int(sys.argv[3]) if len(sys.argv) > 3 else 900; h = int(sys.argv[4]) if len(sys.argv) > 4 else 500
steps = int(sys.argv[5]) if len(sys.argv) > 5 else 30
js = sys.argv[6] if len(sys.argv) > 6 and sys.argv[6] else None
js2 = sys.argv[7] if len(sys.argv) > 7 and sys.argv[7] else None
url = 'http://127.0.0.1:' + __import__('os').environ.get('PORT','5173') + '/?' + q
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"])
    pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=1)
    logs = []
    pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'[:700]))
    pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'[:900]))
    t0 = time.time()
    pg.goto(url)
    try: pg.wait_for_function("window.__village !== undefined", timeout=240000)
    except Exception as e: print('timeout waiting', e)
    print('loaded in', round(time.time() - t0, 1), 's')
    if js: print('js ->', pg.evaluate(js))
    for i in range(max(1, steps // 10)): pg.evaluate("window.__village.step(10, 0.05)")
    if js2: print('js2 ->', pg.evaluate(js2))
    t1 = time.time()
    data = pg.evaluate("window.__village.snap()")
    print('snap ms', round((time.time() - t1) * 1000))
    open(out, 'wb').write(base64.b64decode(data.split(',')[1]))
    try: print(json.dumps(pg.evaluate("window.__village.stats()"), default=str)[:700])
    except Exception as e: print('stats fail', e)
    for l in logs[:40]:
        if 'vite' not in l and 'deprecated' not in l: print(l)
    b.close()
