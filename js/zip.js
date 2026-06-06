/* Fiche de coulage terrain - CAEK
   zip.js - Mini ecrivain ZIP (methode "store", sans compression).
   Utilise pour assembler xlsx + photos en un seul fichier nomme par reference.
   ============================================================ */
var CAEKZip = (function () {
  "use strict";
  var T = null;
  function table() {
    if (T) { return T; }
    T = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) { c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); }
      T[n] = c >>> 0;
    }
    return T;
  }
  function crc32(u8) {
    var c = 0xffffffff, t = table();
    for (var i = 0; i < u8.length; i++) { c = t[(c ^ u8[i]) & 0xff] ^ (c >>> 8); }
    return (c ^ 0xffffffff) >>> 0;
  }
  function strBytes(s) { return new TextEncoder().encode(s); }
  function dosTime(d) { return ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() >>> 1) & 31); }
  function dosDate(d) { return (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31); }
  function blobToU8(b) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(new Uint8Array(fr.result)); };
      fr.onerror = function () { rej(fr.error); };
      fr.readAsArrayBuffer(b);
    });
  }
  // files: [{ name: string, data: Uint8Array | Blob }]
  function create(files) {
    var now = new Date(), t = dosTime(now), d = dosDate(now);
    var local = [], central = [], offset = 0;
    var p = Promise.resolve();
    files.forEach(function (f) {
      p = p.then(function () {
        return (f.data instanceof Uint8Array) ? Promise.resolve(f.data) : blobToU8(f.data);
      }).then(function (u8) {
        var name = strBytes(f.name);
        var crc = crc32(u8), sz = u8.length;
        var lh = new Uint8Array(30 + name.length);
        var dv = new DataView(lh.buffer);
        dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true);
        dv.setUint16(8, 0, true); dv.setUint16(10, t, true); dv.setUint16(12, d, true);
        dv.setUint32(14, crc, true); dv.setUint32(18, sz, true); dv.setUint32(22, sz, true);
        dv.setUint16(26, name.length, true); dv.setUint16(28, 0, true);
        lh.set(name, 30);
        local.push(lh); local.push(u8);
        var ch = new Uint8Array(46 + name.length);
        var cv = new DataView(ch.buffer);
        cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
        cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true); cv.setUint16(12, t, true); cv.setUint16(14, d, true);
        cv.setUint32(16, crc, true); cv.setUint32(20, sz, true); cv.setUint32(24, sz, true);
        cv.setUint16(28, name.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
        cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true);
        cv.setUint32(42, offset, true);
        ch.set(name, 46);
        central.push(ch);
        offset += lh.length + u8.length;
      });
    });
    return p.then(function () {
      var cdSize = 0;
      central.forEach(function (c) { cdSize += c.length; });
      var end = new Uint8Array(22);
      var ev = new DataView(end.buffer);
      ev.setUint32(0, 0x06054b50, true); ev.setUint16(4, 0, true); ev.setUint16(6, 0, true);
      ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
      ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true); ev.setUint16(20, 0, true);
      var parts = local.concat(central); parts.push(end);
      return new Blob(parts, { type: "application/zip" });
    });
  }
  return { create: create };
})();
