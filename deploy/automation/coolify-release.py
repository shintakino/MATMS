"""Deploy only a validated main-branch image set; never copy runtime secrets."""
import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
REPOSITORY = 'shintakino/MATMS'
IMAGE_PREFIX = 'ghcr.io/shintakino/matms-'
COMPONENTS = {'web', 'server', 'postgres'}

class ReleaseError(Exception):
    pass

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def origin(value):
    parsed = urlsplit(value)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
        raise ReleaseError('A canonical HTTPS origin is required.')
    return value

def identifier(value):
    if not re.fullmatch('[a-z0-9]{24}', value):
        raise ReleaseError('Invalid Coolify resource identifier.')
    return value

def load_images(directory, revision):
    if not re.fullmatch('[a-f0-9]{40}', revision):
        raise ReleaseError('A full Git revision is required.')
    images = {}
    for path in Path(directory).glob('*.json'):
        if path.stat().st_size > 4096:
            raise ReleaseError('Unexpected image metadata size.')
        record = json.loads(path.read_text())
        if set(record) != {'component', 'revision', 'image', 'digest'}:
            raise ReleaseError('Unexpected image metadata fields.')
        component = record['component']
        if component not in COMPONENTS or component in images or record['revision'] != revision:
            raise ReleaseError('Missing, duplicate or mixed-revision images.')
        if record['image'] != IMAGE_PREFIX + component or not re.fullmatch(r'sha256:[a-f0-9]{64}', record['digest']):
            raise ReleaseError('Only immutable MATMS GHCR images are allowed.')
        images[component] = record['image'] + '@' + record['digest']
    if set(images) != COMPONENTS:
        raise ReleaseError('All three release images are required.')
    return images

def release_compose(template, images, revision):
    if not template.endswith('volumes:\n  matms_data:\n  matms_backups:\n'):
        raise ReleaseError('Production volume definitions changed; operator review required.')
    def replace(match):
        return '    image: ' + images[match[1]]
    text, count = re.subn(r'^    image: matms-(web|server|postgres):MATMS_RELEASE_TAG$', replace, template, flags=re.M)
    if count != 6 or text.count('    pull_policy: never') != 6:
        raise ReleaseError('Unexpected production image layout.')
    text = text.replace('    pull_policy: never', '    pull_policy: if_not_present')
    # The API readiness body identifies the runtime, independently of Coolify metadata.
    text = text.replace("      PORT: '3000'", "      PORT: '3000'\n      MATMS_RELEASE_SHA: '" + revision + "'")
    if text.count('MATMS_RELEASE_SHA:') != 1 or 'MATMS_RELEASE_TAG' in text:
        raise ReleaseError('Unable to bind the API runtime revision.')
    return text

def storage_identity(payload, service):
    expected = {(service + '_matms-data', '/var/lib/postgresql'), (service + '_matms-backups', '/backups')}
    rows = payload.get('persistent_storages', [])
    actual = {(row.get('name'), row.get('mount_path')) for row in rows}
    if actual != expected or any(row.get('host_path') for row in rows) or payload.get('file_storages'):
        raise ReleaseError('Production storage differs from the verified volumes; refusing deployment.')
    return actual

def api_ready(state, images):
    resources = {r['name']: r for r in state.get('applications', []) + state.get('databases', [])}
    for name, component in [('web', 'web'), ('server', 'server'), ('postgres', 'postgres'), ('backup', 'postgres')]:
        item = resources.get(name, {})
        if item.get('image') != images[component] or item.get('status') != 'running:healthy':
            return False
    return state.get('status') == 'running:healthy'

def request_json(url, method='GET', token=None, data=None):
    headers = {'Accept': 'application/json', 'User-Agent': 'MATMS-release', 'Cache-Control': 'no-cache'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    if data is not None:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, method=method, headers=headers, data=None if data is None else json.dumps(data).encode())
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=60) as response:
            raw = response.read(2 * 1024 * 1024 + 1)
            if len(raw) > 2 * 1024 * 1024:
                raise ReleaseError('Unexpected API response size.')
            return json.loads(raw)
    except urllib.error.HTTPError as error:
        # Never log bodies/headers: registry login bodies contain short-lived tokens.
        raise ReleaseError('API request returned HTTP ' + str(error.code) + '.') from None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        raise ReleaseError('API request failed or returned invalid JSON.') from None

def public_ready(public_origin, revision):
    opener = urllib.request.build_opener(NoRedirect())
    headers = {'Cache-Control': 'no-cache', 'User-Agent': 'MATMS-release-probe'}
    try:
        req = urllib.request.Request(public_origin + '/login?release=' + revision, headers=headers)
        with opener.open(req, timeout=20) as response:
            if response.status != 200 or response.headers.get('X-MATMS-Release') != revision:
                return False
        value = request_json(public_origin + '/api/health/ready?release=' + revision)
        return value.get('status') == 'ok' and value.get('release') == revision
    except (ReleaseError, urllib.error.URLError, TimeoutError):
        return False

def main():
    if os.environ.get('GITHUB_REF') != 'refs/heads/main' or os.environ.get('GITHUB_REPOSITORY') != REPOSITORY:
        raise ReleaseError('Only the MATMS main branch may deploy production.')
    revision = os.environ['GITHUB_SHA']
    images = load_images(os.environ['MATMS_IMAGE_DIRECTORY'], revision)
    api = origin(os.environ['COOLIFY_URL']) + '/api/v1'
    public = origin(os.environ['MATMS_ORIGIN'])
    service = identifier(os.environ['COOLIFY_SERVICE_UUID'])
    server = identifier(os.environ['COOLIFY_SERVER_UUID'])
    token = os.environ['COOLIFY_TOKEN']
    registry_token = os.environ['GITHUB_TOKEN']
    if not token or not registry_token:
        raise ReleaseError('Deployment credentials are missing.')
    latest = request_json('https://api.github.com/repos/' + REPOSITORY + '/git/ref/heads/main', token=registry_token)
    if latest.get('object', {}).get('sha') != revision:
        print('A newer main commit exists; this release will not change production.')
        return
    resource = api + '/services/' + service
    state = request_json(resource, token=token)
    if state.get('uuid') != service:
        raise ReleaseError('Coolify returned an unexpected service.')
    storage_identity(request_json(resource + '/storages', token=token), service)
    compose = release_compose((ROOT / 'deploy/docker-compose.coolify.yml').read_text(), images, revision)
    # Token expires when this job finishes. Cached digest images allow later local restarts.
    request_json(api + '/servers/' + server + '/registries', 'POST', token, {'registry': 'ghcr.io', 'username': os.environ['GITHUB_ACTOR'], 'password': registry_token})
    request_json(resource, 'PATCH', token, {'docker_compose_raw': base64.b64encode(compose.encode()).decode(), 'instant_deploy': False, 'redact_all_env_values_in_logs': True, 'description': 'MATMS main revision ' + revision})
    # latest=true pulls all candidate images before Coolify recreates containers.
    request_json(resource + '/restart', 'POST', token, {'latest': True})
    deadline = time.monotonic() + 900
    stable = 0
    while time.monotonic() < deadline:
        try:
            state = request_json(resource, token=token)
            matches = api_ready(state, images) and public_ready(public, revision)
            stable = stable + 1 if matches else 0
            if stable >= 2:
                storage_identity(request_json(resource + '/storages', token=token), service)
                report = {'revision': revision, 'images': images, 'origin': public, 'service_uuid': service, 'status': 'verified', 'volumes_preserved': True, 'web_and_api_revision_verified': True}
                Path('deployment-result.json').write_text(json.dumps(report, indent=2) + '\n')
                print('Verified production release ' + revision + ': web, API, database health and persistent volume identities.')
                return
        except ReleaseError:
            stable = 0
        print('Waiting for the candidate web/API revision and Coolify readiness...', flush=True)
        time.sleep(10)
    raise ReleaseError('Deployment readiness timed out. Check Coolify logs; do not restore or downgrade the database automatically.')

if __name__ == '__main__':
    try:
        main()
    except (ReleaseError, KeyError, ValueError, OSError) as error:
        print('Deployment failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
