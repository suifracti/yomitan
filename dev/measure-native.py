#!/usr/bin/env python3
"""Measure installed connectNative with an isolated Chrome profile; ping only, no learning data."""
import json
import pathlib
import statistics
import tempfile
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
ID = 'fdibnlkfllnojcmhcghkmdlceeegmhpf'
with tempfile.TemporaryDirectory(prefix='study-native-bench-') as temporary:
    root = pathlib.Path(temporary)
    extension = root / 'extension'
    extension.mkdir()
    key = json.loads((ROOT / 'ext/manifest.json').read_text())['key']
    (extension / 'manifest.json').write_text(json.dumps({'manifest_version': 3, 'name': 'Isolated bridge ping', 'version': '1.0', 'key': key,
        'permissions': ['nativeMessaging'], 'background': {'service_worker': 'worker.js'}}))
    (extension / 'worker.js').write_text('// Ping fixture only.\n')
    (extension / 'ping.html').write_text('<!doctype html><title>Isolated bridge ping</title>')
    # Chromium resolves user NativeMessagingHosts beneath --user-data-dir.
    # Register only this temporary profile, not the user's browser registry.
    hosts = root / 'profile/NativeMessagingHosts'
    hosts.mkdir(parents=True)
    (hosts / 'com.suifracti.study_translator.json').write_text(json.dumps({
        'name': 'com.suifracti.study_translator', 'description': 'Isolated ping measurement', 'type': 'stdio',
        'path': str(pathlib.Path.home() / 'Library/Application Support/EnglishStudyTranslator/launch-host'),
        'allowed_origins': [f'chrome-extension://{ID}/']}))
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(str(root / 'profile'), executable_path=p.chromium.executable_path,
            headless=True, args=[f'--disable-extensions-except={extension}', f'--load-extension={extension}', '--no-first-run'])
        try:
            page = context.new_page()
            page.goto(f'chrome-extension://{ID}/ping.html')
            times = page.evaluate('''async () => {
                const times = [];
                for (let i = 0; i < 20; i++) {
                    const elapsed = await new Promise((resolve, reject) => {
                        const start = performance.now();
                        const port = chrome.runtime.connectNative('com.suifracti.study_translator');
                        let done = false;
                        const timeout = setTimeout(() => {done = true; port.disconnect(); reject(new Error('ping timeout'));}, 5000);
                        port.onMessage.addListener((value) => {
                            if (done) return;
                            done = true; clearTimeout(timeout); port.disconnect();
                            if (value.ok !== true || value.pong !== true) reject(new Error('unexpected ping response'));
                            else resolve(performance.now() - start);
                        });
                        port.onDisconnect.addListener(() => {
                            const message = chrome.runtime.lastError?.message;
                            if (!done) {done = true; clearTimeout(timeout); reject(new Error(message || 'disconnected'));}
                        });
                        port.postMessage({action: 'bridgePing'});
                    });
                    times.push(elapsed);
                }
                return times;
            }''')
            print(json.dumps({'browser': context.browser.version, 'unit': 'ms', 'samples': times,
                'median': statistics.median(times), 'max': max(times), 'p95': sorted(times)[18],
                'scope': 'new connectNative port plus installed launcher/Python/frame roundtrip; isolated browser profile; ping only'}, indent=2))
        finally:
            context.close()
