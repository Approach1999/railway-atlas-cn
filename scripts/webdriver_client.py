"""Small local W3C WebDriver client for official Firefox binary checks.

Uses standard-library HTTP, not a patched browser or a user profile.
"""
import json
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit

ELEMENT = 'element-6066-11e4-a52e-4f735466cecf'

class DriverError(RuntimeError):
    pass

class Driver:
    def __init__(self, address):
        if urlsplit(address).hostname != '127.0.0.1':
            raise ValueError('Test driver must listen on loopback')
        self.address = address.rstrip('/')
        self.session = None
        self.http = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def request(self, method, path, data=None):
        body = json.dumps(data, ensure_ascii=False).encode() if data is not None else None
        request = urllib.request.Request(self.address + path, body, {'Content-Type': 'application/json'}, method=method)
        try:
            with self.http.open(request, timeout=45) as response:
                value = json.load(response).get('value')
        except urllib.error.HTTPError as error:
            try:
                value = json.load(error)['value']
            except (ValueError, KeyError):
                raise DriverError('WebDriver HTTP ' + str(error.code)) from error
            raise DriverError(str(value.get('error')) + ': ' + str(value.get('message'))) from error
        if isinstance(value, dict) and value.get('error'):
            raise DriverError(str(value['error']) + ': ' + str(value.get('message')))
        return value

    def start(self, binary):
        value = self.request('POST', '/session', {'capabilities': {'alwaysMatch': {
            'browserName': 'firefox', 'acceptInsecureCerts': False,
            'moz:firefoxOptions': {'binary': str(binary), 'args': ['-headless'], 'prefs': {
                'app.update.auto': False, 'app.update.enabled': False,
                'browser.shell.checkDefaultBrowser': False, 'browser.startup.homepage': 'about:blank',
                'browser.newtabpage.enabled': False, 'toolkit.telemetry.enabled': False,
                'datareporting.healthreport.uploadEnabled': False,
            }}}}})
        self.session = value['sessionId']
        self.command('POST', '/timeouts', {'script': 30000, 'pageLoad': 45000, 'implicit': 0})
        return value['capabilities']

    def command(self, method, suffix, data=None):
        return self.request(method, '/session/' + self.session + suffix, data)

    def script(self, source, *args):
        return self.command('POST', '/execute/sync', {'script': source, 'args': args})

    def navigate(self, url):
        self.command('POST', '/url', {'url': url})

    def element(self, selector):
        return self.command('POST', '/element', {'using': 'css selector', 'value': selector})[ELEMENT]

    def click(self, selector):
        self.command('POST', '/element/' + self.element(selector) + '/click', {})

    def keys(self, selector, text):
        self.command('POST', '/element/' + self.element(selector) + '/value', {'text': text})

    def fill(self, selector, text):
        self.command('POST', '/element/' + self.element(selector) + '/clear', {})
        self.keys(selector, text)

    def wait(self, expression, *args, timeout=25):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            value = self.script('return (' + expression + ');', *args)
            if value:
                return value
            time.sleep(0.1)
        raise TimeoutError('Browser condition did not complete: ' + expression)

    def close(self):
        if self.session:
            try:
                self.command('DELETE', '')
            finally:
                self.session = None
