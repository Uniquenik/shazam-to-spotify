import ExcelJS from "exceljs";
import { ExportRow } from "../../entities/track-match/model/types";

export async function downloadXlsx(filename: string, rows: ExportRow[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Tracks");

  sheet.columns = [
    { header: "Title", key: "title", width: 28 },
    { header: "Artist", key: "artist", width: 24 },
    { header: "Start Time", key: "startTime", width: 14 },
    { header: "End Time", key: "endTime", width: 14 },
    { header: "Confidence", key: "confidence", width: 12 },
    { header: "Needs Review", key: "reviewFlag", width: 14 },
    { header: "Source", key: "sourceName", width: 28 },
  ];

  rows.forEach((row) => {
    sheet.addRow(row);
  });

  sheet.getRow(1).font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
