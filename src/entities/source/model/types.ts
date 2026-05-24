export type LocalFileSource = {
  type: "file";
  file: File;
};

export type DirectUrlSource = {
  type: "direct-url";
  url: string;
};

export type SourceInput = LocalFileSource | DirectUrlSource;

export type PreparedSource = {
  sourceType: SourceInput["type"];
  sourceName: string;
  blob: Blob;
  mimeType: string;
  bytes: number;
};
