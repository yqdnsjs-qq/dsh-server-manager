import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../src/index.js';

function fakeHost() {
  const tools = [];
  const routes = [];
  const disposers = [];
  const ctx = {
    logger: () => ({ debug() {}, warn() {} }),
    effect(fn) {
      const dispose = fn();
      if (typeof dispose === 'function') disposers.push(dispose);
    },
    inject(deps, callback) {
      if (deps.includes('tools')) {
        callback({
          tools: {
            register(definition) {
              tools.push(definition);
              return () => {};
            },
          },
        });
      }
      if (deps.includes('webServer')) {
        callback({
          get(name) {
            if (name === 'webServer') {
              return {
                register(options) {
                  routes.push(options);
                  return () => {};
                },
              };
            }
            if (name === 'connection') return { requestRejection: () => undefined };
            return undefined;
          },
        });
      }
      return () => {};
    },
  };
  return { ctx, tools, routes, disposers };
}

test('apply registers every tool and the panel route', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-sm-host-'));
  const { ctx, tools, routes, disposers } = fakeHost();
  try {
    apply(ctx, { dataDir: dir });
    assert.equal(tools.length, 10);
    const names = tools.map(tool => tool.name).sort();
    assert.deepEqual(names, [
      'server_deploy',
      'server_docker',
      'server_exec',
      'server_list',
      'server_logs',
      'server_manage',
      'server_rollback',
      'server_service',
      'server_status',
      'server_transfer',
    ]);
    for (const tool of tools) {
      assert.equal(tool.parameters.type, 'object', `${tool.name} parameters`);
      assert.equal(typeof tool.description, 'string');
      assert.equal(tool.output.schema.type, 'string');
      assert.equal(typeof tool.output.render, 'function');
      assert.equal(typeof tool.execute, 'function');
    }
    assert.equal(routes.length, 1);
    assert.equal(routes[0].kind, 'prefix');
    assert.equal(routes[0].path, '/api/server-manager');
    assert.equal(typeof routes[0].handler, 'function');
  } finally {
    for (const dispose of disposers) {
      if (typeof dispose === 'function') dispose();
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test('every tool parameter schema stays inside the enforced subset', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-sm-host-'));
  const { ctx, tools } = fakeHost();
  const allowed = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'description', 'title', 'default', 'oneOf', 'const']);
  const walk = (node, path) => {
    for (const key of Object.keys(node)) {
      assert.ok(allowed.has(key), `${path} uses unsupported keyword ${key}`);
    }
    if (node.properties) {
      for (const [name, child] of Object.entries(node.properties)) walk(child, `${path}.${name}`);
    }
    if (node.items) walk(node.items, `${path}[]`);
    if (node.required) {
      for (const name of node.required) assert.ok(name in (node.properties ?? {}), `${path}.required names ${name}`);
    }
  };
  try {
    apply(ctx, { dataDir: dir });
    for (const tool of tools) walk(tool.parameters, tool.name);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
