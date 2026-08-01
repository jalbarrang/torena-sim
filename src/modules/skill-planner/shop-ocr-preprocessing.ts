export type ImageDimensions = {
  width: number;
  height: number;
};

export type PixelRectangle = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ShopRowCrop = {
  rowIndex: number;
  name: PixelRectangle;
  hint: PixelRectangle;
};

export const SHOP_OCR_IMAGE_LIMITS = {
  maxWidth: 5_000,
  maxHeight: 5_000,
  maxPixels: 20_000_000,
  maxCropPixels: 6_000_000,
  thumbnailEdge: 96
} as const;

const SHOP_ROW_COUNT = 3;
const ROW_STRIDE_BY_WIDTH = 0.282;

function clampRectangle(rectangle: PixelRectangle, dimensions: ImageDimensions): PixelRectangle {
  const left = Math.max(0, Math.min(dimensions.width - 1, Math.round(rectangle.left)));
  const top = Math.max(0, Math.min(dimensions.height - 1, Math.round(rectangle.top)));
  const width = Math.max(1, Math.min(dimensions.width - left, Math.round(rectangle.width)));
  const height = Math.max(1, Math.min(dimensions.height - top, Math.round(rectangle.height)));

  return { left, top, width, height };
}

export function assertShopScreenshotDimensions(dimensions: ImageDimensions): void {
  const { width, height } = dimensions;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new TypeError('The screenshot has invalid image dimensions.');
  }
  if (width > SHOP_OCR_IMAGE_LIMITS.maxWidth || height > SHOP_OCR_IMAGE_LIMITS.maxHeight) {
    throw new Error(
      `Screenshot dimensions must be ${SHOP_OCR_IMAGE_LIMITS.maxWidth} × ${SHOP_OCR_IMAGE_LIMITS.maxHeight} pixels or smaller.`
    );
  }
  if (width * height > SHOP_OCR_IMAGE_LIMITS.maxPixels) {
    throw new Error('Screenshot dimensions are too large for safe on-device processing.');
  }
}

/**
 * The shop has three visible cards. Their typography scales with screenshot width,
 * while the final card may be vertically clipped, so width-relative rows are more
 * stable than splitting the current image height into thirds.
 */
export function getShopRowCrops(dimensions: ImageDimensions): Array<ShopRowCrop> {
  if (dimensions.width <= 0 || dimensions.height <= 0) return [];

  return Array.from({ length: SHOP_ROW_COUNT }, (_, rowIndex) => rowIndex)
    .filter(
      (rowIndex) =>
        rowIndex * dimensions.width * ROW_STRIDE_BY_WIDTH + dimensions.width * 0.012 <
        dimensions.height
    )
    .map((rowIndex) => {
      const rowTop = rowIndex * dimensions.width * ROW_STRIDE_BY_WIDTH;

      return {
        rowIndex,
        name: clampRectangle(
          {
            left: dimensions.width * 0.155,
            top: rowTop + dimensions.width * 0.012,
            width: dimensions.width * 0.56,
            height: dimensions.width * 0.085
          },
          dimensions
        ),
        hint: clampRectangle(
          {
            left: dimensions.width * 0.725,
            top: rowTop + dimensions.width * 0.012,
            width: dimensions.width * 0.24,
            height: dimensions.width * 0.13
          },
          dimensions
        )
      };
    });
}

export async function decodeShopScreenshot(image: Blob | File): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== 'function') {
    throw new TypeError('This browser cannot prepare screenshots for local OCR.');
  }

  return createImageBitmap(image);
}

function getCropScale(rectangle: PixelRectangle): number {
  return Math.min(4, Math.max(2, Math.ceil(96 / rectangle.height)));
}

export function getPreprocessedShopCropPixels(rectangle: PixelRectangle): number {
  const scale = getCropScale(rectangle);
  return rectangle.width * scale * rectangle.height * scale;
}

/** Creates one short-lived, upscaled grayscale crop. Callers release it after each OCR job. */
export function createPreprocessedShopCrop(
  image: CanvasImageSource,
  rectangle: PixelRectangle
): HTMLCanvasElement {
  const scale = getCropScale(rectangle);
  const cropPixels = getPreprocessedShopCropPixels(rectangle);
  if (cropPixels > SHOP_OCR_IMAGE_LIMITS.maxCropPixels) {
    throw new Error('A screenshot crop is too large for safe on-device processing.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = rectangle.width * scale;
  canvas.height = rectangle.height * scale;

  const context = canvas.getContext('2d', { willReadFrequently: false });
  if (!context) {
    releaseShopOcrCrop(canvas);
    throw new Error('This browser cannot prepare screenshot crops for local OCR.');
  }

  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.filter = 'grayscale(1) contrast(1.8)';
  context.drawImage(
    image,
    rectangle.left,
    rectangle.top,
    rectangle.width,
    rectangle.height,
    0,
    0,
    canvas.width,
    canvas.height
  );
  context.filter = 'none';

  return canvas;
}

export async function createShopThumbnailPreview(image: File): Promise<string> {
  const bitmap = await decodeShopScreenshot(image);
  try {
    assertShopScreenshotDimensions(bitmap);
    const scale = Math.min(
      1,
      SHOP_OCR_IMAGE_LIMITS.thumbnailEdge / Math.max(bitmap.width, bitmap.height)
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    try {
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser cannot create screenshot previews.');
      context.drawImage(bitmap, 0, 0, width, height);
      const thumbnail = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) =>
            blob
              ? resolve(blob)
              : reject(new Error('This browser cannot create screenshot previews.')),
          'image/webp',
          0.8
        );
      });
      return URL.createObjectURL(thumbnail);
    } finally {
      releaseShopOcrCrop(canvas);
    }
  } finally {
    bitmap.close();
  }
}

export function releaseShopOcrCrop(canvas: HTMLCanvasElement): void {
  canvas.width = 1;
  canvas.height = 1;
}
