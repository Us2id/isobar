// Reads one GRIB2 message: grid templates 3.0 and 3.30, data templates 5.0 and 5.3, no bitmap.
// That covers the NOAA fields this site uses. Anything else throws rather than returning wrong numbers.
export function decodeGrib2(bytes) {
  const u16 = (a, o) => (a[o] << 8) | a[o + 1];
  const u32 = (a, o) => a[o] * 16777216 + ((a[o + 1] << 16) | (a[o + 2] << 8) | a[o + 3]);
  const sm = (a, o, n) => { let v = a[o] & 0x7f; for (let i = 1; i < n; i++) v = v * 256 + a[o + i]; return a[o] & 0x80 ? -v : v; };
  const sec = {};
  let p = 16;
  while (!(bytes[p] === 55 && bytes[p + 1] === 55 && bytes[p + 2] === 55 && bytes[p + 3] === 55)) {
    const len = u32(bytes, p);
    sec[bytes[p + 4]] = bytes.subarray(p, p + len);
    p += len;
  }
  const s3 = sec[3], s5 = sec[5], d = sec[7].subarray(5);
  if (sec[6][5] !== 255) throw new Error("bitmap not supported");
  const grid = { template3: u16(s3, 12), nx: u32(s3, 30), ny: u32(s3, 34) };
  if (grid.template3 === 0) {
    Object.assign(grid, { la1: sm(s3, 46, 4) / 1e6, lo1: sm(s3, 50, 4) / 1e6, flags: s3[54], dx: u32(s3, 63) / 1e6, dy: u32(s3, 67) / 1e6 });
  } else if (grid.template3 === 30) {
    Object.assign(grid, { la1: sm(s3, 38, 4) / 1e6, lo1: sm(s3, 42, 4) / 1e6, flags: s3[46], lov: sm(s3, 51, 4) / 1e6, dx: sm(s3, 55, 4) / 1e3, dy: sm(s3, 59, 4) / 1e3, lat0: sm(s3, 65, 4) / 1e6 });
  } else throw new Error("grid template " + grid.template3);
  grid.gridRelative = !!(grid.flags & 8);
  const npts = u32(s5, 5), t5 = u16(s5, 9);
  const R = new DataView(s5.buffer, s5.byteOffset + 11, 4).getFloat32(0);
  const bs = 2 ** sm(s5, 15, 2), ds = 10 ** sm(s5, 17, 2), nb = s5[19];
  const rd = (pos, n) => {
    if (n === 0) return 0;
    let i = pos >>> 3;
    const off = pos & 7, avail = 8 - off, b = d[i++] & (0xff >>> off);
    if (n <= avail) return b >>> (avail - n);
    let v = b, need = n - avail;
    while (need >= 8) { v = v * 256 + d[i++]; need -= 8; }
    if (need > 0) v = v * (1 << need) + (d[i] >>> (8 - need));
    return v;
  };
  const out = new Float32Array(npts);
  if (t5 === 0) {
    for (let i = 0, pos = 0; i < npts; i++, pos += nb) out[i] = (R + rd(pos, nb) * bs) / ds;
  } else if (t5 === 3) {
    if (s5[22] !== 0) throw new Error("missing-value management not supported");
    const NG = u32(s5, 31), wref = s5[35], wb = s5[36], lref = u32(s5, 37), linc = s5[41], llast = u32(s5, 42), lb = s5[46], order = s5[47], o = s5[48];
    const g1 = sm(d, 0, o); let k = o, g2 = 0;
    if (order === 2) { g2 = sm(d, k, o); k += o; }
    const gm = sm(d, k, o); k += o;
    let pos = k * 8;
    const refs = new Int32Array(NG), ws = new Int32Array(NG), ls = new Int32Array(NG);
    for (let g = 0; g < NG; g++, pos += nb) refs[g] = rd(pos, nb);
    pos = ((pos + 7) >>> 3) << 3;
    for (let g = 0; g < NG; g++, pos += wb) ws[g] = wref + rd(pos, wb);
    pos = ((pos + 7) >>> 3) << 3;
    for (let g = 0; g < NG; g++, pos += lb) ls[g] = lref + rd(pos, lb) * linc;
    pos = ((pos + 7) >>> 3) << 3;
    ls[NG - 1] = llast;
    const X = new Int32Array(npts);
    let n = 0;
    for (let g = 0; g < NG; g++) {
      const r = refs[g], w = ws[g], l = ls[g];
      if (w === 0) { X.fill(r, n, n + l); n += l; }
      else for (let i = 0; i < l; i++, pos += w) X[n++] = r + rd(pos, w);
    }
    if (n !== npts) throw new Error("group lengths sum to " + n + ", expected " + npts);
    if (order === 1) { X[0] = g1; for (let i = 1; i < npts; i++) X[i] = X[i] + gm + X[i - 1]; }
    else if (order === 2) { X[0] = g1; X[1] = g2; for (let i = 2; i < npts; i++) X[i] = X[i] + gm + 2 * X[i - 1] - X[i - 2]; }
    else throw new Error("spatial differencing order " + order);
    for (let i = 0; i < npts; i++) out[i] = (R + X[i] * bs) / ds;
  } else throw new Error("data template " + t5);
  return { ...grid, template5: t5, npts, values: out };
}
