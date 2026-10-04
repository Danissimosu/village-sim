import sys, time, json
from playwright.sync_api import sync_playwright
engine = sys.argv[1] if len(sys.argv) > 1 else 'chromium'
with sync_playwright() as p:
    if engine == 'chromium':
        b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    else:
        b = p.webkit.launch()
    ctx = b.new_context(viewport={'width': 393, 'height': 852}, device_scale_factor=1, has_touch=True, is_mobile=True, user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')
    pg = ctx.new_page(); logs = []
    pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'[:500]) if 'vite' not in m.text and 'deprecated' not in m.text else None)
    pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'[:700]))
    pg.goto('http://127.0.0.1:5173/?manual=1&q=low&t=12')
    try: pg.wait_for_function("window.__village !== undefined", timeout=200000)
    except Exception as e: print('wait fail', e)
    print('engine', engine, 'gl2:', pg.evaluate("!!document.createElement('canvas').getContext('webgl2')"))
    pg.evaluate("window.__village && window.__village.step(10, 0.05)")
    pos0 = pg.evaluate("window.__village && [window.__village.player.pos.x, window.__village.player.pos.z, window.__village.player.yaw]")
    # synthetic touch: joystick drag on left half, look drag on right half
    pg.evaluate("""() => { const c = document.querySelector('#app canvas'); const ev = (t, id, x, y) => c.dispatchEvent(new PointerEvent(t, {pointerType:'touch', pointerId:id, clientX:x, clientY:y, bubbles:true, cancelable:true}));
      ev('pointerdown', 1, 90, 700); ev('pointermove', 1, 90, 650); ev('pointerdown', 2, 300, 400); ev('pointermove', 2, 340, 405); window.__t = ev; }""")
    pg.evaluate("window.__village.step(40, 0.05)")
    pos1 = pg.evaluate("[window.__village.player.pos.x, window.__village.player.pos.z, window.__village.player.yaw]")
    print('pos0', pos0, 'pos1', pos1)
    pg.evaluate("window.__t('pointerup', 1, 90, 650); window.__t('pointerup', 2, 340, 405)")
    pg.evaluate("window.__village.step(2, 0.05)")
    pg.screenshot(path=f'/tmp/mobile_{engine}.png', timeout=150000)
    for l in logs[:25]: print(l)
    b.close()
