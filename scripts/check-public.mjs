import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const root = process.argv[2] || "dist";
const forbidden = [
  /\/Users\//,
  /[A-Z]:\\Users\\/,
  /MUMAKA_(?:CLOUD_SYNC|HANDOFF)/,
  /ratings-backup-\d{4}-\d{2}-\d{2}\.json/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
let count = 0;
async function visit(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const name = join(path, entry.name);
    if (entry.isDirectory()) await visit(name);
    else if (/\.(?:html|js|css|json|map)$/.test(entry.name)) {
      if (entry.name.endsWith(".map"))
        throw new Error("公开产物不应包含source map");
      const content = await readFile(name, "utf8");
      for (const expression of forbidden)
        if (expression.test(content))
          throw new Error(`公开产物包含禁止字段：${name} (${expression})`);
      count++;
    }
  }
}
await visit(root);
console.log(
  `Public artifact scan passed: ${count} files; no private paths, user backup names, synchronization material or private keys.`,
);
