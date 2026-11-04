import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('release', Path(__file__).with_name('coolify-release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
SHA = 'a' * 40
SERVICE = 'mt8rqzgbtpkbzedwicy03wnf'

class ReleaseTests(unittest.TestCase):
    def metadata(self, directory):
        for component in release.COMPONENTS:
            (Path(directory) / (component + '.json')).write_text(json.dumps({'component': component, 'revision': SHA, 'image': release.IMAGE_PREFIX + component, 'digest': 'sha256:' + 'b' * 64}))

    def test_rejects_mixed_or_mutable_image_sets(self):
        with tempfile.TemporaryDirectory() as directory:
            self.metadata(directory)
            self.assertEqual(set(release.load_images(directory, SHA)), release.COMPONENTS)
            path = Path(directory) / 'web.json'
            value = json.loads(path.read_text())
            for field, wrong in [('revision', 'c' * 40), ('image', 'ghcr.io/other/app'), ('digest', 'latest')]:
                path.write_text(json.dumps({**value, field: wrong}))
                with self.assertRaises(release.ReleaseError):release.load_images(directory, SHA)
            path.unlink()
            with self.assertRaises(release.ReleaseError):release.load_images(directory, SHA)

    def test_release_preserves_volume_names_and_secret_references(self):
        with tempfile.TemporaryDirectory() as directory:
            self.metadata(directory)
            images = release.load_images(directory, SHA)
            template = (release.ROOT / 'deploy/docker-compose.coolify.yml').read_text()
            output = release.release_compose(template, images, SHA)
            self.assertIn('${MATMS_APP_DB_PASSWORD}', output)
            self.assertIn('${BETTER_AUTH_SECRET}', output)
            self.assertIn('predeploy-backup:\n        condition: service_completed_successfully', output)
            self.assertNotIn('pull_policy: never', output)
            for image in images.values():self.assertIn(image, output)
            with self.assertRaises(release.ReleaseError):release.release_compose(template.replace('matms_data:', 'replacement_data:'), images, SHA)

    def test_refuses_new_or_host_bound_storage(self):
        rows = [{'name': SERVICE + '_matms-data', 'mount_path': '/var/lib/postgresql', 'host_path': None}, {'name': SERVICE + '_matms-backups', 'mount_path': '/backups', 'host_path': None}]
        self.assertEqual(len(release.storage_identity({'persistent_storages': rows}, SERVICE)), 2)
        with self.assertRaises(release.ReleaseError):release.storage_identity({'persistent_storages': rows[:1]}, SERVICE)
        with self.assertRaises(release.ReleaseError):release.storage_identity({'persistent_storages': [{**rows[0], 'host_path': '/somewhere'}, rows[1]]}, SERVICE)

    def test_refuses_insecure_or_credential_bearing_api_origins(self):
        for invalid in ['http://example.test', 'https://user:secret@example.test', 'https://example.test/path', 'https://example.test?token=secret']:
            with self.assertRaises(release.ReleaseError):release.origin(invalid)
        self.assertEqual(release.origin('https://example.test'), 'https://example.test')

    def test_unhealthy_or_wrong_images_do_not_count_as_ready(self):
        images = {c: release.IMAGE_PREFIX + c + '@sha256:' + 'b' * 64 for c in release.COMPONENTS}
        resources = [{'name': name, 'image': images[component], 'status': 'running:healthy'} for name, component in [('web', 'web'), ('server', 'server'), ('postgres', 'postgres'), ('backup', 'postgres')]]
        state = {'status': 'running:healthy', 'applications': resources}
        self.assertTrue(release.api_ready(state, images))
        resources[0]['image'] = 'old-image'
        self.assertFalse(release.api_ready(state, images))
        resources[0]['image'] = images['web']
        resources[1]['status'] = 'running:unhealthy'
        self.assertFalse(release.api_ready(state, images))

if __name__ == '__main__':unittest.main()
