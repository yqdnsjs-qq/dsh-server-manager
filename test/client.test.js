import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8');

function loadClient() {
  let factory;
  const document = {
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild() {} },
  };
  const window = {
    __ModuleLoader__: {
      load(entry) {
        factory = entry.factory;
        return entry;
      },
    },
  };
  const sandbox = {
    window,
    document,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    localStorage: { getItem: () => null, setItem() {} },
  };
  vm.runInNewContext(source, sandbox, { filename: 'client.js' });
  assert.equal(typeof factory, 'function', 'client registers a module factory');
  const React = {
    createElement: (...args) => ({ args }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect() {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useRef: () => ({ current: null }),
  };
  return factory((name) => {
    if (name === 'react') return React;
    throw new Error(`unexpected module: ${name}`);
  });
}

function makeContext(record) {
  return {
    locale: {
      bind: () => (key) => key,
      register(ns, value) {
        record.dictionaries = { ns, value };
        return () => {};
      },
    },
    slots: {
      inject(name, callback) {
        record.injected.push(name);
        const result = callback();
        if (result && typeof result.next === 'function') {
          for (const entry of result) void entry;
        }
        return () => {};
      },
      register(options, component) {
        record.slots.push({ options, component });
        return () => {};
      },
    },
  };
}

test('client bundle registers a first-class left-sidebar page', () => {
  const module = loadClient();
  assert.deepEqual(Array.from(module.inject), ['slots', 'locale']);

  const record = { injected: [], slots: [] };
  module.apply(makeContext(record));

  assert.deepEqual(record.injected, ['sidebar.panellist', 'main']);
  const entry = record.slots.find((slot) => slot.options.name === 'sidebar.panellist');
  assert.ok(entry, 'registers a sidebar.panellist entry');
  assert.equal(entry.options.id, 'server-manager');
  assert.equal(entry.options.locale, 'serverManager');
  assert.equal(entry.options.order, 6);
  assert.equal(typeof entry.options.label, 'function');
  assert.equal(entry.options.label(), '服务器监控管理');
  assert.equal(typeof entry.component, 'function');

  const main = record.slots.find((slot) => slot.options.name === 'main');
  assert.ok(main, 'registers the matching main page');
  assert.equal(main.options.key, 'server-manager');
  assert.equal(main.options.locale, 'serverManager');
  assert.equal(typeof main.component, 'function');
});

test('client bundle exposes zh and en dictionaries with the same keys', () => {
  const module = loadClient();
  const record = { injected: [], slots: [] };
  module.apply(makeContext(record));
  assert.ok(record.dictionaries, 'registers dictionaries');
  assert.equal(record.dictionaries.ns, 'serverManager');
  const zhKeys = Array.from(Object.keys(record.dictionaries.value.zh)).sort();
  const enKeys = Array.from(Object.keys(record.dictionaries.value.en)).sort();
  assert.ok(zhKeys.length > 100);
  assert.deepEqual(zhKeys, enKeys);
  for (const key of ['docker.containers', 'docker.confirmUpgrade', 'docker.filterRunning', 'docker.open', 'docker.noWebPort', 'form.onepanel']) {
    assert.ok(zhKeys.includes(key), `dictionary contains ${key}`);
  }
  assert.ok(zhKeys.some((key) => key.startsWith('docker.onePanel')), 'dictionary contains 1Panel labels');
  for (const key of ['pve.title', 'pve.open', 'pve.running', 'pve.storage', 'pve.checkUpdates', 'pve.updatesTitle']) {
    assert.ok(zhKeys.includes(key), `dictionary contains ${key}`);
  }
  for (const key of ['onepanel.title', 'onepanel.updates', 'onepanel.refresh', 'onepanel.current', 'onepanel.candidate']) {
    assert.ok(zhKeys.includes(key), `dictionary contains ${key}`);
  }
});

test('client bundle shows the plugin version in the header', () => {
  assert.match(source, /smx-version/);
  assert.match(source, /snap\?\.version/);
});

test('client bundle renders the Docker deck and polls its API', () => {
  assert.match(source, /function DockerBoard\(/);
  assert.match(source, /\/docker\?id=/);
  assert.match(source, /h\(DockerBoard,/);
  assert.match(source, /container\.webUrl/);
  assert.match(source, /docker\.openHint/);
  assert.ok(!source.includes('sidebarRightTabs'));
  assert.ok(!source.includes('sidebar.right.pane.tab'));
});

test('client bundle renders a read-only Proxmox VE card', () => {
  assert.match(source, /function PveBoard\(/);
  assert.match(source, /\/pve\?id=/);
  assert.match(source, /h\(PveBoard,/);
  assert.match(source, /pve\.open/);
  assert.match(source, /pve\.checkUpdates/);
  assert.match(source, /refresh-updates/);
});

test('client bundle renders the 1Panel app-store update panel', () => {
  assert.match(source, /function OnePanelAppsBoard\(/);
  assert.match(source, /\/onepanel\?id=/);
  assert.match(source, /h\(OnePanelAppsBoard,/);
  assert.match(source, /onepanel\.candidate/);
});

test('client bundle no longer depends on the right-sidebar tab service', () => {
  assert.ok(!source.includes('sidebarRightTabs'));
  assert.ok(!source.includes('sidebar.right.pane.tab'));
});
