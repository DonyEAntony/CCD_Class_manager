require('dotenv').config();

const fs = require('fs');
const path = require('path');

const unique = (values) => [...new Set(values.filter(Boolean))];

const resolveTargetDir = () => {
  if (process.env.UPLOAD_DIR) {
    return path.resolve(process.env.UPLOAD_DIR);
  }

  return path.resolve(__dirname, '..', 'uploads');
};

const getDefaultLegacyRoots = () => {
  const appDir = path.resolve(__dirname, '..');
  const domainRoot = path.resolve(appDir, '..', '..', '..');

  return [
    path.join(domainRoot, '.builds', 'versions'),
    path.resolve(appDir, '..', '.builds', 'versions'),
    path.resolve(appDir, '..', '..', '.builds', 'versions'),
  ];
};

const getLegacyRoots = () => {
  const configured = (process.env.LEGACY_UPLOAD_ROOTS || '')
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean);

  return unique([...configured, ...getDefaultLegacyRoots()]).map((value) => path.resolve(value));
};

const getUploadDirs = (root) => {
  if (!fs.existsSync(root)) return [];

  const stat = fs.statSync(root);
  if (!stat.isDirectory()) return [];

  if (path.basename(root) === 'uploads') {
    return [root];
  }

  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, 'nodejs', 'uploads'))
    .filter((uploadDir) => fs.existsSync(uploadDir) && fs.statSync(uploadDir).isDirectory());
};

const copyLegacyUploads = () => {
  const targetDir = resolveTargetDir();
  fs.mkdirSync(targetDir, { recursive: true });

  let copied = 0;
  let skipped = 0;
  const sources = unique(getLegacyRoots().flatMap(getUploadDirs));

  for (const sourceDir of sources) {
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;

      const sourcePath = path.join(sourceDir, entry.name);
      const targetPath = path.join(targetDir, entry.name);

      if (fs.existsSync(targetPath)) {
        skipped += 1;
        continue;
      }

      fs.copyFileSync(sourcePath, targetPath);
      copied += 1;
      console.log(`copied ${sourcePath} -> ${targetPath}`);
    }
  }

  console.log(`Legacy upload copy complete. copied=${copied} skipped=${skipped} target=${targetDir}`);
  if (!sources.length) {
    console.log('No legacy upload directories found. Set LEGACY_UPLOAD_ROOTS to a path-delimited list if needed.');
  }
};

copyLegacyUploads();
