import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const root = new URL('../../', import.meta.url);
const output = new URL('../../build/act3-deploy/', import.meta.url);
rmSync(output, { recursive: true, force: true });
mkdirSync(new URL('src/act3/',output),{recursive:true});
for (const file of ['functions.mjs','sql-resources.mjs','staffing-readiness.mjs','auth.ts','guidance.ts','guidance-adapters.ts','guidance-function.ts','review-api.ts','staffing.ts','staffing-api.ts','staffing-memory.ts','web']) {
  cpSync(new URL(`src/act3/${file}`,root),new URL(`src/act3/${file}`,output),{recursive:true});
}
cpSync(new URL('host.json',root),new URL('host.json',output));
const original = JSON.parse(readFileSync(new URL('package.json',root)));
writeFileSync(new URL('package.json',output),JSON.stringify(original,null,2)+'\n');
cpSync(new URL('package-lock.json',root),new URL('package-lock.json',output));
execFileSync('npm',['ci','--omit=dev','--ignore-scripts'],{cwd:output,stdio:'inherit'});
execFileSync('npm',['audit','--omit=dev','--audit-level=moderate'],{cwd:output,stdio:'inherit'});
console.log(`Deployment package: ${output.pathname}`);