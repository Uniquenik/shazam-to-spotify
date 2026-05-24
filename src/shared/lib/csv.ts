import { ExportRow } from "../../entities/track-match/model/types";

const HEADERS = [
  "Title",
  "Artist",
  "Start Time",
  "End Time",
  "Confidence",
  "Needs Review",
  "Source",
];

function escapeCell(value: string) {
  const escaped = value.replaceAll("\"", "\"\"");
  return `"${escaped}"`;
}

export function downloadCsv(filename: string, rows: ExportRow[]) {
  const lines = [
    HEADERS.join(","),
    ...rows.map((row) =>
      [
        row.title,
        row.artist,
        row.startTime,
        row.endTime,
        row.confidence,
        row.reviewFlag,
        row.sourceName,
      ]
        .map(escapeCell)
        .join(","),
    ),
  ];

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
