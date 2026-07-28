import assert from "node:assert/strict";
import test from "node:test";
import gettextParser from "gettext-parser";

import {
  DATA_FORMAT_VERSION,
  buildRecord,
  mergeBuilds,
  parseReleaseBatchSize,
  selectPendingReleases,
  toJedCatalog,
} from "../generator-lib.mjs";

test("toJedCatalog preserves a one-form plural as an array", () => {
  const parsed = gettextParser.po.parse(
    Buffer.from(`msgid ""
msgstr ""
"Language: zh_CN\\n"
"Plural-Forms: nplurals=1; plural=0;\\n"
"Content-Type: text/plain; charset=UTF-8\\n"

msgid ".22 LR"
msgid_plural ".22 LR"
msgstr[0] ".22 LR 弹"

msgid "flashlight"
msgstr "手电筒"
`),
  );
  const catalog = toJedCatalog(parsed);

  assert.deepEqual(catalog[".22 LR"], [".22 LR 弹"]);
  assert.equal(catalog.flashlight, "手电筒");
});

test("toJedCatalog retains context and ignores empty translations", () => {
  const catalog = toJedCatalog({
    headers: {},
    translations: {
      menu: {
        Open: {
          msgid: "Open",
          msgstr: ["打开"],
        },
        Missing: {
          msgid: "Missing",
          msgstr: [""],
        },
      },
    },
  });

  assert.equal(catalog["menu\u0004Open"], "打开");
  assert.equal("menu\u0004Missing" in catalog, false);
});

test("selectPendingReleases includes missing and outdated builds", () => {
  const releases = [
    release("new"),
    release("outdated"),
    release("current"),
    release("older"),
  ];
  const builds = [
    { ...build("outdated"), data_format_version: DATA_FORMAT_VERSION - 1 },
    { ...build("current"), data_format_version: DATA_FORMAT_VERSION },
  ];

  assert.deepEqual(
    selectPendingReleases(releases, builds, 2).map(
      (candidate) => candidate.tag_name,
    ),
    ["new", "outdated"],
  );
});

test("mergeBuilds replaces regenerated builds and keeps newest first", () => {
  const translations = new Map([["zh_CN", {}]]);
  const regenerated = buildRecord(
    release("new", "2026-07-28T04:26:07Z"),
    translations,
  );
  const builds = mergeBuilds(
    [
      build("old", "2026-07-26T04:26:07Z"),
      build("new", "2026-07-27T04:26:07Z"),
    ],
    [regenerated],
  );

  assert.deepEqual(
    builds.map((candidate) => candidate.build_number),
    ["new", "old"],
  );
  assert.deepEqual(builds[0].langs, ["zh_CN"]);
  assert.equal(builds[0].data_format_version, DATA_FORMAT_VERSION);
});

test("parseReleaseBatchSize validates workflow input", () => {
  assert.equal(parseReleaseBatchSize(undefined), 4);
  assert.equal(parseReleaseBatchSize("12"), 12);
  assert.throws(() => parseReleaseBatchSize("0"), /between 1 and 20/);
  assert.throws(() => parseReleaseBatchSize("21"), /between 1 and 20/);
  assert.throws(() => parseReleaseBatchSize("many"), /between 1 and 20/);
});

function release(tag_name, created_at = "2026-07-28T04:26:07Z") {
  return {
    tag_name,
    prerelease: true,
    created_at,
  };
}

function build(build_number, created_at = "2026-07-28T04:26:07Z") {
  return {
    build_number,
    prerelease: true,
    created_at,
    langs: [],
  };
}
