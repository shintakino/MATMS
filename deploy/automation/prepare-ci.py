"""Generate build/test-only configuration. Never read production credentials."""
import argparse
import os
import secrets
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]

def write(path, values):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.touch(mode=0o600, exist_ok=True)
    path.chmod(0o600)
    path.write_text(''.join(key + '=' + value + '\n' for key, value in values.items()))

def main():
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        raise SystemExit('This helper is for disposable GitHub Actions workspaces; it must not overwrite operator environment files.')
    parser = argparse.ArgumentParser()
    parser.add_argument('--origin', default='https://matms.shintakino.qzz.io')
    args = parser.parse_args()
    origin = urlsplit(args.origin)
    if origin.scheme != 'https' or not origin.hostname or origin.username or origin.password or origin.path or origin.query or origin.fragment:
        raise SystemExit('Build origin must be a canonical HTTPS origin.')
    auth_secret = secrets.token_urlsafe(48)
    build = ROOT / '.deploy-private/ci'
    write(build / 'web.env', {'NODE_ENV': 'production', 'SERVER_URL': 'http://server:3000', 'MATMS_CANONICAL_ORIGIN': args.origin})
    write(build / 'server.env', {'NODE_ENV': 'production', 'DATABASE_URL': 'postgresql://build:build@127.0.0.1:5432/build', 'BETTER_AUTH_SECRET': auth_secret, 'BETTER_AUTH_URL': args.origin, 'CORS_ORIGIN': args.origin})
    # These files support install/type checks and disposable browser tests only.
    write(ROOT / 'apps/web/.env.local', {'NODE_ENV': 'development', 'SERVER_URL': 'http://127.0.0.1:3100', 'MATMS_CANONICAL_ORIGIN': 'https://matms-browser.example.test'})
    write(ROOT / 'apps/server/.env.local', {'NODE_ENV': 'test', 'DATABASE_URL': os.environ.get('TEST_DATABASE_URL', 'postgresql://postgres:matms-ci-only@127.0.0.1:5432/matms_ci_test'), 'BETTER_AUTH_SECRET': auth_secret, 'BETTER_AUTH_URL': 'http://127.0.0.1:3101', 'CORS_ORIGIN': 'http://127.0.0.1:3101'})
    print('Disposable CI and build configuration prepared; no production secrets used.')

if __name__ == '__main__':
    main()
