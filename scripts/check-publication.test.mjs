import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { inspectPublicationFile, publicationFiles } from './check-publication.mjs';

test('publication gate rejects private artifacts even when tracked', () => {
  for (const path of ['.azure/deployed.json', '.prep/notes.md', '.env', '.env.production', 'tmp/capture.json', 'local.settings.json', 'deck.pptx', 'recording.mp4']) {
    assert.ok(inspectPublicationFile(path, Buffer.from('{}')).length, path);
  }
  assert.deepEqual(inspectPublicationFile('.env.example', Buffer.from('ENTRA_TENANT_ID=\n')), []);
  assert.deepEqual(inspectPublicationFile('src/app/.env.example', Buffer.from('APP_CLIENT_ID=\n')), []);
});

test('publication gate detects PII in text and compressed data without printing values', () => {
  const home = '/' + ['Users', 'private-user', 'project'].join('/');
  const email = ['private.person', 'mail-provider.com'].join('@');
  const cosmosUserInfo = ['https://user:placeholder', 'example.documents.azure.com'].join('@');
  assert.ok(inspectPublicationFile('notes.md', Buffer.from(home)).includes('personal home path'));
  assert.ok(inspectPublicationFile('rows.csv.gz', gzipSync(email)).includes('personal or unreviewed email'));
  assert.deepEqual(inspectPublicationFile('scripts/act3/prepare-staffing-memory.test.mjs', Buffer.from(cosmosUserInfo)), []);
  assert.ok(inspectPublicationFile('notes.md', Buffer.from(cosmosUserInfo)).includes('personal or unreviewed email'));
  assert.deepEqual(inspectPublicationFile('test.json', Buffer.from('{"actorId":"00000000-0000-0000-0000-000000000001"}')), []);
  assert.deepEqual(inspectPublicationFile('notes.md', Buffer.from('/Users/.../project')), []);
});

test('publication gate ignores only generated package deprecation notices', () => {
  const email = ['package.maintainer', 'public-package.dev'].join('@');
  const generated = { packages: { 'node_modules/example': { deprecated: `Contact ${email}` } } };
  const authored = { packages: { 'node_modules/example': { notes: `Contact ${email}` } } };
  assert.deepEqual(inspectPublicationFile('src/app/package-lock.json', Buffer.from(JSON.stringify(generated))), []);
  assert.ok(inspectPublicationFile('src/app/package-lock.json', Buffer.from(JSON.stringify(authored))).includes('personal or unreviewed email'));
  assert.ok(inspectPublicationFile('src/app/package-lock.json', Buffer.from('{')).includes('invalid package lock'));
});

test('publication gate rejects notebook outputs and unknown binaries', () => {
  const notebook = { metadata: {}, cells: [{ cell_type: 'code', source: [], execution_count: 1, outputs: [{ text: 'private output' }] }] };
  assert.ok(inspectPublicationFile('demo.ipynb', Buffer.from(JSON.stringify(notebook))).length);
  notebook.cells[0].execution_count = null;
  notebook.cells[0].outputs = [];
  assert.deepEqual(inspectPublicationFile('demo.ipynb', Buffer.from(JSON.stringify(notebook))), []);
  assert.ok(inspectPublicationFile('unknown.bin', Buffer.from([0, 1, 2])).length);
});

test('publication gate recognizes repository source formats as text', () => {
  for (const path of ['infra/main.bicep', 'src/App.tsx', 'queries/summary.dax', 'uv.lock', 'assets/logo.svg']) {
    assert.deepEqual(inspectPublicationFile(path, Buffer.from('safe authored source\n')), [], path);
  }
});

test('publication inventory excludes tracked files deleted from the working tree', () => {
  const directory = mkdtempSync(join(tmpdir(), 'publication-files-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: directory });
    writeFileSync(join(directory, 'keep.md'), 'keep\n');
    writeFileSync(join(directory, 'deleted.md'), 'delete\n');
    execFileSync('git', ['add', 'keep.md', 'deleted.md'], { cwd: directory });
    unlinkSync(join(directory, 'deleted.md'));
    writeFileSync(join(directory, 'untracked.md'), 'untracked\n');
    assert.deepEqual(publicationFiles(directory), ['keep.md', 'untracked.md']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});