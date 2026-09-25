import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicMailboxes = new Set(['opencode@microsoft.com', 'opensource@microsoft.com', 'secure@microsoft.com']);
const textExtensions = /\.(?:md|txt|json|jsonl|csv|ts|tsx|js|jsx|mjs|cjs|py|sql|kql|dax|bicep|sh|ps1|yml|yaml|html|css|svg|tmdl|bim|pbism|rdf|toml|ini|xml|lock)$/i;

function withoutGeneratedDeprecationMetadata(path, text, problems) {
  if (!/(?:^|\/)package-lock\.json$/.test(path)) return text;
  try {
    const lock = JSON.parse(text);
    const visit = value => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== 'object') return;
      delete value.deprecated;
      Object.values(value).forEach(visit);
    };
    visit(lock);
    return JSON.stringify(lock);
  } catch {
    problems.push('invalid package lock');
    return text;
  }
}

export function inspectPublicationFile(path, bytes) {
  const problems = [];
  if (/^(?:\.azure|\.prep|\.backup|\.venv|tmp|build|node_modules|\.vscode)\//.test(path)
      || /(?:^|\/)(?:local\.settings\.json|\.env(?:\..*)?)$/.test(path) && !/(?:^|\/)\.env\.example$/.test(path)
      || /\.(?:pptx|potx|docx|xlsx|pdf|har|mp4|webm|log|pem|pfx|key)$/i.test(path)) {
    return ['private or unreviewed artifact'];
  }
  if (/\.gz$/i.test(path)) {
    try { return inspectPublicationFile(path.slice(0, -3), gunzipSync(bytes, { maxOutputLength: 128 * 1024 * 1024 })); }
    catch { return ['unreadable or oversized compressed data']; }
  }
  if (/\.png$/i.test(path)) {
    const approved = ['img/banner-ai-tour-27.png', 'src/act3/web/sql.png'];
    if (!approved.includes(path)) return ['image needs visual privacy review'];
    const types = [];
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = bytes.readUInt32BE(offset);
      types.push(bytes.toString('ascii', offset + 4, offset + 8));
      offset += length + 12;
    }
    if (types.some(type => ['eXIf', 'tEXt', 'iTXt', 'zTXt'].includes(type))) problems.push('image metadata needs review');
    return problems;
  }
  if (bytes.includes(0)) return ['unreviewed binary file'];
  const text = bytes.toString('utf8');
  if (/(?:\/Users|\/home)\/(?=[a-z0-9._-]*[a-z0-9])[a-z0-9._-]+|[a-z]:\\Users\\(?=[a-z0-9._-]*[a-z0-9])[a-z0-9._-]+/i.test(text)) problems.push('personal home path');
  const personalDataText = withoutGeneratedDeprecationMetadata(path, text, problems);
  for (const match of personalDataText.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) {
    const address = match[0].toLowerCase();
    const cosmosUserInfoFixture = path === 'scripts/act3/prepare-staffing-memory.test.mjs'
      && address.endsWith('@example.documents.azure.com');
    if (!publicMailboxes.has(address) && !/@(?:[^@]+\.)?(?:example\.(?:com|org|net)|test|invalid)$/.test(address)
        && !cosmosUserInfoFixture
        && !(path.endsWith('.test.ts') && address === ['secret', 'test-only.openai.azure.com'].join('@'))) {
      problems.push('personal or unreviewed email'); break;
    }
  }
  const publicClientId = '04b07795-8ddb-461a-bbee-02f9e1bf7b46';
  if ([...text.matchAll(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi)]
      .some(([value]) => !value.startsWith('00000000-') && value.toLowerCase() !== publicClientId)) {
    problems.push('unreviewed identifier literal');
  }
  if (/https:\/\/(?:fn|sql|aoai)caldova[a-z0-9]+\./i.test(text)) problems.push('live demo endpoint literal');
  if (path.endsWith('.ipynb')) {
    try {
      const notebook = JSON.parse(text);
      if (notebook.cells.some(cell => cell.cell_type === 'code' && (cell.outputs?.length || cell.execution_count !== null))) problems.push('notebook outputs or execution state');
      if (notebook.cells.some(cell => cell.attachments && Object.keys(cell.attachments).length)) problems.push('notebook attachments');
      if (Object.keys(notebook.metadata || {}).some(key => !['kernelspec', 'language_info'].includes(key))) problems.push('unreviewed notebook metadata');
    } catch { problems.push('invalid notebook'); }
  } else if (!textExtensions.test(path) && !/(?:^|\/)(?:LICENSE(?:-DOCS)?|\.gitignore|\.gitattributes|\.env.example|\.platform)$/.test(path)) {
    problems.push('unreviewed file type');
  }
  return problems;
}

export function publicationFiles(directory = root, base) {
  if (base) {
    const mergeBase = execFileSync('git', ['merge-base', 'HEAD', base], { cwd: directory, encoding: 'utf8' }).trim();
    const changed = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMRT', '-z', mergeBase], { cwd: directory, encoding: 'utf8' });
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: directory, encoding: 'utf8' });
    return [...new Set((changed + untracked).split('\0').filter(Boolean))].sort();
  }
  return [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: directory, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\0')
    .filter(path => path && existsSync(resolve(directory, path))))].sort();
}

if (import.meta.main) {
  const baseIndex = process.argv.indexOf('--base');
  if (baseIndex >= 0 && (!process.argv[baseIndex + 1] || process.argv[baseIndex + 1].startsWith('-'))) throw new Error('--base requires a Git ref.');
  const base = baseIndex < 0 ? undefined : process.argv[baseIndex + 1];
  const files = publicationFiles(root, base);
  const failures = [];
  for (const path of files) {
    const absolute = resolve(root, path);
    try {
      if (lstatSync(absolute).isSymbolicLink()) { failures.push({ path, issues: ['symlink'] }); continue; }
      const issues = inspectPublicationFile(path, readFileSync(absolute));
      if (issues.length) failures.push({ path, issues });
    } catch { failures.push({ path, issues: ['unreadable file'] }); }
  }
  if (failures.length) {
    console.error(JSON.stringify({ passed: false, files: files.length, failures }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(`PASS publication patterns: ${files.length} ${base ? 'PR-changed' : 'Git-eligible'} files. Run the separate secret scan and human review.`);
    if (process.argv.includes('--export')) {
      const output = resolve(root, 'build/publication');
      rmSync(output, { recursive: true, force: true });
      for (const path of files) {
        const destination = resolve(output, path);
        mkdirSync(dirname(destination), { recursive: true });
        cpSync(resolve(root, path), destination);
      }
      console.log('Exported reviewed file set to build/publication; no Git metadata or private state included.');
    }
  }
}