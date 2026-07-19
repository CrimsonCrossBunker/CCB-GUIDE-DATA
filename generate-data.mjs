import AdmZip from "adm-zip";
import gettextParser from "gettext-parser";
import { Octokit } from "octokit";
import { pinyin } from "pinyin-pro";

const source = {
  owner: "CrimsonCrossBunker",
  repo: "Cataclysm-Cleanwater-Bomb",
};
const destination = {
  owner: "CrimsonCrossBunker",
  repo: "CCB-GUIDE-DATA",
};
const dataBranch = "main";

const github = new Octokit({ auth: process.env.GITHUB_TOKEN });

if (!process.env.GITHUB_TOKEN) {
  throw new Error("GITHUB_TOKEN is required");
}

const { data: releases } = await github.rest.repos.listReleases({
  ...source,
  per_page: 10,
});
const release = releases[0];
if (!release) {
  throw new Error("The Cleanwater Bomb repository has no releases");
}

const existingBuilds = await readJson("builds.json", []);
if (
  existingBuilds[0]?.build_number === release.tag_name &&
  existingBuilds[0]?.langs?.includes("zh_CN")
) {
  console.log(`Guide data is already current at ${release.tag_name}`);
  process.exit(0);
}

console.log(`Generating guide data for ${release.tag_name}`);
const { data: archive } = await github.rest.repos.downloadZipballArchive({
  ...source,
  ref: release.tag_name,
});
const zip = new AdmZip(Buffer.from(archive));

const gameData = [];
for (const entry of zip.getEntries()) {
  if (entry.isDirectory) continue;
  const filename = stripArchiveRoot(entry.entryName);
  if (!/^data\/json\/.*\.json$/i.test(filename)) continue;
  const text = entry.getData().toString("utf8");
  for (const record of extractObjects(text)) {
    record.value.__filename = `${filename}#L${record.start}-L${record.end}`;
    gameData.push(record.value);
  }
}
console.log(`Collected ${gameData.length} base-game JSON objects`);

const translations = new Map();
collectTranslations(zip, translations);
if (!translations.has("zh_CN")) {
  console.log(
    "Release archive lacks zh_CN; checking complete Actions artifacts",
  );
  const { data: artifactList } =
    await github.rest.actions.listArtifactsForRepo({
      ...source,
      name: "translations",
      per_page: 100,
    });
  const artifact = artifactList.artifacts.find(
    (candidate) =>
      !candidate.expired &&
      candidate.workflow_run?.head_sha === release.target_commitish,
  );
  if (artifact) {
    const { data: artifactArchive } =
      await github.rest.actions.downloadArtifact({
        ...source,
        artifact_id: artifact.id,
        archive_format: "zip",
      });
    collectTranslations(
      new AdmZip(Buffer.from(artifactArchive)),
      translations,
    );
  } else {
    console.warn(
      `No translations artifact matched ${release.target_commitish}`,
    );
  }
}
console.log(`Collected ${translations.size} language catalogs`);

const build = {
  build_number: release.tag_name,
  prerelease: release.prerelease,
  created_at: release.created_at,
  langs: [...translations.keys()].sort(),
};
const allJson = JSON.stringify({
  build_number: release.tag_name,
  release,
  data: gameData,
});

const files = new Map([
  ["all-builds.json", JSON.stringify([build])],
  ["builds.json", JSON.stringify([build])],
  [`data/${release.tag_name}/all.json`, allJson],
  ["data/latest/all.json", allJson],
]);

for (const [language, catalog] of translations) {
  const json = JSON.stringify(catalog);
  files.set(`data/${release.tag_name}/lang/${language}.json`, json);
  files.set(`data/latest/lang/${language}.json`, json);
  if (language.startsWith("zh_")) {
    const pinyinJson = JSON.stringify(toPinyinCatalog(gameData, catalog));
    files.set(
      `data/${release.tag_name}/lang/${language}_pinyin.json`,
      pinyinJson,
    );
    files.set(`data/latest/lang/${language}_pinyin.json`, pinyinJson);
  }
}

const treeEntries = [];
for (const [path, content] of files) {
  console.log(`Uploading ${path}`);
  const { data: blob } = await retry(() =>
    github.rest.git.createBlob({
      ...destination,
      content,
      encoding: "utf-8",
    }),
  );
  treeEntries.push({ path, mode: "100644", type: "blob", sha: blob.sha });
}

const { data: tree } = await retry(() =>
  github.rest.git.createTree({ ...destination, tree: treeEntries }),
);
const { data: commit } = await github.rest.git.createCommit({
  ...destination,
  message: `Generate guide data for ${release.tag_name}`,
  tree: tree.sha,
  parents: [],
  author: {
    name: "CCB Guide Data Bot",
    email: "ccb-guide-data@users.noreply.github.com",
  },
});
await github.rest.git.updateRef({
  ...destination,
  ref: `heads/${dataBranch}`,
  sha: commit.sha,
  force: true,
});
console.log(`Published ${release.tag_name} to ${destination.owner}/${destination.repo}`);

async function readJson(path, fallback) {
  try {
    const response = await github.request(
      "GET /repos/{owner}/{repo}/contents/{path}",
      {
        ...destination,
        path,
        ref: dataBranch,
        headers: { accept: "application/vnd.github.raw+json" },
      },
    );
    const text = Buffer.isBuffer(response.data)
      ? response.data.toString("utf8")
      : String(response.data);
    return JSON.parse(text);
  } catch (error) {
    if (error?.status === 404) return fallback;
    throw error;
  }
}

function stripArchiveRoot(filename) {
  return filename.replaceAll("\\", "/").split("/").slice(1).join("/");
}

function collectTranslations(archive, output) {
  for (const entry of archive.getEntries()) {
    if (entry.isDirectory) continue;
    const filename = entry.entryName.replaceAll("\\", "/");
    const match = /(?:^|\/)lang\/po\/([^/]+)\.po$/i.exec(filename);
    if (!match) continue;
    const language = match[1];
    const catalog = gettextParser.po.parse(entry.getData());
    output.set(language, toJedCatalog(catalog));
  }
}

function extractObjects(text) {
  const records = [];
  let depth = 0;
  let start = -1;
  let startLine = 0;
  let line = 1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
    } else if (character === '"') {
      inString = true;
    } else if (character === "{") {
      if (depth === 0) {
        start = index;
        startLine = line;
      }
      depth++;
    } else if (character === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        records.push({
          value: JSON.parse(text.slice(start, index + 1)),
          start: startLine,
          end: line,
        });
        start = -1;
      }
    }
    if (character === "\n") line++;
  }
  return records;
}

function toJedCatalog(parsed) {
  const catalog = {
    "": {
      language: parsed.headers.Language ?? "",
      "plural-forms": parsed.headers["Plural-Forms"] ?? "",
    },
  };
  for (const [context, messages] of Object.entries(parsed.translations)) {
    for (const [messageId, message] of Object.entries(messages)) {
      if (!messageId || message.msgstr.every((value) => !value)) continue;
      const key = context ? `${context}\u0004${messageId}` : messageId;
      catalog[key] =
        message.msgstr.length === 1 ? message.msgstr[0] : message.msgstr;
    }
  }
  return catalog;
}

function toPinyinCatalog(data, catalog) {
  const output = { "": catalog[""] };
  const names = new Set();
  for (const object of data) {
    const name = object?.name;
    if (typeof name === "string") names.add(name);
    else if (name && typeof name === "object") {
      for (const key of ["str", "str_sp", "str_pl"]) {
        if (typeof name[key] === "string") names.add(name[key]);
      }
    }
  }
  for (const name of names) {
    const translated = catalog[name];
    if (!translated) continue;
    output[name] = Array.isArray(translated)
      ? translated.map(pinyinify)
      : pinyinify(translated);
  }
  return output;
}

function pinyinify(text) {
  return pinyin(text, { toneType: "none", type: "array" }).join(" ");
}

async function retry(operation, attempts = 6) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
  }
  throw lastError;
}
