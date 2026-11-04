import time
import urllib.error
import urllib.request

deadline = time.monotonic() + 180
for url in ['http://127.0.0.1:3100/health/ready', 'http://127.0.0.1:3101/login']:
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                if response.status == 200:break
        except (urllib.error.URLError, TimeoutError):
            pass
        time.sleep(2)
    else:raise SystemExit('Disposable browser services failed readiness: ' + url)
print('Disposable API and web are ready for browser workflows.')
