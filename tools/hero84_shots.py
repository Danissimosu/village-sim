import sys, json, base64, time
from playwright.sync_api import sync_playwright
# usage: hero_shots.py quality W H  name:eyeU,eyeY,eyeV:lookU,lookY,lookV  ...   (plot coordinates; y is height above ground plane)
q = sys.argv[1]; w = int(sys.argv[2]); h = int(sys.argv[3]); specs = sys.argv[4:]
import os
port = os.environ.get('PORT', '5173')
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"])
    pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=1)
    logs = []
    pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'[:500]))
    pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'[:700]))
    pg.goto(f'http://127.0.0.1:{port}/?q={q}&poi=84&t=11&auto=0&manual=1&hud=0&view=fp')
    pg.wait_for_function("window.__village !== undefined", timeout=240000)
    pg.evaluate("window.__village.step(10, 0.05)")
    for sp in specs:
        name, e, l = sp.split(':'); e = [float(x) for x in e.split(',')]; l = [float(x) for x in l.split(',')]
        js = f"""(() => {{ const v = window.__village, H = v.heroPlan84, T = v.THREE;
          const E = H.W({e[0]}, {e[2]}), L = H.W({l[0]}, {l[2]}); const g = (u, vv) => H.plane(u, vv);
          v.camera.position.set(E[0], g({e[0]}, {e[2]}) + {e[1]}, E[1]); v.camera.lookAt(L[0], g({l[0]}, {l[2]}) + {l[1]}, L[1]); v.camera.updateMatrixWorld(); return 1; }})()"""
        pg.evaluate("window.__village.step(2, 0.05)")
        pg.evaluate(js)
        t0 = time.time()
        data = pg.evaluate("(() => { const v = window.__village; v.renderer.render(v.scene, v.camera); return v.renderer.domElement.toDataURL('image/png'); })()")
        open(f'/tmp/h84_{name}.png', 'wb').write(base64.b64decode(data.split(',')[1]))
        print(name, round(time.time() - t0, 1), 's')
    print(json.dumps(pg.evaluate("window.__village.stats()"), default=str)[:400])
    for l in logs[:30]:
        if 'vite' not in l and 'deprecated' not in l: print(l)
    b.close()
