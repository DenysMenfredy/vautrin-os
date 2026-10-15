#!/usr/bin/env python3
"""Read a single matching guest attribute from gcloud's JSON response."""
import json
import sys
value = json.load(sys.stdin)
items = value.get('queryValue', {}).get('items', []) if isinstance(value, dict) else value
matches = [item['value'] for item in items if isinstance(item, dict) and item.get('namespace') == sys.argv[1] and item.get('key') == sys.argv[2] and isinstance(item.get('value'), str)]
if len(matches) == 1:
    print(matches[0])
