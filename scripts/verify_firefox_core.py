"""Core real-data browser tasks using official Firefox + W3C WebDriver.

No user profile, patched browser, fake UA or performance acceptance claim.
"""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
import platform
import re
from pathlib import Path
import socket
import subprocess
import time
from urllib.parse import urlsplit, parse_qs, quote
import urllib.request
from webdriver_client import Driver, ELEMENT

ROOT = Path(__file__).resolve().parents[1]
ENTER, DOWN = '\ue007', '\ue015'

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', required=True)
    parser.add_argument('--base', default='http://127.0.0.1:8766')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--snapshot', help='Default: immutable snapshot advertised by the local preview')
    args = parser.parse_args()
    if urlsplit(args.base).hostname != '127.0.0.1':
        raise ValueError('Only the local preview is accepted')
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(args.base + '/dataset.json', timeout=10) as response:
        snapshot = args.snapshot or json.load(response)['snapshot_id']
    assert re.fullmatch(r'[A-Za-z0-9_-]{1,80}', snapshot)
    binary = ROOT / 'data/manifests/local/firefox-runtime' / args.version / 'core/firefox.exe'
    gecko = ROOT / 'data/manifests/local/firefox-runtime/geckodriver.exe'
    assert binary.is_file() and gecko.is_file(), 'Verified standalone runtime must be extracted first'
    index = (ROOT / 'apps/web/client/dist/index.html').read_bytes()
    asset = re.search(rb'src="(/assets/index-[^"]+\.js)"', index)[1].decode()
    build = {'asset': asset, 'index_sha256': hashlib.sha256(index).hexdigest(),
             'asset_sha256': hashlib.sha256((ROOT / ('apps/web/client/dist' + asset)).read_bytes()).hexdigest()}
    output = args.output.resolve(); output.mkdir(parents=True, exist_ok=True)
    profiles = ROOT / 'data/manifests/local/firefox-runtime/profiles'; profiles.mkdir(exist_ok=True)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
    log = (output / 'geckodriver.log').open('w', encoding='utf-8')
    process = subprocess.Popen([str(gecko), '--host', '127.0.0.1', '--port', str(port), '--profile-root', str(profiles), '--log', 'error'],
                               stdout=log, stderr=subprocess.STDOUT, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    driver = Driver('http://127.0.0.1:' + str(port)); checks = []; capabilities = None
    try:
        for _ in range(100):
            if process.poll() is not None:
                raise RuntimeError('Driver process exited: ' + str(process.returncode))
            try:
                driver.request('GET', '/status'); break
            except OSError:
                time.sleep(0.1)
        capabilities = driver.start(binary)
        assert capabilities['browserName'] == 'firefox' and capabilities['browserVersion'] == args.version
        assert Path(capabilities['moz:profile']).resolve().is_relative_to(profiles.resolve())
        driver.command('POST', '/window/rect', {'width': 1440, 'height': 1000})
        # Same-origin inert error document primes the preference before app code
        # starts, so the browser never needs public raster tiles for this check.
        driver.navigate(args.base + '/webdriver-preference-setup')
        driver.script("localStorage.setItem('railway-atlas:basemap:v1','false');")
        driver.navigate(args.base + '/?snapshot=' + snapshot)
        driver.wait("performance.getEntriesByName('atlas:first-usable').length>0", timeout=35)
        first = driver.script("return performance.getEntriesByName('atlas:first-usable')[0].detail;")
        assert first['rendered_tracks'] > 0 and first['style_layers']['missing'] == []
        assert len(first['style_layers']['expected']) == 41 and first['map_font'] == 'ready' and first['name_labels']['status'] == 'ready'
        assert driver.script("return [...document.fonts].some(f=>f.family==='Railway Atlas CJK'&&f.status==='loaded');")
        driver.script("document.querySelector('.maplibregl-canvas').dispatchEvent(new CustomEvent('atlas:profile-filters',{detail:{active:true}}));")
        driver.click('[data-preset="overview"]')
        driver.wait("performance.getEntriesByName('atlas:filters-settled').length>0")
        driver.script("document.querySelector('.maplibregl-canvas').dispatchEvent(new CustomEvent('atlas:profile-filters',{detail:{active:false}}));")
        (output / 'map.png').write_bytes(base64.b64decode(driver.command('GET', '/screenshot')))
        checks.append('real railway render, complete style, ready name source and actual loaded self-hosted FontFace')
        camera = driver.script('return location.hash;')
        driver.keys('.maplibregl-canvas', '\ue014')
        driver.wait('location.hash!==arguments[0]', camera)
        camera = driver.script('return location.hash;')
        driver.keys('.maplibregl-canvas', '+')
        driver.wait('location.hash!==arguments[0]', camera)
        checks.append('native WebDriver canvas keyboard pan and zoom update the camera URL')
        driver.fill('#search', '沈阳北站'); driver.wait("document.querySelectorAll('#results button').length>0")
        target = driver.script("return [...document.querySelectorAll('#results button')].find(b=>b.textContent.includes('铁路')&&b.textContent.includes('站点')).id;")
        for _ in range(22):
            driver.keys('#search', DOWN)
            if driver.script("return document.querySelector('#search').getAttribute('aria-activedescendant');") == target:
                break
        else:
            raise AssertionError('Keyboard cannot reach the real railway station')
        driver.keys('#search', ENTER)
        driver.wait("document.querySelector('.feature-title')?.textContent.includes('沈阳北')")
        assert parse_qs(urlsplit(driver.script('return location.href;')).query)['feature'] == ['node/676578837']
        checks.append('W3C WebDriver search keys, active descendant, Enter selection and original railway station identity')
        driver.click('#share-open'); driver.wait("document.querySelector('#share-dialog')?.open")
        assert driver.script("return document.activeElement.id;") == 'share-link'
        shared = driver.script("return document.querySelector('#share-link').value;")
        assert parse_qs(urlsplit(shared).query)['feature'] == ['node/676578837']
        driver.click('#share-close'); driver.navigate(shared)
        driver.wait("document.querySelector('.feature-title')?.textContent.includes('沈阳北')")
        checks.append('native share dialog focus and fresh navigation restores the same typed station identity')
        driver.click('#detail-close'); driver.click('[data-preset="highspeed"]')
        driver.wait("document.querySelector('[data-preset=highspeed]')?.getAttribute('aria-pressed')==='true'")
        assert driver.script("return new URL(location.href).searchParams.get('classes');") == 'high_speed'
        driver.click('[data-preset="overview"]')
        checks.append('native preset clicks update independent filter state and restore overview')
        driver.keys('#list-open', ENTER)
        driver.wait("document.querySelector('#accessible-explorer')?.open&&document.querySelector('.object-list button')")
        driver.wait("document.activeElement?.id==='list-title'")
        driver.fill('#list-query', '沈阳北站')
        driver.click('#list-kind option[value="stations"]')
        driver.wait("[...document.querySelectorAll('.object-list button')].some(b=>b.textContent.includes('node/676578837'))")
        element = driver.script("return [...document.querySelectorAll('.object-list button')].find(b=>b.textContent.includes('node/676578837'));")[ELEMENT]
        driver.command('POST', '/element/' + element + '/value', {'text': ENTER})
        driver.wait("document.querySelector('.list-record h3')?.textContent.includes('沈阳北')")
        driver.wait("document.activeElement?.getAttribute('aria-label')==='列表记录详情'")
        geometry = driver.script("const h=document.querySelector('.list-record h3').getBoundingClientRect(),d=document.querySelector('#accessible-explorer').getBoundingClientRect();return {heading:{top:h.top,bottom:h.bottom},dialog:{top:d.top,bottom:d.bottom},viewport:innerHeight};")
        assert geometry['heading']['top'] >= geometry['dialog']['top'] and geometry['heading']['bottom'] <= min(geometry['dialog']['bottom'], geometry['viewport']), 'selected record heading must be visible: ' + str(geometry)
        checks.append('on-demand list native dialog, keyboard station detail and explicit focus handoff')
        (output / 'list-detail.png').write_bytes(base64.b64decode(driver.command('GET', '/screenshot')))
        driver.click('#accessible-explorer [aria-label="关闭要素列表"]')
        recovery = []
        def view(extra='', camera='10.50/41.80000/123.42000', label='恢复默认图层'):
            navigation_marker = str(time.monotonic_ns())
            driver.script('window.__firefoxPreviousDocument=arguments[0];', navigation_marker)
            driver.navigate(args.base + '/?snapshot=' + snapshot + '&q=' + quote('沈阳') + extra + '#map=' + camera)
            driver.wait("window.__firefoxPreviousDocument!==arguments[0]&&document.readyState==='complete'&&document.querySelector('#map-notice button')?.textContent===arguments[1]&&!document.querySelector('#map-notice').hidden", navigation_marker,label)
        def state():
            return driver.script("const u=new URL(location.href);return {camera:location.hash,q:u.searchParams.get('q'),snapshot:u.searchParams.get('snapshot'),types:u.searchParams.get('types'),classes:u.searchParams.get('classes'),states:u.searchParams.get('states'),sidings:u.searchParams.get('sidings'),lines:u.searchParams.get('lines'),basemap:localStorage.getItem('railway-atlas:basemap:v1')};")
        def activate(label):
            assert driver.script("return document.querySelector('#map-notice button').textContent;") == label
            driver.keys('#map-notice button', ENTER)
            driver.wait("document.activeElement?.classList.contains('maplibregl-canvas')")
        def preserved(a,b,fields):
            for field in fields:
                assert a[field] == b[field], (field,a,b)
        stable = ['camera','q','snapshot','basemap']
        view('&types=light_rail'); previous = state(); activate('恢复默认图层')
        driver.wait("!document.querySelector('#map-notice button')")
        preserved(previous,state(),stable)
        assert 'rail' in state()['types'].split(',')
        recovery.append('real empty view keyboard recovery preserves camera/query/snapshot/basemap and focuses canvas')
        driver.click('#undo'); driver.wait("document.querySelector('#map-notice button')")
        assert state()['types'] == 'light_rail'
        preserved(previous,state(),stable)
        recovery.append('recovery undo restores the previous empty selection')
        for lines in ['', 'shenyang-metro/404']:
            view('&types=subway&states=construction&sidings=0&lines=' + lines,label='恢复全部线路'); previous = state(); activate('恢复全部线路')
            driver.wait("!new URL(location.href).searchParams.has('lines')")
            preserved(previous,state(),stable+['types','classes','states','sidings'])
            recovery.append(('missing' if lines else 'empty') + ' line recovery removes only the line restriction')
        view('&types=rail&states=mapped&sidings=0', '10.50/39.90000/116.40000',label='回到试验区'); previous = state(); activate('回到试验区')
        driver.wait("location.hash==='#map=10.50/41.80000/123.42000'")
        preserved(previous,state(),['q','snapshot','basemap','types','classes','states','sidings','lines'])
        recovery.append('out-of-coverage recovery returns home without resetting filters or query')
        driver.command('POST','/window/rect',{'width':650,'height':500})
        view('&types=light_rail')
        compact = driver.script("const selectors=['#map-notice','#map-notice button','#share-open','#home','#panel-toggle','.maplibregl-ctrl-zoom-in','.maplibregl-ctrl-zoom-out','.maplibregl-ctrl-attrib a'];return {viewport:[innerWidth,innerHeight],overflow:document.documentElement.scrollWidth>innerWidth,targets:selectors.map(selector=>{const e=document.querySelector(selector),r=e.getBoundingClientRect(),ix=Math.min(8,r.width/4),iy=Math.min(8,r.height/4),hits=[];for(const x of [r.x+ix,r.x+r.width/2,r.right-ix])for(const y of [r.y+iy,r.y+r.height/2,r.bottom-iy]){const h=document.elementFromPoint(x,y);hits.push(h===e||e.contains(h));}return {selector,rect:{x:r.x,y:r.y,width:r.width,height:r.height},hits};})};")
        assert not compact['overflow']
        for item in compact['targets']:
            r=item['rect']; w,h=compact['viewport']
            assert r['width']>0 and r['height']>0 and r['x']>=0 and r['y']>=0 and r['x']+r['width']<=w+1 and r['y']+r['height']<=h+1 and all(item['hits']), item
        recovery.append('short compact native window has no sampled hint/toolbar/zoom/attribution occlusion or horizontal overflow')
        (output / 'recovery-compact.png').write_bytes(base64.b64decode(driver.command('GET','/screenshot')))
        activate('恢复默认图层')
        recovery.append('short compact recovery also returns native keyboard focus to the map')
        external = driver.script("return performance.getEntriesByType('resource').map(r=>r.name).filter(u=>/^https?:/.test(u)&&new URL(u).origin!==location.origin);")
        assert external == []
        facts = driver.script("const gl=document.querySelector('.maplibregl-canvas').getContext('webgl2'),d=gl?.getExtension('WEBGL_debug_renderer_info');return {ua:navigator.userAgent,viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,webgl_context_lost:gl?.isContextLost(),renderer:d?gl.getParameter(d.UNMASKED_RENDERER_WEBGL):'not exposed',module_scripts:[...document.querySelectorAll('script[type=module]')].map(s=>s.src)};")
        assert facts['webgl_context_lost'] is False and any(urlsplit(u).path == asset for u in facts['module_scripts'])
        assert hashlib.sha256((ROOT / 'apps/web/client/dist/index.html').read_bytes()).hexdigest() == build['index_sha256']
        assert hashlib.sha256((ROOT / ('apps/web/client/dist' + asset)).read_bytes()).hexdigest() == build['asset_sha256']
        report = {'date': datetime.now(timezone.utc).isoformat(), 'capabilities': capabilities, 'facts': facts,
                  'build': build, 'snapshot':snapshot, 'os': platform.platform(), 'python': platform.python_version(),
                  'driver_sha256': hashlib.sha256(gecko.read_bytes()).hexdigest(),
                  'verifier_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  'client_sha256': hashlib.sha256(Path(__file__).with_name('webdriver_client.py').read_bytes()).hexdigest(),
                  'binary_sha256': hashlib.sha256(binary.read_bytes()).hexdigest(), 'checks': checks, 'first_usable': first, 'list_detail_geometry': geometry,'recovery_checks':recovery,'compact_geometry':compact,
                  'external_document_resources': external, 'scope': 'Official Firefox, isolated headless profile, real W3C keyboard/click commands and local data. Not OS IME, reader, actual clipboard permissions, full fault matrix, real devices or performance acceptance.'}
        (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({'version': args.version, 'checks': len(checks),'recovery_checks':len(recovery)}), flush=True)
    except Exception as error:
        state = None
        if driver.session:
            try:
                state = driver.script('return {url:location.href,text:document.body.innerText,focus:document.activeElement?.outerHTML};')
                (output / 'failure.png').write_bytes(base64.b64decode(driver.command('GET', '/screenshot')))
            except Exception:
                pass
        (output / 'failure.json').write_text(json.dumps({'error': str(error), 'capabilities': capabilities, 'checks': checks, 'recovery_checks':locals().get('recovery',[]), 'state': state}, ensure_ascii=False, indent=2), encoding='utf-8')
        raise
    finally:
        try:
            driver.close()
        finally:
            if process.poll() is None:
                process.terminate(); process.wait(timeout=10)
            log.close()

if __name__ == '__main__':
    main()
