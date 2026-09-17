import { Asset } from "expo-asset";
import { File } from "expo-file-system";
import { PLYLoader, SplatLoader } from "../visionary/io/static-loaders";
import { MAX_FILE_BYTES } from "../visionary/memory";
import { throwIfAborted, type LoadingOptions } from "../visionary/io/types";
import type { SceneSource } from "./types";

export async function loadScene(source: SceneSource, options: LoadingOptions) {
  let uri: string;
  let filename: string;
  if (source.kind === "asset") {
    options.onProgress?.({ progress: 0, stage: "Opening bundled scene" });
    const asset = await Asset.fromModule(source.asset).downloadAsync();
    if (!asset.localUri) throw new Error("The bundled scene is unavailable locally.");
    uri = asset.localUri;
    filename = `${asset.name}.${asset.type}`;
  } else {
    uri = source.uri;
    filename = source.name;
    if (source.size !== undefined && source.size > MAX_FILE_BYTES) throw new Error("Files must be at most 128 MiB.");
  }
  throwIfAborted(options.signal);
  const extension = filename.toLowerCase();
  if (extension.endsWith(".compressed.ply") || (!extension.endsWith(".ply") && !extension.endsWith(".splat"))) {
    throw new Error("Choose a standard Gaussian .ply or .splat file.");
  }
  const file = new File(uri);
  if (!file.exists) throw new Error("The selected file is no longer available. Select it again.");
  if (file.size > MAX_FILE_BYTES) throw new Error("Files must be at most 128 MiB.");
  options.onProgress?.({ progress: 0, stage: "Reading scene" });
  const buffer = await file.arrayBuffer();
  throwIfAborted(options.signal);
  return extension.endsWith(".ply")
    ? new PLYLoader().loadBuffer(buffer, options)
    : new SplatLoader().loadBuffer(buffer, options);
}
