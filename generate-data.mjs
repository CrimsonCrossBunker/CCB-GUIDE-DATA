import AdmZip from "adm-zip";
import gettextParser from "gettext-parser";
import { Octokit } from "octokit";
import { pinyin } from "pinyin-pro";

import {
  buildRecord,
  gitBlobId,
  mergeBuilds,
  parseReleaseBatchSize,
  selectPendingReleases,
  toJedCatalog,
} from "./generator-lib.mjs";

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

const releases = (
  await github.paginate(github.rest.repos.listReleases, {
    ...source,
    per_page: 100,
  })
).filter((release) => !release.draft);
if (!releases.length) {
  throw new Error("The Cleanwater Bomb repository has no releases");
}

const existingBuilds = await readJson("builds.json", []);
const batchSize = parseReleaseBatchSize(process.env.RELEASE_BATCH_SIZE);
const pendingReleases = selectPendingReleases(
  releases,
  existingBuilds,
  batchSize,
);
if (!pendingReleases.length) {
  console.log(`Guide data is already current at ${releases[0].tag_name}`);
  process.exit(0);
}

console.log(
  `Generating ${pendingReleases.length} release(s): ${pendingReleases
    .map((release) => release.tag_name)
    .join(", ")}`,
);
const latestRelease = releases[0];
const generatedBuilds = [];
const treeEntries = [];
const uploadedContent = new Map();

for (const release of pendingReleases) {
  const { gameData, translations } = await generateRelease(release);
  generatedBuilds.push(buildRecord(release, translations));

  const allJson = JSON.stringify({
    build_number: release.tag_name,
    release,
    data: gameData,
  });
  const allJsonSha = await addFile(
    `data/${release.tag_name}/all.json`,
    allJson,
  );
  if (release.tag_name === latestRelease.tag_name) {
    addTreeEntry("data/latest/all.json", allJsonSha);
  }

  for (const [language, catalog] of translations) {
    const json = JSON.stringify(catalog);
    const translationSha = await addFile(
      `data/${release.tag_name}/lang/${language}.json`,
      json,
    );
    if (release.tag_name === latestRelease.tag_name) {
      addTreeEntry(`data/latest/lang/${language}.json`, translationSha);
    }
    if (language.startsWith("zh_")) {
      const pinyinJson = JSON.stringify(toPinyinCatalog(gameData, catalog));
      const pinyinSha = await addFile(
        `data/${release.tag_name}/lang/${language}_pinyin.json`,
        pinyinJson,
      );
      if (release.tag_name === latestRelease.tag_name) {
        addTreeEntry(`data/latest/lang/${language}_pinyin.json`, pinyinSha);
      }
    }
  }
}

const builds = mergeBuilds(existingBuilds, generatedBuilds);
const buildsJson = JSON.stringify(builds);
const buildsSha = await addFile("all-builds.json", buildsJson);
addTreeEntry("builds.json", buildsSha);

async function addFile(path, content) {
  const contentId = gitBlobId(content);
  let sha = uploadedContent.get(contentId);
  if (!sha) {
    console.log(`Uploading ${path}`);
    const { data: blob } = await retry(() =>
      github.rest.git.createBlob({
        ...destination,
        content,
        encoding: "utf-8",
      }),
    );
    sha = blob.sha;
    uploadedContent.set(contentId, sha);
  }
  addTreeEntry(path, sha);
  return sha;
}

function addTreeEntry(path, sha) {
  treeEntries.push({ path, mode: "100644", type: "blob", sha });
}

const branchState = await getDataBranchState();
const { data: tree } = await retry(() =>
  github.rest.git.createTree({
    ...destination,
    base_tree: branchState?.treeSha,
    tree: treeEntries,
  }),
);
const { data: commit } = await github.rest.git.createCommit({
  ...destination,
  message:
    pendingReleases.length === 1
      ? `Generate guide data for ${pendingReleases[0].tag_name}`
      : `Generate ${pendingReleases.length} guide data releases`,
  tree: tree.sha,
  parents: branchState ? [branchState.commitSha] : [],
  author: {
    name: "CCB Guide Data Bot",
    email: "ccb-guide-data@users.noreply.github.com",
  },
});
await github.rest.git.updateRef({
  ...destination,
  ref: `heads/${dataBranch}`,
  sha: commit.sha,
  force: false,
});
console.log(
  `Published ${pendingReleases.length} release(s) to ${destination.owner}/${destination.repo}`,
);

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

async function getDataBranchState() {
  try {
    const { data: ref } = await github.rest.git.getRef({
      ...destination,
      ref: `heads/${dataBranch}`,
    });
    const { data: commit } = await github.rest.git.getCommit({
      ...destination,
      commit_sha: ref.object.sha,
    });
    return {
      commitSha: commit.sha,
      treeSha: commit.tree.sha,
    };
  } catch (error) {
    if (error?.status === 404) return null;
    throw error;
  }
}

async function generateRelease(release) {
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

  return { gameData, translations };
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
    if (!name) continue;
    const translated = catalog[name];
    if (!translated) continue;
    if (Array.isArray(translated)) {
      output[name] = translated
        .filter((value) => typeof value === "string")
        .map(pinyinify);
    } else if (typeof translated === "string") {
      output[name] = pinyinify(translated);
    }
  }
  return output;
}

function pinyinify(text) {
  const result = pinyin(text, { toneType: "none", type: "array" });
  return Array.isArray(result) ? result.join(" ") : String(result);
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
