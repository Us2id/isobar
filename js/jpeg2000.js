// Decodes JPEG 2000 images as whole numbers. GRIB2 data template 5.40 packs ocean fields this way.
// The decoder only loads when one of those fields is first needed.
let decoder = null;

export async function loadJpeg2000() {
  if (!decoder) {
    const { JpxImage } = await import('../vendor/jpx/jpx.js');
    decoder = (bytes) => {
      const image = new JpxImage();
      image.parse(bytes);
      if (image.tiles.length !== 1) throw new Error(`Expected one image tile, got ${image.tiles.length}`);
      return image.tiles[0].items;
    };
  }
  return decoder;
}
