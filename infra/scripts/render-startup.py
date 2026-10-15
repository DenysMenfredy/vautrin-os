#!/usr/bin/env python3
"""Render the same startup artifact used by Terraform for a SHA-tagged rollout."""
import argparse
from pathlib import Path
import re

parser = argparse.ArgumentParser()
parser.add_argument('--project', required=True)
parser.add_argument('--secret-resource', required=True)
parser.add_argument('--image', required=True)
parser.add_argument('--role', choices=['api', 'worker', 'migrator'], required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
if not re.fullmatch(r'[a-z][a-z0-9-]{4,61}[a-z0-9]', args.project):
    raise SystemExit('Invalid project identifier')
if not re.fullmatch(r'projects/[a-z0-9-]+/secrets/[a-zA-Z0-9_-]+', args.secret_resource):
    raise SystemExit('Invalid Secret Manager resource')
if not re.fullmatch(r'[a-z0-9.-]+/[a-z0-9/_-]+:(?:[a-f0-9]{7,40})', args.image):
    raise SystemExit('Use an Artifact Registry image with an immutable commit tag')
template = (Path(__file__).parent.parent / 'terraform/startup.sh.tftpl').read_text()
for name, value in [('project', args.project), ('secret_resource', args.secret_resource), ('image', args.image), ('role', args.role)]:
    template = template.replace('${' + name + '}', value)
Path(args.output).write_text(template)
Path(args.output).chmod(0o700)
