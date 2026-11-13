import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DOCKER_ACTIONS,
  buildComposeUpgrade,
  buildContainerCommand,
  buildDockerScript,
  isMutatingDockerAction,
  looksLikeDockerPermissionError,
  parseDockerOutput,
  parseDockerPsSimple,
  parsePublishedPorts,
  webUrlsForPorts,
} from '../src/docker.js';

const psLine = value => `SM_PS=${JSON.stringify(value)}`;

test('buildDockerScript emits markers and optional sections', () => {
  const script = buildDockerScript();
  assert.match(script, /SM_PS=/);
  assert.match(script, /SM_LABELS=/);
  assert.match(script, /docker stats --no-stream/);
  assert.match(script, /1pctl version/);
  assert.match(script, /1panel-core/);
  assert.match(script, /SM_ONEPANEL_PRESENT=1/);
  assert.match(script, /sed -n -e 's\/\.\*版本/);
  assert.doesNotMatch(script, /SM_LOGS_BEGIN/);

  const withLogs = buildDockerScript({ stats: false, logs: 'web-1', lines: 40 });
  assert.match(withLogs, /SM_LOGS_BEGIN/);
  assert.match(withLogs, /docker logs --tail 40 web-1/);
  assert.doesNotMatch(withLogs, /docker stats/);

  const clamped = buildDockerScript({ logs: 'web-1', lines: 999_999 });
  assert.match(clamped, /--tail 2000/);
});

test('parseDockerOutput builds containers, compose projects and 1Panel info', () => {
  const stdout = [
    'SM_DOCKER_BEGIN',
    'SM_ENGINE_VERSION=29.4.3',
    psLine({
      ID: 'abcdef0123456789',
      Image: 'ollama/ollama:latest',
      Command: 'serve',
      CreatedAt: '2026-11-01 10:00:00 +0000 UTC',
      RunningFor: '2 days ago',
      Ports: '0.0.0.0:11434->11434/tcp',
      Status: 'Up 2 days (healthy)',
      Names: '1Panel-ollama-Sw2r',
      State: 'running',
    }),
    psLine({
      ID: 'fedcba9876543210',
      Image: 'nginx:alpine',
      Command: 'nginx -g daemon off;',
      CreatedAt: '2026-11-02 10:00:00 +0000 UTC',
      RunningFor: '3 hours ago',
      Ports: '80/tcp',
      Status: 'Exited (0) 3 hours ago',
      Names: 'web-1',
      State: 'exited',
    }),
    'SM_LABELS=/1Panel-ollama-Sw2r {"createdBy":"Apps","com.docker.compose.project":"ollama","com.docker.compose.service":"ollama","com.docker.compose.project.working_dir":"/opt/1panel/apps/ollama/ollama","com.docker.compose.project.config_files":"/opt/1panel/apps/ollama/ollama/docker-compose.yml"}',
    'SM_LABELS=/web-1 {"com.docker.compose.project":"shop","com.docker.compose.service":"web","com.docker.compose.project.working_dir":"/srv/shop","com.docker.compose.project.config_files":"/srv/shop/compose.yml"}',
    'SM_STAT={"Name":"1Panel-ollama-Sw2r","CPUPerc":"3.25%","MemPerc":"12.50%","MemUsage":"1.2GiB / 9.6GiB","NetIO":"1MB / 2MB","BlockIO":"0B / 0B","PIDs":"12"}',
    'SM_ONEPANEL_VERSION=v2.4.2 stable',
    'SM_ONEPANEL_PORT=33333',
    'SM_DOCKER_END',
  ].join('\n');

  const data = parseDockerOutput(stdout);
  assert.equal(data.engine.available, true);
  assert.equal(data.engine.version, '29.4.3');
  assert.equal(data.containers.length, 2);

  const [running, stopped] = data.containers;
  assert.equal(running.name, '1Panel-ollama-Sw2r');
  assert.equal(running.state, 'running');
  assert.equal(running.health, 'healthy');
  assert.equal(running.onepanel, true);
  assert.equal(running.compose.project, 'ollama');
  assert.equal(running.compose.workingDir, '/opt/1panel/apps/ollama/ollama');
  assert.equal(running.stats.cpuPercent, 3.25);
  assert.equal(running.stats.memoryPercent, 12.5);
  assert.equal(running.stats.memoryUsage, '1.2GiB / 9.6GiB');

  assert.equal(stopped.name, 'web-1');
  assert.equal(stopped.state, 'exited');
  assert.equal(stopped.onepanel, false);
  assert.equal(stopped.compose.service, 'web');

  assert.deepEqual(data.projects.map(project => project.name), ['ollama', 'shop']);
  assert.equal(data.projects.find(project => project.name === 'ollama').running, 1);
  assert.equal(data.projects.find(project => project.name === 'shop').stopped, 1);

  assert.equal(data.onepanel.installed, true);
  assert.equal(data.onepanel.version, 'v2.4.2 stable');
  assert.equal(data.onepanel.port, 33333);
  assert.equal(data.onepanel.containers, 1);
  assert.deepEqual(data.onepanel.projects, ['ollama']);
});

test('published ports become browser URLs and skip loopback bindings', () => {
  assert.deepEqual(
    parsePublishedPorts('0.0.0.0:27123-27124->27123-27124/tcp, 5001/tcp, 127.0.0.1:9000->9000/tcp, 0.0.0.0:53->53/udp'),
    [
      { hostIp: '0.0.0.0', hostPort: 27123, containerPort: 27123, protocol: 'tcp' },
      { hostIp: '0.0.0.0', hostPort: 27124, containerPort: 27124, protocol: 'tcp' },
      { hostIp: '127.0.0.1', hostPort: 9000, containerPort: 9000, protocol: 'tcp' },
    ],
  );

  const urls = webUrlsForPorts(
    '0.0.0.0:3000->8080/tcp, 127.0.0.1:9999->9999/tcp, 0.0.0.0:8443->443/tcp',
    '203.0.113.33',
  );
  assert.deepEqual(urls.map(item => item.url), [
    'https://203.0.113.33:8443',
    'http://203.0.113.33:3000',
  ]);
  assert.equal(urls[0].secure, true);
  assert.deepEqual(webUrlsForPorts('80/tcp', '203.0.113.33'), []);

  const data = parseDockerOutput([
    psLine({
      ID: 'abcdef0123456789',
      Names: 'web-1',
      State: 'running',
      Status: 'Up 1 minute',
      Image: 'nginx:alpine',
      Ports: '0.0.0.0:3000->80/tcp',
    }),
  ].join('\n'), { host: '203.0.113.33' });
  assert.equal(data.containers[0].webUrl, 'http://203.0.113.33:3000');
  assert.equal(data.containers[0].webUrls.length, 1);
});

test('compose frontends borrow their project proxy URL when they publish no port', () => {
  const data = parseDockerOutput([
    psLine({
      ID: 'aaaaaaaaaaaa',
      Names: 'dify-nginx-1',
      State: 'running',
      Status: 'Up 1 minute',
      Image: 'nginx:alpine',
      Ports: '0.0.0.0:8080->80/tcp',
    }),
    psLine({
      ID: 'bbbbbbbbbbbb',
      Names: 'dify-web-1',
      State: 'running',
      Status: 'Up 1 minute',
      Image: 'dify-web',
      Ports: '3000/tcp',
    }),
    'SM_LABELS=/dify-nginx-1 {"com.docker.compose.project":"dify","com.docker.compose.service":"nginx"}',
    'SM_LABELS=/dify-web-1 {"com.docker.compose.project":"dify","com.docker.compose.service":"web"}',
  ].join('\n'), { host: '203.0.113.33' });
  const web = data.containers.find(item => item.name === 'dify-web-1');
  assert.equal(web.webUrl, 'http://203.0.113.33:8080');
  const worker = data.containers.find(item => item.name === 'dify-nginx-1');
  assert.equal(worker.webUrl, 'http://203.0.113.33:8080');
});

test('parseDockerOutput marks 1Panel installed from presence marker alone', () => {
  const data = parseDockerOutput([
    'SM_ONEPANEL_PRESENT=1',
    psLine({ ID: 'a1b2c3d4e5f6', Names: 'solo', State: 'running', Status: 'Up 1 minute', Image: 'busybox' }),
  ].join('\n'));
  assert.equal(data.onepanel.installed, true);
  assert.equal(data.onepanel.version, null);
  assert.equal(data.onepanel.port, null);
  assert.equal(data.containers[0].onepanel, false);
});

test('parseDockerOutput reports a missing engine and keeps logs', () => {
  const stdout = [
    'SM_ENGINE_MISSING=1',
    'SM_LOGS_BEGIN',
    'SM_LOG=hello',
    'SM_LOG=world',
    'SM_LOGS_END',
  ].join('\n');
  const data = parseDockerOutput(stdout);
  assert.equal(data.engine.available, false);
  assert.equal(data.engine.version, null);
  assert.deepEqual(data.logs, ['hello', 'world']);
  assert.ok(data.warnings.some(item => /not installed/.test(item)));
});

test('parseDockerOutput tolerates malformed lines and missing labels', () => {
  const data = parseDockerOutput([
    'SM_PS=not json',
    psLine({ ID: 'a1b2c3d4e5f6', Names: 'solo', State: 'running', Status: 'Up 1 minute', Image: 'busybox' }),
  ].join('\n'));
  assert.equal(data.containers.length, 1);
  assert.equal(data.containers[0].compose.project, null);
  assert.equal(data.containers[0].stats.cpuPercent, null);
});

test('container commands validate names and reject unknown actions', () => {
  assert.deepEqual(DOCKER_ACTIONS, ['list', 'start', 'stop', 'restart', 'pause', 'unpause', 'logs', 'upgrade']);
  assert.equal(isMutatingDockerAction('start'), true);
  assert.equal(isMutatingDockerAction('list'), false);
  assert.equal(buildContainerCommand('restart', 'web-1'), 'docker restart web-1');
  assert.throws(() => buildContainerCommand('restart', 'web-1; rm -rf /'), /invalid container name/);
  assert.throws(() => buildContainerCommand('kill', 'web-1'), /unsupported docker action/);
});

test('compose upgrade uses labels, quotes files and rejects unsafe paths', () => {
  const upgrade = buildComposeUpgrade(
    { workingDir: '/srv/shop', configFiles: '/srv/shop/compose.yml,/srv/shop/extra.yml' },
    'web',
  );
  assert.equal(upgrade.cwd, '/srv/shop');
  assert.equal(
    upgrade.command,
    "cd '/srv/shop' && docker compose -f '/srv/shop/compose.yml' -f '/srv/shop/extra.yml' pull web && docker compose -f '/srv/shop/compose.yml' -f '/srv/shop/extra.yml' up -d web",
  );

  const fallback = buildComposeUpgrade({ workingDir: '/srv/shop' }, 'web');
  assert.match(fallback.command, /-f '\/srv\/shop\/docker-compose\.yml' pull web/);

  assert.throws(() => buildComposeUpgrade({ workingDir: 'relative' }, 'web'), /absolute/);
  assert.throws(() => buildComposeUpgrade({ workingDir: '/srv/shop' }, 'web; rm -rf /'), /invalid compose service/);

  const quoted = buildComposeUpgrade({ workingDir: "/srv/o'brien", configFiles: "/srv/o'brien/c.yml" }, 'app');
  assert.match(quoted.command, /cd '\/srv\/o'\\''brien'/);
});

test('docker permission errors and simple listings are recognised', () => {
  assert.equal(
    looksLikeDockerPermissionError({ stderr: 'permission denied while trying to connect to the docker API at unix:///var/run/docker.sock' }),
    true,
  );
  assert.equal(looksLikeDockerPermissionError({ stderr: 'Cannot connect to the Docker daemon' }), false);

  const parsed = parseDockerPsSimple([
    '1Panel-ollama-Sw2r|Up 2 days (healthy)|0.0.0.0:11434->11434/tcp',
    'web-1|Exited (0) 3 hours ago|80/tcp',
    '|',
  ].join('\n'));
  assert.equal(parsed.containers.length, 2);
  assert.equal(parsed.running, 1);
  assert.equal(parsed.containers[0].name, '1Panel-ollama-Sw2r');
  assert.equal(parsed.containers[1].status, 'Exited (0) 3 hours ago');
});
