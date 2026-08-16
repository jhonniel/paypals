declare module "heic-convert" {
  type HeicConvertOptions = {
    buffer: ArrayBuffer | Buffer | Uint8Array;
    format: "JPEG" | "PNG";
    quality?: number;
  };

  type HeicConvertAllItem = {
    convert: () => Promise<ArrayBuffer>;
  };

  function heicConvert(options: HeicConvertOptions): Promise<ArrayBuffer>;
  namespace heicConvert {
    function all(options: HeicConvertOptions): Promise<HeicConvertAllItem[]>;
  }

  export default heicConvert;
}
