"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

async function main() {
  const requests = [];
  const photos = [{
    ref: "TEST-001",
    categorie: "eprouvettes",
    blob: new Blob(["photo"], { type: "image/jpeg" }),
    mediaUuid: "11111111-1111-4111-8111-111111111111",
    metadata: { numeroEchantillon: "TEST-001-E1-02" },
  }];
  const context = {
    Blob,
    Promise,
    console,
    FileReader: class FileReader {
      readAsDataURL() {
        this.result = "data:image/jpeg;base64,cGhvdG8=";
        this.onload();
      }
    },
    CAEK_CONFIG: { SUPABASE_URL: "https://example.invalid", SUPABASE_ANON: "test" },
    CAEKServer: { configured: () => true },
    CAEKOperateurs: { token: () => "x" },
    CAEKDB: {
      getPhotosByRef: async () => photos,
      updatePhoto: async () => ({ ok: true }),
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  };
  context.window = context;
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, "..", "js", "medias.js"), "utf8");
  vm.runInContext(source, context, { filename: "medias.js" });

  const result = await context.CAEKMedias.uploadForRef("TEST-001");
  assert.equal(result.incomplet, false);
  assert.equal(result.medias.length, 1);
  assert.equal(result.medias[0].numeroEchantillon, "TEST-001-E1-02");
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.numeroEchantillon, "TEST-001-E1-02");
  assert.equal(body.mediaUuid, photos[0].mediaUuid);
  assert.match(body.storagePath, /eprouvettes_11111111-1111-4111-8111-111111111111\.jpg$/);

  let fallbackCalls = 0;
  let registered = null;
  context.fetch = async () => {
    fallbackCalls += 1;
    if (fallbackCalls === 1) {
      return { ok: false, status: 503, json: async () => ({ ok: false }) };
    }
    return { ok: true, status: 200, text: async () => "" };
  };
  context.CAEKServer.mediaRegister = async (_token, media) => {
    registered = media;
    return { ok: true };
  };
  const fallbackResult = await context.CAEKMedias.uploadForRef("TEST-001");
  assert.equal(fallbackResult.incomplet, false);
  assert.equal(registered.numeroEchantillon, "TEST-001-E1-02");

  const migration = fs.readFileSync(path.join(__dirname, "..", "supabase", "migrations",
    "20260929140000_media_numero_echantillon.sql"), "utf8");
  assert.match(migration, /add column if not exists numero_echantillon text/);
  assert.match(migration, /numero_echantillon = coalesce/);
  console.log("media_sample_traceability: OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
