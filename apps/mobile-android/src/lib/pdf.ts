export interface MobilePdfPageSize {
  width: number;
  height: number;
}

export function calculateMobilePdfPageSize({
  naturalWidth,
  naturalHeight,
  stageWidth,
  zoom,
  horizontalPadding = 28,
}: {
  naturalWidth: number;
  naturalHeight: number;
  stageWidth: number;
  zoom: number;
  horizontalPadding?: number;
}): MobilePdfPageSize {
  const fitWidth = Math.max(1, stageWidth - horizontalPadding);
  const fitScale = fitWidth / Math.max(1, naturalWidth);
  const displayScale = Math.max(0.1, Math.min(6, fitScale * zoom));

  return {
    width: Math.max(1, Math.ceil(naturalWidth * displayScale)),
    height: Math.max(1, Math.ceil(naturalHeight * displayScale)),
  };
}
