export const DATA_FORMAT_VERSION = 2;

export function toJedCatalog(parsed) {
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
      const isPlural =
        Boolean(message.msgid_plural) || message.msgstr.length > 1;
      catalog[key] = isPlural ? message.msgstr : message.msgstr[0];
    }
  }
  return catalog;
}

export function buildRecord(release, translations) {
  return {
    build_number: release.tag_name,
    prerelease: release.prerelease,
    created_at: release.created_at,
    langs: [...translations.keys()].sort(),
    data_format_version: DATA_FORMAT_VERSION,
  };
}

export function mergeBuilds(existingBuilds, generatedBuilds) {
  const buildsByNumber = new Map(
    existingBuilds.map((build) => [build.build_number, build]),
  );
  for (const build of generatedBuilds) {
    buildsByNumber.set(build.build_number, build);
  }
  return [...buildsByNumber.values()].sort(
    (a, b) =>
      Date.parse(b.created_at) - Date.parse(a.created_at) ||
      b.build_number.localeCompare(a.build_number),
  );
}

export function selectPendingReleases(releases, existingBuilds, batchSize) {
  const buildsByNumber = new Map(
    existingBuilds.map((build) => [build.build_number, build]),
  );
  return releases
    .filter(
      (release) =>
        buildsByNumber.get(release.tag_name)?.data_format_version !==
        DATA_FORMAT_VERSION,
    )
    .slice(0, batchSize);
}

export function parseReleaseBatchSize(value, fallback = 4, maximum = 20) {
  const parsed = value == null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(
      `RELEASE_BATCH_SIZE must be an integer between 1 and ${maximum}`,
    );
  }
  return parsed;
}
