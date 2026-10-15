"""Offline checks for the deployment artifact and unsafe rendering inputs."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]

class StartupArtifactTest(unittest.TestCase):
    def render(self, output, *extra):
        return subprocess.run([
            'python3', str(ROOT / 'infra/scripts/render-startup.py'),
            '--project', 'vautrin-staging', '--secret-resource', 'projects/vautrin-staging/secrets/vautrin-api-environment',
            '--image', 'us-central1-docker.pkg.dev/vautrin-staging/runtime/api:abcdef0123456789',
            '--role', 'api', '--output', str(output), *extra,
        ], capture_output=True, text=True)

    def test_renders_shell_valid_artifact_with_secret_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'startup.sh'
            result = self.render(output)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(output.stat().st_mode & 0o777, 0o700)
            subprocess.run(['bash', '-n', str(output)], check=True)
            content = output.read_text()
            self.assertNotIn('${image}', content)
            self.assertIn('trap ', content)
            self.assertIn('Health.Status', content)
            self.assertNotIn('set -x', content)

    def test_rejects_shell_injection_and_mutable_image_tags(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'startup.sh'
            for option, value in [('--image', 'registry/image:latest'), ('--image', "image:abcdef0'; touch /tmp/injection"), ('--secret-resource', "projects/project/secrets/secret'; echo bad"), ('--project', 'project; echo bad')]:
                result = self.render(output, option, value)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(output.exists())

class GuestAttributeTest(unittest.TestCase):
    def test_handles_rest_envelope_and_flattened_cli_items(self):
        import json
        item = {'namespace': 'vautrin', 'key': 'migration-status', 'value': 'success'}
        for value in [{'queryValue': {'items': [item]}}, [item]]:
            result = subprocess.run(['python3', str(ROOT / 'infra/scripts/read-guest-value.py'), 'vautrin', 'migration-status'], input=json.dumps(value), text=True, capture_output=True, check=True)
            self.assertEqual(result.stdout.strip(), 'success')

if __name__ == '__main__':
    unittest.main()
